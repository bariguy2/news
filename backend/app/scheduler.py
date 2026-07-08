"""Restart-safe pipeline orchestration and APScheduler configuration."""

from datetime import datetime
import logging
from threading import Lock

from apscheduler.schedulers.background import BackgroundScheduler

from app.config import REFRESH_INTERVAL_MINUTES
from app.db import get_conn
from app.ingest.extract import extract_full_text
from app.ingest.rss import fetch_all_feeds
from app.summarize.ollama_client import summarize_text


logger = logging.getLogger(__name__)

PIPELINE_JOB_ID = "news-refresh"
_pipeline_lock = Lock()


def run_pipeline() -> None:
    """Ingest feeds and process every pending article, committing each result."""
    if not _pipeline_lock.acquire(blocking=False):
        logger.info("Pipeline run skipped because another run is active")
        return

    fetched_count = 0
    summarized_count = 0
    failed_count = 0

    try:
        with get_conn() as conn:
            new_article_ids = fetch_all_feeds(conn)
            fetched_count = len(new_article_ids)
            conn.commit()

            pending_articles = conn.execute(
                """
                SELECT id, url, raw_excerpt
                FROM articles
                WHERE summary_status = 'pending'
                ORDER BY id
                """
            ).fetchall()

            for article in pending_articles:
                extracted_text = None
                extraction_ok = False
                summary = None

                try:
                    extracted_text, extraction_ok = extract_full_text(article["url"])
                    summary_input = (
                        extracted_text
                        if extraction_ok and extracted_text
                        else article["raw_excerpt"] or ""
                    )
                    summary = summarize_text(summary_input)
                except Exception:
                    logger.exception(
                        "Unexpected pipeline failure for article %s", article["id"]
                    )

                if summary is None:
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
                        (extracted_text, int(extraction_ok), article["id"]),
                    )
                    failed_count += 1
                else:
                    facts, impact = summary
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
                            extracted_text,
                            int(extraction_ok),
                            facts,
                            impact,
                            article["id"],
                        ),
                    )
                    summarized_count += 1

                conn.commit()

        logger.info(
            "Pipeline complete: fetched=%d summarized=%d failed=%d",
            fetched_count,
            summarized_count,
            failed_count,
        )
    except Exception:
        logger.exception("Pipeline run failed")
    finally:
        _pipeline_lock.release()


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
