"""SQLite connection and initialization helpers."""

import sqlite3
from pathlib import Path

from app.config import DB_PATH


SCHEMA_PATH = Path(__file__).with_name("schema.sql")

STARTER_FEEDS = (
    ("BBC World News", "http://feeds.bbci.co.uk/news/world/rss.xml", "World"),
    ("NPR News", "https://feeds.npr.org/1001/rss.xml", "World"),
    ("TechCrunch", "https://techcrunch.com/feed/", "Tech"),
    ("Ars Technica", "https://feeds.arstechnica.com/arstechnica/index", "Tech"),
    ("The Verge", "https://www.theverge.com/rss/index.xml", "Tech"),
    ("ESPN Top Headlines", "https://www.espn.com/espn/rss/news", "Sports"),
    ("CNBC Business", "https://www.cnbc.com/id/10001147/device/rss/rss.html", "Business"),
    ("NASA Breaking News", "https://www.nasa.gov/news-release/feed/", "Science"),
)


def get_conn() -> sqlite3.Connection:
    """Open the application database with named-row and FK support enabled."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    """Create the schema and insert required single-user defaults."""
    schema = SCHEMA_PATH.read_text(encoding="utf-8")

    with get_conn() as conn:
        conn.executescript(schema)
        conn.executemany(
            """
            INSERT OR IGNORE INTO feeds (name, url, category)
            VALUES (?, ?, ?)
            """,
            STARTER_FEEDS,
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO preferences (
                id, selected_categories, onboarded
            ) VALUES (1, '[]', 0)
            """
        )
