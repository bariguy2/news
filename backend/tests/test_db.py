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
        self.database_url_patch = patch.object(db, "DATABASE_URL", None)
        self.database_url_patch.start()

    def tearDown(self) -> None:
        self.database_url_patch.stop()
        self.db_path_patch.stop()
        self.temp_dir.cleanup()

    def test_context_closes_connection_and_rolls_back_errors(self) -> None:
        db.init_db()
        with db.get_conn() as conn:
            conn.execute("UPDATE preferences SET onboarded = 1")
        with self.assertRaises(sqlite3.ProgrammingError):
            conn.execute("SELECT 1")
        with self.assertRaisesRegex(ValueError, "abort"):
            with db.get_conn() as conn:
                conn.execute("UPDATE preferences SET onboarded = 0")
                raise ValueError("abort")
        with self.assertRaises(sqlite3.ProgrammingError):
            conn.execute("SELECT 1")
        with db.get_conn() as conn:
            self.assertEqual(conn.execute("SELECT onboarded FROM preferences").fetchone()[0], 1)

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


class PostgresDatabaseTests(unittest.TestCase):
    def test_connection_uses_ssl_private_schema_and_named_rows(self) -> None:
        raw_connection = MagicMock()
        with (
            patch.object(
                db, "DATABASE_URL", "postgresql://user:password@localhost/postgres"
            ),
            patch.object(db.psycopg, "connect", return_value=raw_connection) as connect,
        ):
            connection = db.get_conn()
            cursor = connection.execute("SELECT id FROM articles WHERE id = ?", (7,))
            connection.commit()

        self.assertIs(cursor, raw_connection.execute.return_value)
        self.assertEqual("require", connect.call_args.kwargs["sslmode"])
        self.assertEqual("10", connect.call_args.kwargs["connect_timeout"])
        self.assertIs(db.dict_row, connect.call_args.kwargs["row_factory"])
        raw_connection.execute.assert_any_call("SET search_path TO news, public")
        raw_connection.execute.assert_any_call(
            "SELECT id FROM articles WHERE id = %s", (7,)
        )
        raw_connection.commit.assert_called_once_with()

    def test_failed_schema_selection_closes_connection(self) -> None:
        raw_connection = MagicMock()
        raw_connection.execute.side_effect = RuntimeError("schema unavailable")
        with (
            patch.object(
                db, "DATABASE_URL", "postgresql://user:password@localhost/postgres"
            ),
            patch.object(db.psycopg, "connect", return_value=raw_connection),
        ):
            with self.assertRaisesRegex(RuntimeError, "schema unavailable"):
                db.get_conn()
        raw_connection.close.assert_called_once_with()

    def test_postgres_initialization_uses_private_schema_and_seeds(self) -> None:
        connection = MagicMock()
        connection.__enter__.return_value = connection
        with (
            patch.object(db, "DATABASE_URL", "postgresql://localhost/postgres"),
            patch.object(db, "get_conn", return_value=connection),
        ):
            db.init_db()

        queries = [call.args[0] for call in connection.execute.call_args_list]
        self.assertTrue(any("CREATE SCHEMA IF NOT EXISTS news" in query for query in queries))
        self.assertTrue(any("CREATE TABLE IF NOT EXISTS news.articles" in query for query in queries))
        self.assertEqual(3, sum("ENABLE ROW LEVEL SECURITY" in query for query in queries))
        self.assertEqual(len(db.STARTER_FEEDS), sum("INSERT INTO feeds" in query for query in queries))
        self.assertTrue(any("ON CONFLICT(id) DO NOTHING" in query for query in queries))


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
