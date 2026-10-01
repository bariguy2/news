"""RSS feed verification and deduplicating article ingestion."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import logging
from typing import Any

import feedparser

from app.config import RECENCY_WINDOW_HOURS
from app.db import STARTER_FEEDS, DatabaseConnection


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class FeedVerification:
    """Observable result of checking one live RSS feed."""

    name: str
    url: str
    status: int | None
    final_url: str | None
    bozo: bool
    entry_count: int
    error: str

    @property
    def ok(self) -> bool:
        """Return whether the response is a usable, well-formed HTTP feed."""
        return (
            self.status is not None
            and 200 <= self.status < 400
            and not self.bozo
            and self.entry_count > 0
        )


def verify_feed(
    name: str,
    url: str,
    parse: Callable[[str], Any] = feedparser.parse,
) -> FeedVerification:
    """Fetch and inspect one feed without writing anything to the database."""
    parsed = parse(url)
    return FeedVerification(
        name=name,
        url=url,
        status=getattr(parsed, "status", None),
        final_url=getattr(parsed, "href", None),
        bozo=bool(parsed.bozo),
        entry_count=len(parsed.entries),
        error=str(getattr(parsed, "bozo_exception", "")),
    )


def _published_at(entry: Any) -> str | None:
    """Convert feedparser's UTC time tuple to an ISO-8601 string."""
    published = entry.get("published_parsed")
    if not published:
        return None

    try:
        return datetime(*published[:6], tzinfo=UTC).isoformat()
    except (TypeError, ValueError):
        logger.warning("Ignoring invalid published time for entry %r", entry.get("link"))
        return None


def fetch_all_feeds(
    conn: DatabaseConnection,
    categories: list[str],
    parse: Callable[[str], Any] = feedparser.parse,
    *,
    now: datetime | None = None,
) -> list[int]:
    """Insert recent entries from selected enabled feeds and return their IDs.

    The caller owns the transaction. Feed request failures and malformed entries
    are logged and skipped so one source cannot prevent other feeds from being
    ingested.
    """
    selected_categories = list(dict.fromkeys(categories))
    if not selected_categories:
        return []

    placeholders = ", ".join("?" for _ in selected_categories)
    feeds = conn.execute(
        f"""
        SELECT id, name, url, category
        FROM feeds
        WHERE enabled = 1 AND category IN ({placeholders})
        ORDER BY id
        """,
        selected_categories,
    ).fetchall()
    reference_time = (now or datetime.now(UTC)).astimezone(UTC)
    recency_cutoff = reference_time - timedelta(hours=RECENCY_WINDOW_HOURS)
    fetched_at = reference_time.isoformat()
    new_article_ids: list[int] = []

    for feed in feeds:
        try:
            parsed = parse(feed["url"])
        except Exception:
            logger.exception("Failed to fetch RSS feed %s", feed["name"])
            continue

        status = getattr(parsed, "status", None)
        if status is not None and not 200 <= status < 400:
            logger.warning(
                "Skipping RSS feed %s after HTTP status %s", feed["name"], status
            )
            continue

        if bool(getattr(parsed, "bozo", False)):
            logger.warning(
                "RSS feed %s reported a parser error: %s",
                feed["name"],
                getattr(parsed, "bozo_exception", "unknown parser error"),
            )

        for entry in getattr(parsed, "entries", ()):  # Keep usable partial feeds.
            url = str(entry.get("link") or "").strip()
            title = str(entry.get("title") or "").strip()
            if not url or not title:
                logger.warning(
                    "Skipping entry without a URL or title from feed %s", feed["name"]
                )
                continue

            published_at = _published_at(entry)
            if (
                published_at is not None
                and datetime.fromisoformat(published_at) < recency_cutoff
            ):
                logger.info("Skipping stale RSS entry %s", url)
                continue

            inserted = conn.execute(
                """
                INSERT INTO articles (
                    feed_id,
                    url,
                    title,
                    source,
                    category,
                    published_at,
                    fetched_at,
                    raw_excerpt
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(url) DO NOTHING
                RETURNING id
                """,
                (
                    feed["id"],
                    url,
                    title,
                    feed["name"],
                    feed["category"],
                    published_at,
                    fetched_at,
                    entry.get("summary", "") or "",
                ),
            )
            row = inserted.fetchone()
            if row is not None:
                new_article_ids.append(row["id"])

    return new_article_ids


def main() -> int:
    """Verify all starter feeds and return a shell-friendly status code."""
    all_ok = True
    for name, url, _category in STARTER_FEEDS:
        result = verify_feed(name, url)
        outcome = "PASS" if result.ok else "FAIL"
        details = (
            f"status={result.status} entries={result.entry_count} "
            f"bozo={result.bozo} final_url={result.final_url}"
        )
        if result.error:
            details = f"{details} error={result.error}"
        print(f"{outcome} {result.name}: {details}")
        all_ok = all_ok and result.ok

    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
