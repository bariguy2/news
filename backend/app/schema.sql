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
    summary_status TEXT NOT NULL DEFAULT 'pending',  -- unrequested|pending|done|failed
    read_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);

CREATE TABLE IF NOT EXISTS preferences (
    id INTEGER PRIMARY KEY CHECK (id = 1),   -- single-row table
    selected_categories TEXT NOT NULL,        -- JSON array string
    onboarded INTEGER NOT NULL DEFAULT 0
);

-- Retained across feed purges/resets for attribution and future feedback.
CREATE TABLE IF NOT EXISTS summary_versions (
    id TEXT PRIMARY KEY,
    article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
    article_url TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    input_hash TEXT,
    facts TEXT NOT NULL,
    impact TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_summary_versions_article ON summary_versions(article_id);

-- Usage is independent of article retention. Amounts are integer nanodollars.
CREATE TABLE IF NOT EXISTS ai_budgets (
    period TEXT NOT NULL,
    scope TEXT NOT NULL,
    used_nano BIGINT NOT NULL DEFAULT 0 CHECK (used_nano >= 0),
    PRIMARY KEY (period, scope)
);
CREATE TABLE IF NOT EXISTS ai_attempts (
    id TEXT PRIMARY KEY,
    period TEXT NOT NULL,
    scope TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    input_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    reserved_nano BIGINT NOT NULL,
    charged_nano BIGINT NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    reasoning_tokens INTEGER,
    estimated INTEGER NOT NULL DEFAULT 1,
    elapsed_ms INTEGER,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_attempts_period ON ai_attempts(period, scope);
