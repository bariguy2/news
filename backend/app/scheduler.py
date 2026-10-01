"""Restart-safe pipeline orchestration and APScheduler configuration."""

from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import json
import logging
import sqlite3
from threading import Lock

from apscheduler.schedulers.background import BackgroundScheduler

from app.config import (
    PIPELINE_CONCURRENCY,
    RECENCY_WINDOW_HOURS,
    REFRESH_INTERVAL_MINUTES,
)
from app.db import DatabaseConnection, get_conn
from app.ingest.extract import extract_full_text
from app.ingest.rss import fetch_all_feeds
from app.summarize.ollama_client import Summary, summarize_text


logger = logging.getLogger(__name__)

PIPELINE_JOB_ID = "news-refresh"
_pipeline_lock = Lock()
_pipeline_running = False
_pipeline_rerun_requested = False


@dataclass(frozen=True)
class ArticleResult:
    """Extraction and summary output returned by a database-free worker."""

    article_id: int
    extracted_text: str | None
    extraction_ok: bool
    summary: Summary | None


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _selected_categories(conn: DatabaseConnection) -> list[str]:
    row = conn.execute(
        "SELECT selected_categories FROM preferences WHERE id = 1"
    ).fetchone()
    if row is None:
        return []

    try:
        decoded = json.loads(row["selected_categories"])
    except (TypeError, json.JSONDecodeError):
        logger.error("Stored category preferences are not valid JSON")
        return []

    if not isinstance(decoded, list):
        logger.error("Stored category preferences are not a list")
        return []

    return list(
        dict.fromkeys(
            category.strip()
            for category in decoded
            if isinstance(category, str) and category.strip()
        )
    )


def _process_article(article: dict[str, object]) -> ArticleResult:
    article_id = int(article["id"])
    extracted_text = None
    extraction_ok = False
    summary = None

    try:
        extracted_text, extraction_ok = extract_full_text(str(article["url"]))
        summary_input = (
            extracted_text
            if extraction_ok and extracted_text
            else str(article["raw_excerpt"] or "")
        )
        summary = summarize_text(summary_input)
    except Exception:
        logger.exception("Unexpected pipeline failure for article %s", article_id)

    return ArticleResult(
        article_id=article_id,
        extracted_text=extracted_text,
        extraction_ok=extraction_ok,
        summary=summary,
    )


def _save_article_result(conn: DatabaseConnection, result: ArticleResult) -> bool:
    if result.summary is None:
        conn.execute(
            """
            UPDATE articles
            SET extracted_text = ?,
                extraction_ok = ?,
                summary_facts = NULL,
                summary_impact = NULL,
                summary_status = 'failed'
            WHERE id = ?
            """,
            (result.extracted_text, int(result.extraction_ok), result.article_id),
        )
        return False

    facts, impact = result.summary
    conn.execute(
        """
        UPDATE articles
        SET extracted_text = ?,
            extraction_ok = ?,
            summary_facts = ?,
            summary_impact = ?,
            summary_status = 'done'
        WHERE id = ?
        """,
        (
            result.extracted_text,
            int(result.extraction_ok),
            facts,
            impact,
            result.article_id,
        ),
    )
    return True


def _submit_article(
    executor: ThreadPoolExecutor,
    article: dict[str, object] | sqlite3.Row,
) -> Future[ArticleResult]:
    return executor.submit(_process_article, dict(article))


def _run_pipeline_cycle() -> None:
    fetched_count = 0
    summarized_count = 0
    failed_count = 0
    purged_count = 0

    with get_conn() as conn:
        categories = _selected_categories(conn)
        if not categories:
            logger.info("Pipeline skipped because no categories are selected")
            return

        now = _utc_now()
        cutoff = (now - timedelta(hours=RECENCY_WINDOW_HOURS)).isoformat()
        purged_count = conn.execute(
            """
            DELETE FROM articles
            WHERE COALESCE(published_at, fetched_at) < ?
            """,
            (cutoff,),
        ).rowcount
        conn.commit()

        new_article_ids = fetch_all_feeds(conn, categories, now=now)
        fetched_count = len(new_article_ids)
        conn.commit()

        placeholders = ", ".join("?" for _ in categories)
        pending_articles = conn.execute(
            f"""
            SELECT id, url, raw_excerpt
            FROM articles
            WHERE summary_status = 'pending'
              AND category IN ({placeholders})
            ORDER BY COALESCE(published_at, fetched_at) DESC, id DESC
            """,
            categories,
        ).fetchall()

        article_iterator = iter(pending_articles)
        with ThreadPoolExecutor(max_workers=PIPELINE_CONCURRENCY) as executor:
            futures: dict[Future[ArticleResult], int] = {}
            for article in article_iterator:
                future = _submit_article(executor, article)
                futures[future] = article["id"]
                if len(futures) == PIPELINE_CONCURRENCY:
                    break

            while futures:
                future = next(as_completed(tuple(futures)))
                article_id = futures.pop(future)
                try:
                    result = future.result()
                except Exception:
                    logger.exception(
                        "Unexpected worker failure for article %s", article_id
                    )
                    result = ArticleResult(article_id, None, False, None)

                if _save_article_result(conn, result):
                    summarized_count += 1
                else:
                    failed_count += 1
                conn.commit()

                next_article = next(article_iterator, None)
                if next_article is not None:
                    next_future = _submit_article(executor, next_article)
                    futures[next_future] = next_article["id"]

    logger.info(
        "Pipeline complete: fetched=%d summarized=%d failed=%d purged=%d",
        fetched_count,
        summarized_count,
        failed_count,
        purged_count,
    )


def run_pipeline() -> None:
    """Run one pipeline cycle and honor refreshes queued while it is active."""
    global _pipeline_running, _pipeline_rerun_requested

    with _pipeline_lock:
        if _pipeline_running:
            _pipeline_rerun_requested = True
            logger.info("Pipeline rerun queued because another run is active")
            return
        _pipeline_running = True

    try:
        while True:
            try:
                _run_pipeline_cycle()
            except Exception:
                logger.exception("Pipeline run failed")

            with _pipeline_lock:
                if _pipeline_rerun_requested:
                    _pipeline_rerun_requested = False
                    should_rerun = True
                else:
                    _pipeline_running = False
                    should_rerun = False

            if not should_rerun:
                return
            logger.info("Starting queued pipeline rerun")
    except BaseException:
        with _pipeline_lock:
            _pipeline_running = False
        raise


def create_scheduler() -> BackgroundScheduler:
    """Create the application scheduler with an immediate interval job."""
    scheduler = BackgroundScheduler()
    scheduler.add_job(
        run_pipeline,
        "interval",
        minutes=REFRESH_INTERVAL_MINUTES,
        next_run_time=datetime.now(),
        id=PIPELINE_JOB_ID,
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    return scheduler
