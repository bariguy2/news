"""Opt-in real PostgreSQL checks using connection-local temporary tables only."""

from contextlib import contextmanager
import os
import unittest
from unittest.mock import patch

from app import db, reset_feed


@unittest.skipUnless(os.environ.get("NEWS_TEST_POSTGRES_URL"), "no PostgreSQL test connection configured")
class PostgresResetTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(db, "DATABASE_URL", os.environ["NEWS_TEST_POSTGRES_URL"]))
        self.connection = db.get_conn().connection
        self.addCleanup(self.connection.close)
        # Exclude the real news schema entirely; reset can see only temp tables.
        self.connection.execute("SET search_path TO pg_temp")
        self.connection.execute("CREATE TEMP TABLE articles (id INTEGER PRIMARY KEY)")
        self.connection.execute(
            "CREATE TEMP TABLE preferences (id INTEGER PRIMARY KEY, "
            "onboarded INTEGER, selected_categories TEXT, focused_interests TEXT NOT NULL DEFAULT '{}', "
            "summary_style TEXT NOT NULL DEFAULT '{}')"
        )
        self.connection.execute("INSERT INTO articles VALUES (1), (2)")
        self.connection.execute("INSERT INTO preferences (id, onboarded, selected_categories, focused_interests) VALUES (1, 1, '[\"Tech\"]', %s)",
                                ('{"Tech":{"topics":["Gaming"],"teams":{}}}',))
        self.connection.execute('UPDATE preferences SET summary_style = %s',
                                ('{"tone":"analytical","length":"brief","format":"bullets"}',))
        self.connection.commit()

        @contextmanager
        def isolated_connection():
            with self.connection.transaction():
                yield db.PostgresConnection(self.connection)

        self.enterContext(patch.object(db, "get_conn", isolated_connection))

    def test_real_postgres_reset_and_repeat(self):
        self.assertEqual(2, reset_feed.reset_database())
        self.assertEqual(0, reset_feed.reset_database())
        with self.connection.transaction():
            self.assertEqual(
                {"count": 0}, self.connection.execute("SELECT COUNT(*) FROM articles").fetchone()
            )
            self.assertEqual(
                {"onboarded": 0, "selected_categories": "[]", "focused_interests": "{}", "summary_style": "{}"},
                self.connection.execute("SELECT onboarded, selected_categories, focused_interests, summary_style FROM preferences").fetchone(),
            )

    def test_real_postgres_failure_rolls_back_both_changes(self):
        self.connection.execute(
            "ALTER TABLE preferences ADD CONSTRAINT reject_reset CHECK (onboarded = 1)"
        )
        self.connection.commit()
        with self.assertRaises(db.psycopg.errors.CheckViolation):
            reset_feed.reset_database()
        with self.connection.transaction():
            self.assertEqual(
                {"count": 2}, self.connection.execute("SELECT COUNT(*) FROM articles").fetchone()
            )
            self.assertEqual(
                {"onboarded": 1, "selected_categories": '["Tech"]'},
                self.connection.execute("SELECT onboarded, selected_categories FROM preferences").fetchone(),
            )
            self.assertIn('Gaming', self.connection.execute('SELECT focused_interests FROM preferences').fetchone()['focused_interests'])
            self.assertIn('analytical', self.connection.execute('SELECT summary_style FROM preferences').fetchone()['summary_style'])
