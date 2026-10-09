CREATE TABLE IF NOT EXISTS feeds (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY,
    feed_id INTEGER NOT NULL REFERENCES feeds(id),
    url TEXT NOT NULL UNIQUE,          -- dedup key
    title TEXT NOT NULL,
    source TEXT NOT NULL,
    category TEXT NOT NULL,            -- denormalized from feed at ingest time
    published_at TEXT,
    fetched_at TEXT NOT NULL,
    raw_excerpt TEXT,
    extracted_text TEXT,
    extraction_ok INTEGER NOT NULL DEFAULT 0,
    summary_facts TEXT,
    summary_impact TEXT,
    summary_status TEXT NOT NULL DEFAULT 'pending'  -- unrequested|pending|done|failed
);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);

CREATE TABLE IF NOT EXISTS preferences (
    id INTEGER PRIMARY KEY CHECK (id = 1),   -- single-row table
    selected_categories TEXT NOT NULL,        -- JSON array string
    onboarded INTEGER NOT NULL DEFAULT 0
);
