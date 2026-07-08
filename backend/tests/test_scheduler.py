import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

import app.scheduler as scheduler_module
from app import db
from app.config import REFRESH_INTERVAL_MINUTES
from app.scheduler import PIPELINE_JOB_ID, create_scheduler, run_pipeline


class PipelineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "news.db"
        self.db_path_patch = patch.object(db, "DB_PATH", self.db_path)
        self.db_path_patch.start()
        db.init_db()

    def tearDown(self) -> None:
        self.db_path_patch.stop()
        self.temp_dir.cleanup()

    def insert_article(
        self,
        url: str,
        *,
        raw_excerpt: str = "RSS excerpt",
        summary_status: str = "pending",
        summary_facts: str | None = None,
        summary_impact: str | None = None,
    ) -> int:
        with db.get_conn() as conn:
            feed_id = conn.execute("SELECT id FROM feeds ORDER BY id LIMIT 1").fetchone()[
                0
            ]
            cursor = conn.execute(
                """
                INSERT INTO articles (
                    feed_id,
                    url,
                    title,
                    source,
                    category,
                    fetched_at,
                    raw_excerpt,
                    summary_facts,
                    summary_impact,
                    summary_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    feed_id,
                    url,
                    f"Title for {url}",
                    "BBC World News",
                    "World",
                    "2026-07-06T00:00:00+00:00",
                    raw_excerpt,
                    summary_facts,
                    summary_impact,
                    summary_status,
                ),
            )
            return cursor.lastrowid

    @patch("app.scheduler.fetch_all_feeds", return_value=[])
    @patch("app.scheduler.extract_full_text")
    @patch("app.scheduler.summarize_text")
    def test_processes_pending_articles_with_extraction_and_excerpt_fallback(
        self, summarize_mock, extract_mock, _fetch_mock
    ) -> None:
        first_id = self.insert_article("https://example.com/first")
        second_id = self.insert_article(
            "https://example.com/second", raw_excerpt="Fallback excerpt"
        )
        done_id = self.insert_article(
            "https://example.com/done",
            summary_status="done",
            summary_facts="Existing facts",
            summary_impact="Existing impact",
        )
        extract_mock.side_effect = (("Extracted full text", True), (None, False))
        observed_first_status: list[str] = []
        summary_inputs: list[str] = []

        def summarize(text: str) -> tuple[str, str]:
            summary_inputs.append(text)
            if len(summary_inputs) == 2:
                with db.get_conn() as observer:
                    observed_first_status.append(
                        observer.execute(
                            "SELECT summary_status FROM articles WHERE id = ?",
                            (first_id,),
                        ).fetchone()[0]
                    )
            return f"Facts {len(summary_inputs)}", f"Impact {len(summary_inputs)}"

        summarize_mock.side_effect = summarize

        with self.assertLogs("app.scheduler", level="INFO") as logs:
            run_pipeline()

        with db.get_conn() as conn:
            rows = {
                row["id"]: row
                for row in conn.execute(
                    """
                    SELECT id, extracted_text, extraction_ok, summary_facts,
                           summary_impact, summary_status
                    FROM articles
                    ORDER BY id
                    """
                )
            }

        self.assertEqual(["Extracted full text", "Fallback excerpt"], summary_inputs)
        self.assertEqual(["done"], observed_first_status)
        self.assertEqual("Extracted full text", rows[first_id]["extracted_text"])
        self.assertEqual(1, rows[first_id]["extraction_ok"])
        self.assertEqual("Facts 1", rows[first_id]["summary_facts"])
        self.assertEqual("done", rows[first_id]["summary_status"])
        self.assertIsNone(rows[second_id]["extracted_text"])
        self.assertEqual(0, rows[second_id]["extraction_ok"])
        self.assertEqual("Facts 2", rows[second_id]["summary_facts"])
        self.assertEqual("done", rows[second_id]["summary_status"])
        self.assertEqual("Existing facts", rows[done_id]["summary_facts"])
        self.assertTrue(
            any("fetched=0 summarized=2 failed=0" in line for line in logs.output)
        )

        extract_mock.reset_mock()
        summarize_mock.reset_mock()
        run_pipeline()
        extract_mock.assert_not_called()
        summarize_mock.assert_not_called()

    @patch("app.scheduler.extract_full_text", return_value=("Fresh full text", True))
    def test_processes_new_article_inserted_by_ingestion(self, _extract_mock) -> None:
        inserted_ids: list[int] = []
        visible_after_ingest_commit: list[bool] = []

        def ingest(conn) -> list[int]:
            feed_id = conn.execute("SELECT id FROM feeds ORDER BY id LIMIT 1").fetchone()[
                0
            ]
            cursor = conn.execute(
                """
                INSERT INTO articles (
                    feed_id, url, title, source, category, fetched_at, raw_excerpt
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    feed_id,
                    "https://example.com/new",
                    "New article",
                    "BBC World News",
                    "World",
                    "2026-07-06T00:00:00+00:00",
                    "Fresh excerpt",
                ),
            )
            inserted_ids.append(cursor.lastrowid)
            return [cursor.lastrowid]

        def summarize(text: str) -> tuple[str, str]:
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
    @patch("app.scheduler.extract_full_text", return_value=("Extracted text", True))
    @patch("app.scheduler.summarize_text")
    def test_marks_model_failure_and_continues_with_next_article(
        self, summarize_mock, _extract_mock, _fetch_mock
    ) -> None:
        failed_id = self.insert_article("https://example.com/fails")
        done_id = self.insert_article("https://example.com/succeeds")
        summarize_mock.side_effect = (None, ("Facts", "Impact"))

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

        self.assertEqual(("Extracted text", 1, "failed"), tuple(failed))
        self.assertEqual(("Facts", "Impact", "done"), tuple(succeeded))

    @patch("app.scheduler.fetch_all_feeds", return_value=[])
    @patch("app.scheduler.extract_full_text")
    @patch("app.scheduler.summarize_text", return_value=("Facts", "Impact"))
    def test_contains_unexpected_article_failure_and_continues(
        self, summarize_mock, extract_mock, _fetch_mock
    ) -> None:
        failed_id = self.insert_article("https://example.com/extraction-fails")
        done_id = self.insert_article(
            "https://example.com/fallback", raw_excerpt="Usable excerpt"
        )
        extract_mock.side_effect = (RuntimeError("broken extractor"), (None, False))

        with self.assertLogs("app.scheduler", level="ERROR") as logs:
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

    @patch("app.scheduler.get_conn")
    def test_skips_overlapping_run(self, get_conn_mock) -> None:
        scheduler_module._pipeline_lock.acquire()
        try:
            with self.assertLogs("app.scheduler", level="INFO") as logs:
                run_pipeline()
        finally:
            scheduler_module._pipeline_lock.release()

        get_conn_mock.assert_not_called()
        self.assertTrue(any("another run is active" in line for line in logs.output))


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
