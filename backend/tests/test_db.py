import asyncio
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from app import db
from app.main import app


class DatabaseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "nested" / "news.db"
        self.db_path_patch = patch.object(db, "DB_PATH", self.db_path)
        self.db_path_patch.start()

    def tearDown(self) -> None:
        self.db_path_patch.stop()
        self.temp_dir.cleanup()

    def test_init_db_creates_schema_indexes_and_seed_rows(self) -> None:
        db.init_db()

        with db.get_conn() as conn:
            tables = {
                row["name"]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                )
            }
            indexes = {
                row["name"]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'index'"
                )
            }
            feeds = conn.execute(
                "SELECT name, url, category, enabled FROM feeds ORDER BY id"
            ).fetchall()
            preference = conn.execute(
                "SELECT id, selected_categories, onboarded FROM preferences"
            ).fetchone()

        self.assertTrue(self.db_path.is_file())
        self.assertEqual({"feeds", "articles", "preferences"}, tables)
        self.assertIn("idx_articles_published", indexes)
        self.assertIn("idx_articles_category", indexes)
        self.assertEqual(len(db.STARTER_FEEDS), len(feeds))
        self.assertEqual(
            [tuple(feed) + (1,) for feed in db.STARTER_FEEDS],
            [tuple(feed) for feed in feeds],
        )
        self.assertEqual((1, "[]", 0), tuple(preference))

    def test_init_db_is_idempotent_and_preserves_preferences(self) -> None:
        db.init_db()
        with db.get_conn() as conn:
            conn.execute(
                """
                UPDATE preferences
                SET selected_categories = '["Tech"]', onboarded = 1
                WHERE id = 1
                """
            )

        db.init_db()

        with db.get_conn() as conn:
            feed_count = conn.execute("SELECT COUNT(*) FROM feeds").fetchone()[0]
            preference = conn.execute(
                "SELECT selected_categories, onboarded FROM preferences WHERE id = 1"
            ).fetchone()

        self.assertEqual(len(db.STARTER_FEEDS), feed_count)
        self.assertEqual(('["Tech"]', 1), tuple(preference))

    def test_declared_uniqueness_single_row_and_foreign_key_constraints(self) -> None:
        db.init_db()

        with db.get_conn() as conn:
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute(
                    "INSERT INTO feeds (name, url, category) VALUES (?, ?, ?)",
                    ("Duplicate", db.STARTER_FEEDS[0][1], "World"),
                )

            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute(
                    """
                    INSERT INTO articles (
                        feed_id, url, title, source, category, fetched_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (9999, "https://example.com/story", "Title", "Source", "World", "now"),
                )

            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute(
                    """
                    INSERT INTO preferences (id, selected_categories, onboarded)
                    VALUES (2, '[]', 0)
                    """
                )

    def test_article_defaults_and_url_deduplication(self) -> None:
        db.init_db()

        with db.get_conn() as conn:
            feed_id = conn.execute("SELECT id FROM feeds LIMIT 1").fetchone()[0]
            conn.execute(
                """
                INSERT INTO articles (
                    feed_id, url, title, source, category, fetched_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (feed_id, "https://example.com/story", "Title", "Source", "World", "now"),
            )
            article = conn.execute(
                """
                SELECT extraction_ok, summary_status
                FROM articles
                WHERE url = 'https://example.com/story'
                """
            ).fetchone()

            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute(
                    """
                    INSERT INTO articles (
                        feed_id, url, title, source, category, fetched_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (feed_id, "https://example.com/story", "Other", "Source", "World", "now"),
                )

        self.assertEqual((0, "pending"), tuple(article))


class StartupTests(unittest.TestCase):
    def test_lifespan_initializes_database_and_owns_scheduler(self) -> None:
        async def run_lifespan() -> None:
            async with app.router.lifespan_context(app):
                pass

        scheduler = MagicMock()
        with (
            patch("app.main.init_db") as init_db_mock,
            patch("app.main.create_scheduler", return_value=scheduler) as create_mock,
        ):
            asyncio.run(run_lifespan())

        init_db_mock.assert_called_once_with()
        create_mock.assert_called_once_with()
        scheduler.start.assert_called_once_with()
        scheduler.shutdown.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
