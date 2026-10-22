import contextlib
import io
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import db, reset_feed


class ResetFeedTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.path = Path(temp.name) / "news.db"
        self.enterContext(patch.object(db, "DB_PATH", self.path))
        self.enterContext(patch.object(db, "DATABASE_URL", None))

    def seed(self):
        db.init_db()
        with db.get_conn() as conn:
            conn.execute(
                "INSERT INTO articles (feed_id, url, title, source, category, fetched_at) "
                "VALUES (1, 'https://example.com/story', 'Story', 'Source', 'Tech', 'now')"
            )
            conn.execute(
                "UPDATE preferences SET onboarded = 1, selected_categories = '[\"Tech\"]'"
            )
            conn.execute("UPDATE preferences SET focused_interests = ?", ('{"Tech":{"topics":["Gaming"],"teams":{}}}',))
            conn.execute("UPDATE preferences SET summary_style = ?", ('{"tone":"analytical","length":"brief","format":"bullets"}',))

    def test_reset_is_atomic_idempotent_and_preserves_feeds(self):
        self.seed()
        self.assertEqual(1, reset_feed.reset_database())
        with db.get_conn() as conn:
            self.assertEqual(0, conn.execute("SELECT COUNT(*) FROM articles").fetchone()[0])
            self.assertEqual(
                (0, "[]", "{}", "{}"), tuple(conn.execute("SELECT onboarded, selected_categories, focused_interests, summary_style FROM preferences").fetchone())
            )
            self.assertEqual(8, conn.execute("SELECT COUNT(*) FROM feeds").fetchone()[0])
        self.assertEqual(0, reset_feed.reset_database())

    def test_preference_failure_rolls_back_article_deletion(self):
        self.seed()
        with db.get_conn() as conn:
            conn.execute(
                "CREATE TRIGGER reject_reset BEFORE UPDATE ON preferences "
                "BEGIN SELECT RAISE(ABORT, 'reject reset'); END"
            )
        with self.assertRaises(sqlite3.IntegrityError):
            reset_feed.reset_database()
        with db.get_conn() as conn:
            self.assertEqual(1, conn.execute("SELECT COUNT(*) FROM articles").fetchone()[0])
            self.assertEqual(1, conn.execute("SELECT onboarded FROM preferences").fetchone()[0])

    def test_missing_sqlite_does_not_create_database(self):
        self.assertIsNone(reset_feed.reset_database())
        self.assertFalse(self.path.exists())

    def test_reset_handles_legacy_preferences_before_startup_migration(self):
        self.seed()
        with db.get_conn() as conn:
            conn.execute('ALTER TABLE preferences DROP COLUMN focused_interests')
            conn.execute('ALTER TABLE preferences DROP COLUMN summary_style')
        self.assertEqual(1, reset_feed.reset_database())
        with db.get_conn() as conn:
            self.assertEqual((0, '[]'), tuple(conn.execute('SELECT onboarded, selected_categories FROM preferences').fetchone()))

    def test_postgres_connection_failure_never_touches_sqlite(self):
        self.seed()
        with (
            patch.object(db, "DATABASE_URL", "postgresql://example.invalid/news"),
            patch.object(db.psycopg, "connect", side_effect=RuntimeError("secret")),
        ):
            with self.assertRaises(RuntimeError):
                reset_feed.reset_database()
        with db.get_conn() as conn:
            self.assertEqual(1, conn.execute("SELECT COUNT(*) FROM articles").fetchone()[0])

    def test_cli_reports_failure_without_secret_error_message(self):
        output = io.StringIO()
        with (
            patch.object(reset_feed, "load_dotenv"),
            patch.object(reset_feed, "reset_database", side_effect=RuntimeError("secret-uri")),
            contextlib.redirect_stdout(output),
            contextlib.redirect_stderr(output),
        ):
            self.assertEqual(1, reset_feed.main())
        self.assertIn("Database reset failed", output.getvalue())
        self.assertNotIn("secret-uri", output.getvalue())
