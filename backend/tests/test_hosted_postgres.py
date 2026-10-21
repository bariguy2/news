"""Opt-in new schema/usage/version checks; only connection-local temp tables."""

from contextlib import contextmanager
import os
import unittest
from unittest.mock import patch

from app import db
from app.summarize import usage
from app.summarize.providers import Completion
from app.summarize.settings import Settings
from app.summarize.versions import preserve_legacy, save_version
from app.summarize.manage import queue_regeneration


@unittest.skipUnless(os.environ.get('NEWS_TEST_POSTGRES_URL'), 'no PostgreSQL test connection configured')
class HostedPostgresTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(db, 'DATABASE_URL', os.environ['NEWS_TEST_POSTGRES_URL']))
        self.raw = db.get_conn().connection
        self.addCleanup(self.raw.close)
        self.raw.execute('SET search_path TO pg_temp')
        for statement in db.POSTGRES_SCHEMA_PATH.read_text().split(';'):
            if not statement.strip() or 'CREATE SCHEMA' in statement or 'ROW LEVEL SECURITY' in statement:
                continue
            statement = statement.replace('news.', '').replace('CREATE TABLE IF NOT EXISTS', 'CREATE TEMP TABLE IF NOT EXISTS')
            self.raw.execute(statement)
        self.raw.execute("INSERT INTO feeds (id, name, url, category) VALUES (1, 'Fixture', 'https://example.com/feed', 'Tech')")
        self.raw.execute("""INSERT INTO articles (id, feed_id, url, title, source, category, fetched_at,
            summary_status, summary_facts, summary_impact) VALUES
            (1, 1, 'https://example.com/article', 'Fixture', 'Fixture', 'Tech', 'now', 'done', 'Old facts', 'Old impact')""")
        self.raw.commit()
        @contextmanager
        def connection():
            with self.raw.transaction():
                yield db.PostgresConnection(self.raw)
        self.enterContext(patch.object(db, 'get_conn', connection))
        self.enterContext(patch.object(usage, 'get_conn', connection))
        self.enterContext(patch.dict(os.environ, {'AI_MONTHLY_BUDGET_USD': '1'}))

    def test_reservation_settlement_and_rollback(self):
        config = Settings('groq', 'fixture', 'unused', 150, 600)
        attempt = usage.reserve(config, 'text', 'summary', 'test', 'hash')
        usage.settle(attempt, config, status='success', elapsed_ms=10, completion=Completion('text', 20, 30, 10, 'stop'))
        self.assertEqual(21000, usage.report()[0]['used_nano'])
        with patch('app.summarize.usage.allowance', return_value=0):
            with self.assertRaises(usage.BudgetExceeded):
                usage.reserve(config, 'text', 'summary', 'test', 'hash')
        self.assertEqual(21000, usage.report()[0]['used_nano'])

    def test_versions_migration_operator_and_purge_retention(self):
        for _ in range(2):
            with db.get_conn() as conn:
                preserve_legacy(conn)
        self.assertEqual('queued', queue_regeneration(1))
        self.assertEqual('already_pending', queue_regeneration(1))
        with db.get_conn() as conn:
            save_version(conn, 1, 'https://example.com/article', 'New facts', 'New impact',
                         provider='groq', model='fixture', prompt_version='v2', input_hash='hash')
            conn.execute('DELETE FROM articles WHERE id = 1')
            rows = conn.execute('SELECT article_id, facts FROM summary_versions').fetchall()
            self.assertEqual(2, len(rows))
            self.assertTrue(all(row['article_id'] is None for row in rows))
            self.assertEqual({'Old facts', 'New facts'}, {row['facts'] for row in rows})
