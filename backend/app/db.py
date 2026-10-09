"""Local SQLite or hosted PostgreSQL connection and initialization helpers."""

import sqlite3
from pathlib import Path

import psycopg
from psycopg.conninfo import conninfo_to_dict
from psycopg.rows import dict_row

from app.config import DATABASE_URL, DB_PATH


SCHEMA_PATH = Path(__file__).with_name("schema.sql")
POSTGRES_SCHEMA_PATH = Path(__file__).with_name("schema_postgres.sql")

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


class ClosingConnection(sqlite3.Connection):
    """Finish the transaction and release the file on context exit."""

    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


class PostgresConnection:
    """Keep the existing positional-query interface across both databases."""

    def __init__(self, connection: psycopg.Connection):
        self.connection = connection

    def __enter__(self):
        self.connection.__enter__()
        return self

    def __exit__(self, *args):
        return self.connection.__exit__(*args)

    def execute(self, query: str, parameters=()):
        # Application queries use ? bind markers; psycopg expects %s.
        return self.connection.execute(query.replace("?", "%s"), parameters)

    def commit(self):
        self.connection.commit()


DatabaseConnection = sqlite3.Connection | PostgresConnection


def get_conn() -> DatabaseConnection:
    """Open the selected database with rows addressable by column name."""
    if DATABASE_URL:
        options = conninfo_to_dict(DATABASE_URL)
        options.setdefault("sslmode", "require")
        options.setdefault("connect_timeout", "10")
        connection = psycopg.connect(
            **options,
            row_factory=dict_row,
        )
        try:
            # The private schema is not exposed by Supabase's Data API.
            connection.execute("SET search_path TO news, public")
        except BaseException:
            connection.close()
            raise
        return PostgresConnection(connection)

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, factory=ClosingConnection)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    """Create the schema and insert required single-user defaults."""
    with get_conn() as conn:
        if DATABASE_URL:
            schema = POSTGRES_SCHEMA_PATH.read_text(encoding="utf-8")
            for statement in schema.split(";"):
                if statement.strip():
                    conn.execute(statement)
        else:
            conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
            columns = {row["name"] for row in conn.execute("PRAGMA table_info(articles)")}
            if "read_at" not in columns:
                conn.execute("ALTER TABLE articles ADD COLUMN read_at TEXT")

        for feed in STARTER_FEEDS:
            conn.execute(
                """
                INSERT INTO feeds (name, url, category)
                VALUES (?, ?, ?)
                ON CONFLICT(url) DO NOTHING
                """,
                feed,
            )
        conn.execute(
            """
            INSERT INTO preferences (
                id, selected_categories, onboarded
            ) VALUES (1, '[]', 0)
            ON CONFLICT(id) DO NOTHING
            """
        )
