# News Aggregator Prototype — Implementation Plan

## Context

The goal is a personal, local prototype of a Google-News-style aggregator: instead of full articles, each item gets an AI-generated two-part summary (facts/evidence, then an opinionated "impact" paragraph), with a link out to the original source. A one-time onboarding questionnaire captures category interests (Tech, World, Sports, etc.) used to filter the main feed. Tapping a headline opens a detail view with the full summary and a link to the original article.

Constraints locked in during discussion: web app now (backend must be a clean REST API so a mobile client can reuse it later); single-user, no auth, runs on localhost on the user's Mac mini (M2 Pro, 16GB RAM); ~5-10 curated RSS feeds instead of a paid news API; summarization via a **local** Ollama model to avoid API billing (explicitly deferred, not ruled out — the code should keep this swap cheap); personalization is simple category-tag filtering only for v1. Simplicity is the priority — this is a prototype, not a production system, so we avoid ORMs, auth, and deployment infra.

The existing repo (`/Users/tonychung/Developer/personal/news`, github.com/bariguy2/news) currently contains only a README — this is a from-scratch build.

**Environment check performed**: default `python3` is 3.14.6 (very new — risks missing prebuilt wheels for `trafilatura`/`lxml`); no `pyenv`/`uv` installed yet; `ollama` not installed; Homebrew present; Node v26.4/npm 11.17 already current (no frontend tooling changes needed).

---

## Architecture Decisions

| Area | Decision | Why |
|---|---|---|
| Backend | Python 3.12 (pinned via `uv`) + FastAPI + Uvicorn | Best ecosystem fit for Ollama/feedparser/trafilatura; `uv` sidesteps the Python 3.14 wheel risk in one step (no pyenv, no system Python changes) |
| Frontend | React + Vite + `react-router-dom` (2 routes) | Minimal deps; `fetch`/`useState`/`useEffect` is enough at this scope |
| Storage | Plain `sqlite3` (stdlib) + hand-written `schema.sql`, no ORM | Single-file DB is enough for one user; ORM would be unused complexity |
| LLM | Ollama, `llama3.1:8b` locally | Fits in 16GB unified memory; good instruction-following. Fallback if quality/speed disappoints: `qwen2.5:7b-instruct`. Swap point is a single constant. |
| Summary format | Plain-text section markers (`===FACTS===` / `===IMPACT===`), not JSON | Small local models are far more reliable at repeating literal delimiters than producing valid JSON |
| Full article text | Scrape via `trafilatura`, fallback to RSS excerpt on failure | RSS snippets (1-2 sentences) are too thin to ground factual, evidence-backed summaries. Extracted text is only ever used as LLM input — never exposed via the API (no full-text republishing) |
| Scheduling | `APScheduler` `BackgroundScheduler` started in FastAPI lifespan, interval job (default 30 min) + manual `POST /api/refresh` | No Celery/Redis needed for a single local process |

---

## Step-by-Step Plan

### Step 0 — Repo scaffold & environment setup
**Objective**: Get a working toolchain without touching system Python, and get Ollama running with a pulled model.

- `brew install uv` — manages an isolated, pinned Python per project regardless of system Python.
- `brew install ollama`, then `ollama pull llama3.1:8b`; sanity check with `ollama run llama3.1:8b "say hi"` (expect several seconds of latency on CPU/GPU — fine for a background job).
- Backend: `cd news/backend && uv venv --python 3.12 && source .venv/bin/activate && uv pip install fastapi "uvicorn[standard]" feedparser trafilatura apscheduler ollama`.
- Frontend: `npm create vite@latest frontend -- --template react && cd frontend && npm install react-router-dom`.
- `.gitignore`: `.venv/`, `node_modules/`, `data/*.db`, `__pycache__/`.
- Directory layout:
```
news/
  backend/
    app/
      main.py            # FastAPI app, lifespan startup/shutdown
      config.py           # MODEL_NAME, DB_PATH, refresh interval
      db.py               # get_conn(), init_db()
      schema.sql
      ingest/rss.py
      ingest/extract.py
      summarize/prompt.py
      summarize/ollama_client.py
      scheduler.py
      routes/articles.py
      routes/preferences.py
      routes/admin.py     # /api/refresh
    requirements.txt (or pyproject.toml via uv)
  frontend/
    src/pages/Onboarding.jsx
    src/pages/Feed.jsx
    src/pages/Detail.jsx
    src/api.js
  data/news.db            # gitignored
```

### Step 1 — Database schema (`backend/app/schema.sql`)
**Objective**: Minimal schema supporting dedup, categorization, and preferences.

```sql
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
    summary_status TEXT NOT NULL DEFAULT 'pending'  -- pending|done|failed
);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);

CREATE TABLE IF NOT EXISTS preferences (
    id INTEGER PRIMARY KEY CHECK (id = 1),   -- single-row table
    selected_categories TEXT NOT NULL,        -- JSON array string
    onboarded INTEGER NOT NULL DEFAULT 0
);
```

`db.py`: `get_conn()` opens sqlite3 with `row_factory = sqlite3.Row`; `init_db()` runs `schema.sql` via `executescript` and seeds the `feeds` table + a default `preferences` row (both via `INSERT OR IGNORE`), called once at FastAPI startup.

### Step 2 — Starter feed list (seeded at startup)
| Name | Category | URL |
|---|---|---|
| BBC World News | World | `http://feeds.bbci.co.uk/news/world/rss.xml` |
| NPR News | World | `https://feeds.npr.org/1001/rss.xml` |
| TechCrunch | Tech | `https://techcrunch.com/feed/` |
| Ars Technica | Tech | `https://feeds.arstechnica.com/arstechnica/index` |
| The Verge | Tech | `https://www.theverge.com/rss/index.xml` |
| ESPN Top Headlines | Sports | `https://www.espn.com/espn/rss/news` |
| CNBC Business | Business | `https://www.cnbc.com/id/10001147/device/rss/rss.html` |
| NASA Breaking News | Science | `https://www.nasa.gov/news-release/feed/` |

**Verify each URL is reachable during implementation** (`feedparser.parse(url)`, check `.bozo`/HTTP status) — feed URLs drift over time and some 403 non-browser user agents (set `feedparser.USER_AGENT` if needed).

### Step 3 — RSS ingestion (`backend/app/ingest/rss.py`)
**Objective**: Pull new entries, insert stub rows, skip duplicates.

`fetch_all_feeds(conn) -> list[int]`: for each enabled feed, `feedparser.parse(feed.url)`; for each entry derive `url=entry.link`, `title=entry.title`, `published_at` from `entry.published_parsed`, `raw_excerpt=entry.get('summary', '')`; `INSERT OR IGNORE ... VALUES (...)` relying on `UNIQUE(url)` for dedup; check `cursor.rowcount` to collect newly-inserted IDs (only these get processed further).

### Step 4 — Full-text extraction (`backend/app/ingest/extract.py`)
**Objective**: Give the LLM enough real content to produce evidence-backed summaries.

`extract_full_text(url) -> tuple[str | None, bool]`: `trafilatura.fetch_url(url)` then `trafilatura.extract(downloaded, include_comments=False, favor_recall=True)`; if `None` or under ~200 chars, return `(None, False)`. Wrap in `try/except` — network errors/paywalls/timeouts must never crash the pipeline, just log and fall back. Summarization input = `extracted_text if extraction_ok else raw_excerpt`. `extracted_text` is stored for pipeline use only — never returned by any API route.

### Step 5 — Summarization (`backend/app/summarize/prompt.py`, `ollama_client.py`)
**Objective**: Reliably produce a two-part summary from a local 8B model.

Prompt instructs the model to respond in exactly this format:
```
===FACTS===
<3-5 sentences: who/what, key numbers, credible evidence, neutral tone>

===IMPACT===
<one paragraph: your opinion on this event's broader significance/impact>
```
Truncate input text to ~6000 chars before prompting (keeps it fast on CPU/GPU). Call via `ollama.chat(model=MODEL_NAME, messages=[...], options={"temperature": 0.3})`. Parse with a regex split on the `===IMPACT===` marker; trim both halves. If markers are missing, retry once with a reminder appended to the prompt; if it still fails, set `summary_status='failed'` and exclude that article from the feed (simplest failure UX for v1). `MODEL_NAME` lives in `config.py` as the single swap point for a future Claude API migration.

### Step 6 — Pipeline orchestration (`backend/app/scheduler.py`)
**Objective**: Chain ingest → extract → summarize → store, on a schedule and on demand.

`run_pipeline()`: fetch new articles, then for every article with `summary_status='pending'` (covers new ones plus any left over from a crashed prior run): extract full text, summarize, update DB, `commit()` per-article so partial progress survives crashes. Log fetched/summarized/failed counts.

Wire into FastAPI `lifespan`: on startup call `init_db()`, seed feeds, start `BackgroundScheduler` with `add_job(run_pipeline, 'interval', minutes=30, next_run_time=datetime.now())`; on shutdown call `scheduler.shutdown()`. Add `POST /api/refresh` (in `routes/admin.py`) that triggers `run_pipeline` via FastAPI `BackgroundTasks` for instant dev-time testing instead of waiting up to 30 minutes.

### Step 7 — FastAPI routes (`backend/app/routes/*.py`)
**Objective**: Clean REST surface, reusable by a future mobile client.

- `GET /api/articles?category=Tech,World&limit=50` → list of `{id, title, source, category, published_at, url}` where `summary_status='done'`, ordered by `published_at DESC`. **No summary fields** — feed shows headlines only.
- `GET /api/articles/{id}` → `{id, title, source, category, published_at, url, summary_facts, summary_impact}`; 404 if missing or not `done`.
- `GET /api/categories` → distinct categories from `feeds` (drives onboarding checkboxes dynamically).
- `GET /api/preferences` → `{onboarded, selected_categories}`.
- `POST /api/preferences` → body `{selected_categories}`, upserts the single row, sets `onboarded=1`.
- `POST /api/refresh` → triggers pipeline in background, returns `{status: "started"}`.
- `CORSMiddleware` allowing `http://localhost:5173` (Vite dev origin).

### Step 8 — Onboarding screen (`frontend/src/pages/Onboarding.jsx`)
**Objective**: First-launch category picker.

On app mount, `GET /api/preferences`; if `onboarded === false`, route to `/onboarding`, else `/feed`. Onboarding fetches `/api/categories`, renders checkboxes, on submit `POST /api/preferences`, navigates to `/feed`.

### Step 9 — Feed screen (`frontend/src/pages/Feed.jsx`)
**Objective**: Headline-list view like Google News.

Fetch preferences to get `selected_categories`, then `GET /api/articles?category=<joined>`. Render cards (title, source, category badge, relative time via `Intl.RelativeTimeFormat` — no extra date library). Click → `navigate('/article/:id')`.

### Step 10 — Detail screen (`frontend/src/pages/Detail.jsx`)
**Objective**: Full summary + link to source.

`GET /api/articles/{id}` on mount via `useParams()`. Render title/source/category/time, `summary_facts` paragraph, a visually distinct "Why it matters" block for `summary_impact`, and a prominent `<a href={url} target="_blank" rel="noopener noreferrer">Read full article at {source}</a>`.

### Step 11 — Local dev wiring
- Ensure `ollama serve` is running (menubar app or `ollama serve &`) before backend startup.
- Backend: `cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8000`.
- Frontend: `cd frontend && npm run dev` (port 5173); `VITE_API_BASE=http://localhost:8000` in `frontend/.env`, read from `src/api.js`.
- Update root `README.md` with the three-process run instructions and a note that the first pipeline run may take several minutes to summarize the initial batch on an 8B local model.

---

## Explicitly Out of Scope for v1
Authentication/multi-user; cloud deployment/Docker/HTTPS; swapping Ollama for the Claude API (only keep `MODEL_NAME`/client as an easy seam); ML-based personalization beyond category filtering; cross-source story clustering/dedup; article images/thumbnails; the mobile app itself (API is just kept client-agnostic).

---

## Critical Files
- `backend/app/schema.sql` — data model
- `backend/app/summarize/prompt.py`, `backend/app/summarize/ollama_client.py` — summary generation
- `backend/app/scheduler.py` — pipeline orchestration
- `backend/app/main.py` — app wiring, lifespan, CORS
- `frontend/src/pages/{Onboarding,Feed,Detail}.jsx` — the three screens

---

## Verification Checklist
1. `ollama list` shows the pulled model; `ollama run` answers a test prompt.
2. Backend startup creates `data/news.db` with all tables (`sqlite3 data/news.db ".tables"`); `feeds` table has 6-8 seeded rows.
3. Each feed URL is reachable via `feedparser.parse` (`.bozo == False` or acceptable status).
4. `POST /api/refresh` → backend logs show fetch/extract/summarize counts > 0; spot-check a few rows have non-empty `summary_facts`/`summary_impact`.
5. `GET /api/articles` omits summary fields; `GET /api/articles/{id}` includes both summary fields.
6. Fresh browser session → onboarding shown first → select categories → redirected to feed filtered accordingly → click a card → detail view shows both summary parts and a working outbound link opening the original article in a new tab.
7. Restart the backend process — scheduler resumes without re-summarizing already-`done` articles (idempotent via `summary_status`).
8. Stop Ollama mid-run — pipeline logs per-article failures (`summary_status='failed'`) without crashing the FastAPI process.
