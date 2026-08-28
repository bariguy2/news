import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app import db
from app.main import app


class ApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "news.db"
        self.db_path_patch = patch.object(db, "DB_PATH", self.db_path)
        self.db_path_patch.start()
        db.init_db()

        self.scheduler = MagicMock()
        self.scheduler_patch = patch(
            "app.main.create_scheduler", return_value=self.scheduler
        )
        self.scheduler_patch.start()
        self.client = TestClient(app)
        self.client.__enter__()

    def tearDown(self) -> None:
        self.client.__exit__(None, None, None)
        self.scheduler_patch.stop()
        self.db_path_patch.stop()
        self.temp_dir.cleanup()

    def insert_article(
        self,
        slug: str,
        *,
        category: str,
        published_at: str | None,
        status: str = "done",
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
                    published_at,
                    fetched_at,
                    raw_excerpt,
                    extracted_text,
                    extraction_ok,
                    summary_facts,
                    summary_impact,
                    summary_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    feed_id,
                    f"https://example.com/{slug}",
                    f"Title {slug}",
                    f"Source {slug}",
                    category,
                    published_at,
                    "2026-07-06T00:00:00+00:00",
                    f"Excerpt {slug}",
                    f"Private extracted text {slug}",
                    1,
                    f"Facts {slug}",
                    f"Impact {slug}",
                    status,
                ),
            )
            return cursor.lastrowid

    def test_article_list_filters_orders_limits_and_omits_pipeline_fields(self) -> None:
        world_id = self.insert_article(
            "world", category="World", published_at="2026-07-01T12:00:00+00:00"
        )
        tech_id = self.insert_article(
            "tech", category="Tech", published_at="2026-07-03T12:00:00+00:00"
        )
        business_id = self.insert_article(
            "business",
            category="Business",
            published_at="2026-07-04T12:00:00+00:00",
        )
        self.insert_article(
            "pending",
            category="Tech",
            published_at="2026-07-05T12:00:00+00:00",
            status="pending",
        )

        response = self.client.get("/api/articles")

        self.assertEqual(200, response.status_code)
        articles = response.json()
        self.assertEqual([business_id, tech_id, world_id], [item["id"] for item in articles])
        self.assertEqual(
            {"id", "title", "source", "category", "published_at", "url"},
            set(articles[0]),
        )
        self.assertNotIn("summary_facts", articles[0])
        self.assertNotIn("summary_impact", articles[0])
        self.assertNotIn("extracted_text", articles[0])

        filtered = self.client.get(
            "/api/articles",
            params={"category": " Tech, World,Tech ", "limit": 1},
        )
        self.assertEqual(200, filtered.status_code)
        self.assertEqual([tech_id], [item["id"] for item in filtered.json()])

        invalid_limit = self.client.get("/api/articles", params={"limit": 0})
        self.assertEqual(422, invalid_limit.status_code)

    def test_article_detail_has_exact_public_fields_and_hides_full_text(self) -> None:
        article_id = self.insert_article(
            "detail", category="Science", published_at="2026-07-02T12:00:00+00:00"
        )

        response = self.client.get(f"/api/articles/{article_id}")

        self.assertEqual(200, response.status_code)
        article = response.json()
        self.assertEqual(
            {
                "id",
                "title",
                "source",
                "category",
                "published_at",
                "url",
                "summary_facts",
                "summary_impact",
            },
            set(article),
        )
        self.assertEqual("Facts detail", article["summary_facts"])
        self.assertEqual("Impact detail", article["summary_impact"])
        self.assertNotIn("extracted_text", article)
        self.assertNotIn("raw_excerpt", article)

    def test_article_list_defaults_to_fifty_rows(self) -> None:
        for index in range(51):
            self.insert_article(
                f"default-limit-{index}",
                category="Tech",
                published_at="2026-07-02T12:00:00+00:00",
            )

        response = self.client.get("/api/articles")

        self.assertEqual(200, response.status_code)
        self.assertEqual(50, len(response.json()))

    def test_article_detail_returns_404_for_missing_or_incomplete_article(self) -> None:
        pending_id = self.insert_article(
            "pending-detail",
            category="Tech",
            published_at="2026-07-02T12:00:00+00:00",
            status="pending",
        )

        for article_id in (pending_id, 999_999):
            with self.subTest(article_id=article_id):
                response = self.client.get(f"/api/articles/{article_id}")
                self.assertEqual(404, response.status_code)
                self.assertEqual({"detail": "Article not found"}, response.json())

    def test_categories_are_distinct_and_sorted(self) -> None:
        response = self.client.get("/api/categories")

        self.assertEqual(200, response.status_code)
        self.assertEqual(
            ["Business", "Science", "Sports", "Tech", "World"], response.json()
        )

    def test_preferences_get_post_and_persist(self) -> None:
        initial = self.client.get("/api/preferences")
        self.assertEqual(
            {"selected_categories": [], "onboarded": False}, initial.json()
        )

        with patch("app.routes.preferences.run_pipeline") as pipeline_mock:
            updated = self.client.post(
                "/api/preferences",
                json={"selected_categories": ["Tech", "Science"]},
            )

        self.assertEqual(200, updated.status_code)
        self.assertEqual(
            {"selected_categories": ["Tech", "Science"], "onboarded": True},
            updated.json(),
        )
        pipeline_mock.assert_called_once_with()
        self.assertEqual(updated.json(), self.client.get("/api/preferences").json())

        with db.get_conn() as conn:
            row = conn.execute(
                "SELECT selected_categories, onboarded FROM preferences WHERE id = 1"
            ).fetchone()
        self.assertEqual(["Tech", "Science"], json.loads(row["selected_categories"]))
        self.assertEqual(1, row["onboarded"])

        invalid = self.client.post(
            "/api/preferences", json={"selected_categories": "Tech"}
        )
        self.assertEqual(422, invalid.status_code)

    def test_cors_allows_only_vite_development_origin(self) -> None:
        allowed = self.client.options(
            "/api/preferences",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
            },
        )
        self.assertEqual(200, allowed.status_code)
        self.assertEqual(
            "http://localhost:5173",
            allowed.headers["access-control-allow-origin"],
        )

        disallowed = self.client.options(
            "/api/preferences",
            headers={
                "Origin": "http://example.com",
                "Access-Control-Request-Method": "POST",
            },
        )
        self.assertNotIn("access-control-allow-origin", disallowed.headers)


if __name__ == "__main__":
    unittest.main()
