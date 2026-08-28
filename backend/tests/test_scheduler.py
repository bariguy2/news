import json
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Barrier, Event, Lock, Thread, current_thread
from unittest.mock import ANY, MagicMock, patch

import app.scheduler as scheduler_module
from app import db
from app.config import REFRESH_INTERVAL_MINUTES
from app.scheduler import PIPELINE_JOB_ID, create_scheduler, run_pipeline


NOW = datetime(2026, 8, 27, 12, 0, tzinfo=UTC)


class PipelineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "news.db"
        self.db_path_patch = patch.object(db, "DB_PATH", self.db_path)
        self.db_path_patch.start()
        self.now_patch = patch("app.scheduler._utc_now", return_value=NOW)
        self.now_patch.start()
        db.init_db()
        self.set_categories(["World"])
        with scheduler_module._pipeline_lock:
            scheduler_module._pipeline_running = False
            scheduler_module._pipeline_rerun_requested = False

    def tearDown(self) -> None:
        with scheduler_module._pipeline_lock:
            self.assertFalse(scheduler_module._pipeline_running)
            scheduler_module._pipeline_rerun_requested = False
        self.now_patch.stop()
        self.db_path_patch.stop()
        self.temp_dir.cleanup()

    def set_categories(self, categories: list[str]) -> None:
        with db.get_conn() as conn:
            conn.execute(
                """
                UPDATE preferences
                SET selected_categories = ?, onboarded = 1
                WHERE id = 1
                """,
                (json.dumps(categories),),
            )

    def insert_article(
        self,
        url: str,
        *,
        category: str = "World",
        published_at: datetime | None = NOW,
        fetched_at: datetime = NOW,
        raw_excerpt: str = "RSS excerpt",
        summary_status: str = "pending",
        summary_facts: str | None = None,
        summary_impact: str | None = None,
    ) -> int:
        with db.get_conn() as conn:
            feed = conn.execute(
                """
                SELECT id, name
                FROM feeds
                WHERE category = ?
                ORDER BY id
                LIMIT 1
                """,
                (category,),
            ).fetchone()
            cursor = conn.execute(
                """
                INSERT INTO articles (
                    feed_id, url, title, source, category, published_at,
                    fetched_at, raw_excerpt, summary_facts, summary_impact,
                    summary_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    feed["id"],
                    url,
                    f"Title for {url}",
                    feed["name"],
                    category,
                    published_at.isoformat() if published_at else None,
                    fetched_at.isoformat(),
                    raw_excerpt,
                    summary_facts,
                    summary_impact,
                    summary_status,
                ),
            )
            return cursor.lastrowid

    @patch("app.scheduler.fetch_all_feeds")
    @patch("app.scheduler.extract_full_text")
    def test_skips_all_work_without_selected_categories(
        self, extract_mock, fetch_mock
    ) -> None:
        self.set_categories([])
        self.insert_article("https://example.com/pending")

        with self.assertLogs("app.scheduler", level="INFO") as logs:
            run_pipeline()

        fetch_mock.assert_not_called()
        extract_mock.assert_not_called()
        self.assertTrue(
            any("no categories are selected" in line for line in logs.output)
        )

    @patch("app.scheduler.fetch_all_feeds", return_value=[])
    def test_scopes_pending_work_purges_stale_rows_and_commits_newest_first(
        self, fetch_mock
    ) -> None:
        newest_id = self.insert_article(
            "https://example.com/newest",
            published_at=NOW - timedelta(hours=1),
        )
        older_id = self.insert_article(
            "https://example.com/older",
            published_at=NOW - timedelta(hours=2),
            raw_excerpt="Fallback excerpt",
        )
        tech_id = self.insert_article(
            "https://example.com/unselected",
            category="Tech",
            published_at=NOW - timedelta(minutes=30),
        )
        stale_id = self.insert_article(
            "https://example.com/stale",
            published_at=NOW - timedelta(hours=49),
        )
        summary_inputs: list[str] = []
        observed_newest_status: list[str] = []

        def extract(url: str) -> tuple[str | None, bool]:
            if url.endswith("/newest"):
                return "Newest full text", True
            return None, False

        def summarize(text: str) -> tuple[str, str]:
            summary_inputs.append(text)
            if len(summary_inputs) == 2:
                with db.get_conn() as observer:
                    observed_newest_status.append(
                        observer.execute(
                            "SELECT summary_status FROM articles WHERE id = ?",
                            (newest_id,),
                        ).fetchone()[0]
                    )
            return f"Facts for {text}", f"Impact for {text}"

        with (
            patch("app.scheduler.PIPELINE_CONCURRENCY", 1),
            patch("app.scheduler.extract_full_text", side_effect=extract),
            patch("app.scheduler.summarize_text", side_effect=summarize),
            self.assertLogs("app.scheduler", level="INFO") as logs,
        ):
            run_pipeline()

        with db.get_conn() as conn:
            rows = {
                row["id"]: row
                for row in conn.execute(
                    "SELECT id, extracted_text, extraction_ok, summary_status FROM articles"
                )
            }

        fetch_mock.assert_called_once_with(ANY, ["World"], now=NOW)
        self.assertEqual(["Newest full text", "Fallback excerpt"], summary_inputs)
        self.assertEqual(["done"], observed_newest_status)
        self.assertEqual("done", rows[newest_id]["summary_status"])
        self.assertEqual(1, rows[newest_id]["extraction_ok"])
        self.assertEqual("done", rows[older_id]["summary_status"])
        self.assertEqual("pending", rows[tech_id]["summary_status"])
        self.assertNotIn(stale_id, rows)
        self.assertTrue(
            any(
                "fetched=0 summarized=2 failed=0 purged=1" in line
                for line in logs.output
            )
        )

    @patch("app.scheduler.extract_full_text", return_value=("Fresh full text", True))
    def test_commits_ingestion_before_processing_new_article(
        self, _extract_mock
    ) -> None:
        inserted_ids: list[int] = []
        visible_after_ingest_commit: list[bool] = []

        def ingest(conn, categories, *, now) -> list[int]:
            self.assertEqual(["World"], categories)
            self.assertEqual(NOW, now)
            feed_id = conn.execute(
                "SELECT id FROM feeds WHERE category = 'World' ORDER BY id LIMIT 1"
            ).fetchone()[0]
            cursor = conn.execute(
                """
                INSERT INTO articles (
                    feed_id, url, title, source, category, published_at,
                    fetched_at, raw_excerpt
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    feed_id,
                    "https://example.com/new",
                    "New article",
                    "BBC World News",
                    "World",
                    NOW.isoformat(),
                    NOW.isoformat(),
                    "Fresh excerpt",
                ),
            )
            inserted_ids.append(cursor.lastrowid)
            return [cursor.lastrowid]

        def summarize(_text: str) -> tuple[str, str]:
            with db.get_conn() as observer:
                visible_after_ingest_commit.append(
                    observer.execute(
                        "SELECT COUNT(*) FROM articles WHERE id = ?",
                        (inserted_ids[0],),
                    ).fetchone()[0]
                    == 1
                )
            return "Fresh facts", "Fresh impact"

        with (
            patch("app.scheduler.fetch_all_feeds", side_effect=ingest),
            patch("app.scheduler.summarize_text", side_effect=summarize),
            self.assertLogs("app.scheduler", level="INFO") as logs,
        ):
            run_pipeline()

        with db.get_conn() as conn:
            article = conn.execute(
                "SELECT summary_status, summary_facts FROM articles WHERE id = ?",
                (inserted_ids[0],),
            ).fetchone()

        self.assertEqual([True], visible_after_ingest_commit)
        self.assertEqual(("done", "Fresh facts"), tuple(article))
        self.assertTrue(
            any("fetched=1 summarized=1 failed=0" in line for line in logs.output)
        )

    @patch("app.scheduler.fetch_all_feeds", return_value=[])
    def test_marks_model_failure_and_continues_with_next_article(
        self, _fetch_mock
    ) -> None:
        failed_id = self.insert_article(
            "https://example.com/fails",
            published_at=NOW,
        )
        done_id = self.insert_article(
            "https://example.com/succeeds",
            published_at=NOW - timedelta(minutes=1),
        )

        def summarize(text: str):
            if "fails" in text:
                return None
            return "Facts", "Impact"

        def extract(url: str):
            return f"Extracted text for {url}", True

        with (
            patch("app.scheduler.PIPELINE_CONCURRENCY", 1),
            patch("app.scheduler.extract_full_text", side_effect=extract),
            patch("app.scheduler.summarize_text", side_effect=summarize),
        ):
            run_pipeline()

        with db.get_conn() as conn:
            failed = conn.execute(
                "SELECT extracted_text, extraction_ok, summary_status FROM articles WHERE id = ?",
                (failed_id,),
            ).fetchone()
            succeeded = conn.execute(
                "SELECT summary_facts, summary_impact, summary_status FROM articles WHERE id = ?",
                (done_id,),
            ).fetchone()

        self.assertEqual(1, failed["extraction_ok"])
        self.assertEqual("failed", failed["summary_status"])
        self.assertEqual(("Facts", "Impact", "done"), tuple(succeeded))

    @patch("app.scheduler.fetch_all_feeds", return_value=[])
    def test_contains_unexpected_article_failure_and_continues(
        self, _fetch_mock
    ) -> None:
        failed_id = self.insert_article(
            "https://example.com/extraction-fails",
            published_at=NOW,
        )
        done_id = self.insert_article(
            "https://example.com/fallback",
            published_at=NOW - timedelta(minutes=1),
            raw_excerpt="Usable excerpt",
        )

        def extract(url: str):
            if url.endswith("/extraction-fails"):
                raise RuntimeError("broken extractor")
            return None, False

        with (
            patch("app.scheduler.PIPELINE_CONCURRENCY", 1),
            patch("app.scheduler.extract_full_text", side_effect=extract),
            patch(
                "app.scheduler.summarize_text", return_value=("Facts", "Impact")
            ) as summarize_mock,
            self.assertLogs("app.scheduler", level="ERROR") as logs,
        ):
            run_pipeline()

        with db.get_conn() as conn:
            statuses = {
                row["id"]: row["summary_status"]
                for row in conn.execute("SELECT id, summary_status FROM articles")
            }

        self.assertEqual("failed", statuses[failed_id])
        self.assertEqual("done", statuses[done_id])
        summarize_mock.assert_called_once_with("Usable excerpt")
        self.assertTrue(any("broken extractor" in line for line in logs.output))

    @patch("app.scheduler.fetch_all_feeds", side_effect=RuntimeError("database issue"))
    def test_contains_top_level_pipeline_failure(self, _fetch_mock) -> None:
        pending_id = self.insert_article("https://example.com/pending")

        with self.assertLogs("app.scheduler", level="ERROR") as logs:
            run_pipeline()

        with db.get_conn() as conn:
            status = conn.execute(
                "SELECT summary_status FROM articles WHERE id = ?", (pending_id,)
            ).fetchone()[0]

        self.assertEqual("pending", status)
        self.assertTrue(any("database issue" in line for line in logs.output))

    @patch("app.scheduler.fetch_all_feeds", return_value=[])
    @patch("app.scheduler.summarize_text", return_value=("Facts", "Impact"))
    def test_processes_three_articles_concurrently(
        self, _summarize_mock, _fetch_mock
    ) -> None:
        for index in range(3):
            self.insert_article(f"https://example.com/concurrent-{index}")

        barrier = Barrier(3, timeout=2)
        worker_names: set[str] = set()
        names_lock = Lock()

        def extract(_url: str) -> tuple[str, bool]:
            with names_lock:
                worker_names.add(current_thread().name)
            barrier.wait()
            return "Extracted text", True

        with patch("app.scheduler.extract_full_text", side_effect=extract):
            run_pipeline()

        with db.get_conn() as conn:
            statuses = [
                row[0]
                for row in conn.execute(
                    "SELECT summary_status FROM articles ORDER BY id"
                )
            ]

        self.assertEqual(["done", "done", "done"], statuses)
        self.assertEqual(3, len(worker_names))

    def test_overlapping_trigger_queues_rerun_with_fresh_preferences(self) -> None:
        first_cycle_started = Event()
        finish_first_cycle = Event()
        observed_categories: list[list[str]] = []

        def cycle() -> None:
            with db.get_conn() as conn:
                observed_categories.append(
                    scheduler_module._selected_categories(conn)
                )
            if len(observed_categories) == 1:
                first_cycle_started.set()
                self.assertTrue(finish_first_cycle.wait(timeout=2))

        with (
            patch("app.scheduler._run_pipeline_cycle", side_effect=cycle),
            self.assertLogs("app.scheduler", level="INFO") as logs,
        ):
            runner = Thread(target=run_pipeline)
            runner.start()
            self.assertTrue(first_cycle_started.wait(timeout=2))
            self.set_categories(["Tech"])
            run_pipeline()
            finish_first_cycle.set()
            runner.join(timeout=2)

        self.assertFalse(runner.is_alive())
        self.assertEqual([["World"], ["Tech"]], observed_categories)
        self.assertTrue(any("rerun queued" in line for line in logs.output))
        self.assertTrue(any("Starting queued" in line for line in logs.output))


class SchedulerConfigurationTests(unittest.TestCase):
    @patch("app.scheduler.BackgroundScheduler")
    def test_creates_immediate_single_instance_interval_job(
        self, scheduler_class_mock
    ) -> None:
        scheduler = MagicMock()
        scheduler_class_mock.return_value = scheduler

        result = create_scheduler()

        self.assertIs(scheduler, result)
        scheduler.add_job.assert_called_once()
        args, kwargs = scheduler.add_job.call_args
        self.assertIs(run_pipeline, args[0])
        self.assertEqual("interval", args[1])
        self.assertEqual(REFRESH_INTERVAL_MINUTES, kwargs["minutes"])
        self.assertIsInstance(kwargs["next_run_time"], datetime)
        self.assertEqual(PIPELINE_JOB_ID, kwargs["id"])
        self.assertTrue(kwargs["replace_existing"])
        self.assertTrue(kwargs["coalesce"])
        self.assertEqual(1, kwargs["max_instances"])
if __name__ == "__main__":
    unittest.main()
