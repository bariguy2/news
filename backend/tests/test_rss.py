from datetime import UTC, datetime
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app import db
from app.ingest.rss import fetch_all_feeds, verify_feed


NOW = datetime(2026, 7, 7, 12, 0, tzinfo=UTC)


class FeedVerificationTests(unittest.TestCase):
    def test_accepts_a_well_formed_feed_and_http_redirect(self) -> None:
        parsed = SimpleNamespace(
            status=302,
            href="https://example.com/feed.xml",
            bozo=False,
            entries=[{"title": "Story"}],
        )

        result = verify_feed("Example", "http://example.com/feed.xml", lambda _: parsed)

        self.assertTrue(result.ok)
        self.assertEqual(302, result.status)
        self.assertEqual("https://example.com/feed.xml", result.final_url)
        self.assertEqual(1, result.entry_count)
        self.assertEqual("", result.error)

    def test_rejects_a_parser_error(self) -> None:
        parsed = SimpleNamespace(
            status=200,
            href="https://example.com/feed.xml",
            bozo=True,
            bozo_exception=ValueError("malformed XML"),
            entries=[{"title": "Story"}],
        )

        result = verify_feed("Example", "https://example.com/feed.xml", lambda _: parsed)

        self.assertFalse(result.ok)
        self.assertEqual("malformed XML", result.error)

    def test_rejects_an_http_error_or_empty_feed(self) -> None:
        cases = (
            SimpleNamespace(status=403, href=None, bozo=False, entries=[]),
            SimpleNamespace(status=200, href=None, bozo=False, entries=[]),
        )

        for parsed in cases:
            with self.subTest(status=parsed.status):
                result = verify_feed(
                    "Example", "https://example.com/feed.xml", lambda _: parsed
                )
                self.assertFalse(result.ok)


class FeedIngestionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "news.db"
        self.db_path_patch = patch.object(db, "DB_PATH", self.db_path)
        self.db_path_patch.start()
        db.init_db()

    def tearDown(self) -> None:
        self.db_path_patch.stop()
        self.temp_dir.cleanup()

    def test_inserts_stub_rows_and_returns_only_new_article_ids(self) -> None:
        entry = {
            "link": "https://example.com/story",
            "title": " Example story ",
            "published_parsed": (2026, 7, 6, 14, 30, 0, 0, 0, 0),
            "summary": "Example excerpt",
        }
        parsed = SimpleNamespace(status=200, bozo=False, entries=[entry])

        with db.get_conn() as conn:
            conn.execute("UPDATE feeds SET enabled = 0")
            conn.execute("UPDATE feeds SET enabled = 1 WHERE id = 1")

            first_ids = fetch_all_feeds(conn, ["World"], lambda _: parsed, now=NOW)
            second_ids = fetch_all_feeds(conn, ["World"], lambda _: parsed, now=NOW)
            rows = conn.execute("SELECT * FROM articles").fetchall()

        self.assertEqual(1, len(first_ids))
        self.assertEqual([], second_ids)
        self.assertEqual(1, len(rows))
        article = rows[0]
        self.assertEqual(first_ids[0], article["id"])
        self.assertEqual(1, article["feed_id"])
        self.assertEqual("https://example.com/story", article["url"])
        self.assertEqual("Example story", article["title"])
        self.assertEqual("BBC World News", article["source"])
        self.assertEqual("World", article["category"])
        self.assertEqual("2026-07-06T14:30:00+00:00", article["published_at"])
        self.assertEqual("Example excerpt", article["raw_excerpt"])
        self.assertEqual(0, article["extraction_ok"])
        self.assertEqual("pending", article["summary_status"])
        self.assertIsNotNone(datetime.fromisoformat(article["fetched_at"]).tzinfo)

    def test_fetches_only_enabled_feeds(self) -> None:
        requested_urls: list[str] = []

        def parse(url: str) -> SimpleNamespace:
            requested_urls.append(url)
            return SimpleNamespace(status=200, bozo=False, entries=[])

        with db.get_conn() as conn:
            conn.execute("UPDATE feeds SET enabled = 0 WHERE id != 2")
            new_ids = fetch_all_feeds(conn, ["World"], parse, now=NOW)
            enabled_url = conn.execute(
                "SELECT url FROM feeds WHERE id = 2"
            ).fetchone()[0]

        self.assertEqual([], new_ids)
        self.assertEqual([enabled_url], requested_urls)

    def test_fetches_only_selected_categories_and_skips_empty_selection(self) -> None:
        requested_urls: list[str] = []

        def parse(url: str) -> SimpleNamespace:
            requested_urls.append(url)
            return SimpleNamespace(status=200, bozo=False, entries=[])

        with db.get_conn() as conn:
            empty_ids = fetch_all_feeds(conn, [], parse, now=NOW)
            tech_ids = fetch_all_feeds(conn, ["Tech"], parse, now=NOW)
            expected_urls = [
                row[0]
                for row in conn.execute(
                    "SELECT url FROM feeds WHERE category = 'Tech' ORDER BY id"
                )
            ]

        self.assertEqual([], empty_ids)
        self.assertEqual([], tech_ids)
        self.assertEqual(expected_urls, requested_urls)

    def test_feed_and_entry_failures_do_not_block_other_entries(self) -> None:
        valid_entry = {
            "link": "https://example.com/valid",
            "title": "Valid story",
        }
        responses = {
            db.STARTER_FEEDS[1][1]: SimpleNamespace(
                status=200,
                bozo=False,
                entries=[{"title": "Missing URL"}, valid_entry],
            )
        }

        def parse(url: str) -> SimpleNamespace:
            if url == db.STARTER_FEEDS[0][1]:
                raise OSError("network unavailable")
            return responses[url]

        with db.get_conn() as conn:
            conn.execute("UPDATE feeds SET enabled = 0 WHERE id > 2")
            with self.assertLogs("app.ingest.rss", level="WARNING") as logs:
                new_ids = fetch_all_feeds(conn, ["World"], parse, now=NOW)
            article = conn.execute(
                "SELECT source, category, published_at, raw_excerpt FROM articles"
            ).fetchone()

        self.assertEqual(1, len(new_ids))
        self.assertEqual(("NPR News", "World", None, ""), tuple(article))
        self.assertTrue(any("Failed to fetch RSS feed" in line for line in logs.output))
        self.assertTrue(any("without a URL or title" in line for line in logs.output))

    def test_http_error_does_not_insert_returned_entries(self) -> None:
        parsed = SimpleNamespace(
            status=403,
            bozo=True,
            entries=[{"link": "https://example.com/story", "title": "Story"}],
        )

        with db.get_conn() as conn:
            conn.execute("UPDATE feeds SET enabled = 0 WHERE id != 1")
            with self.assertLogs("app.ingest.rss", level="WARNING"):
                new_ids = fetch_all_feeds(
                    conn, ["World"], lambda _: parsed, now=NOW
                )
            article_count = conn.execute("SELECT COUNT(*) FROM articles").fetchone()[0]

        self.assertEqual([], new_ids)
        self.assertEqual(0, article_count)

    def test_skips_entries_older_than_the_recency_window(self) -> None:
        entries = [
            {
                "link": "https://example.com/stale",
                "title": "Stale story",
                "published_parsed": (2026, 7, 5, 11, 59, 0, 0, 0, 0),
            },
            {
                "link": "https://example.com/recent",
                "title": "Recent story",
                "published_parsed": (2026, 7, 5, 12, 1, 0, 0, 0, 0),
            },
            {
                "link": "https://example.com/undated",
                "title": "Undated story",
            },
        ]
        parsed = SimpleNamespace(status=200, bozo=False, entries=entries)

        with db.get_conn() as conn:
            conn.execute("UPDATE feeds SET enabled = 0 WHERE id != 1")
            new_ids = fetch_all_feeds(
                conn, ["World"], lambda _: parsed, now=NOW
            )
            urls = {
                row[0] for row in conn.execute("SELECT url FROM articles ORDER BY id")
            }

        self.assertEqual(2, len(new_ids))
        self.assertEqual(
            {"https://example.com/recent", "https://example.com/undated"},
            urls,
        )


if __name__ == "__main__":
    unittest.main()
