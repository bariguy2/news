"""Immutable published summary versions; article deletion retains history."""

from datetime import UTC, datetime
from uuid import uuid4


def save_version(conn, article_id, url, facts, impact, *, provider, model, prompt_version, input_hash=None):
    version_id = str(uuid4())
    conn.execute(
        """INSERT INTO summary_versions
        (id, article_id, article_url, provider, model, prompt_version, input_hash, facts, impact, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (version_id, article_id, url, provider, model, prompt_version, input_hash, facts, impact,
         datetime.now(UTC).isoformat()),
    )
    conn.execute("UPDATE articles SET summary_version_id = ? WHERE id = ?", (version_id, article_id))
    return version_id


def preserve_legacy(conn):
    rows = conn.execute("""SELECT id FROM articles WHERE summary_version_id IS NULL
        AND summary_facts IS NOT NULL AND summary_impact IS NOT NULL""").fetchall()
    for row in rows:
        claimed = conn.execute("""UPDATE articles SET summary_version_id = 'migrating'
            WHERE id = ? AND summary_version_id IS NULL RETURNING id, url, summary_facts, summary_impact""",
            (row['id'],)).fetchone()
        if claimed:
            save_version(conn, claimed['id'], claimed['url'], claimed['summary_facts'], claimed['summary_impact'],
                         provider='legacy', model='unknown', prompt_version='legacy')
