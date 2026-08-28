"""Isolated real API server used by the frontend Playwright flow."""

from contextlib import asynccontextmanager
import os
from pathlib import Path
import sys
import tempfile

import uvicorn


BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app import db  # noqa: E402


TEMP_DIR = tempfile.TemporaryDirectory()
db.DB_PATH = Path(TEMP_DIR.name) / "news.db"
db.init_db()

with db.get_conn() as conn:
    feed_id = conn.execute("SELECT id FROM feeds ORDER BY id LIMIT 1").fetchone()[0]
    conn.executemany(
        """
        INSERT INTO articles (
            id, feed_id, url, title, source, category, published_at, fetched_at,
            raw_excerpt, extracted_text, extraction_ok, summary_facts,
            summary_impact, summary_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'done')
        """,
        (
            (
                1,
                feed_id,
                "https://example.com/original-story",
                "Browser-tested technology story",
                "Browser Source",
                "Tech",
                "2026-07-06T10:00:00+00:00",
                "2026-07-06T10:00:00+00:00",
                "Private excerpt",
                "Private full text",
                1,
                "The verified facts are visible in the browser.",
                "The impact explanation is visually distinct and available.",
            ),
            (
                2,
                feed_id,
                "https://example.com/world-story",
                "Filtered world story",
                "Another Source",
                "World",
                "2026-07-05T10:00:00+00:00",
                "2026-07-05T10:00:00+00:00",
                "Private excerpt",
                "Private full text",
                1,
                "World facts.",
                "World impact.",
            ),
        ),
    )

from app.main import app  # noqa: E402
from app.routes import preferences as preferences_routes  # noqa: E402


preferences_routes.run_pipeline = lambda: None


@asynccontextmanager
async def isolated_lifespan(_app):
    db.init_db()
    yield


app.router.lifespan_context = isolated_lifespan


if __name__ == "__main__":
    port = int(os.environ.get("NEWS_E2E_BACKEND_PORT", "8000"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
