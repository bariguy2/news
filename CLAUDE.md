# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Communication style

When explaining how something works (a bug, a feature, a workflow), default to plain, concise English — the user cannot read code. Do not paste or narrate code as the explanation. Instead, describe what happens in plain terms and say where in the pipeline it happens (e.g. "during summarization, before the result is saved to the database" rather than quoting the function). Only show actual code when the user explicitly asks for it.

## Project state

The MVP is fully built and runnable: a FastAPI backend (`backend/`), a Vite/React frontend (`frontend/`), launch/reset shell scripts (`scripts/`), and backend + frontend + end-to-end tests all exist and are verified. The `docs/plan_*.md` files are now **historical design docs**, not TODO lists — `plan_mvp.md` covers the original build, `plan_launch_UI.md` covers `scripts/start.sh`, `plan_reset_feed.md` covers `scripts/reset-feed.sh`, and `plan_pipeline_scoping.md` covers the selected-category/48-hour pipeline optimization. This file (CLAUDE.md) is the living summary; if it ever disagrees with the code, correct this file to match the code.

## What this is

A personal, local prototype of a Google-News-style aggregator: RSS headlines get an AI-generated two-part summary (neutral facts, then an opinionated "impact" paragraph) via a local LLM, with a link out to the original source. Single-user, no auth, runs on localhost on a Mac mini — not a production system.

## Architecture

| Area | Decision | Why |
|---|---|---|
| Backend | Python 3.12 (pinned via `uv`) + FastAPI + Uvicorn | Best ecosystem fit for Ollama/feedparser/trafilatura; `uv` avoids system Python issues |
| Frontend | React + Vite + `react-router-dom` (3 routes: `/onboarding`, `/feed`, `/article/:id`) | Minimal deps; `fetch`/`useState`/`useEffect` is enough at this scope |
| Storage | Plain `sqlite3` (stdlib) + hand-written `schema.sql`, no ORM | Single-file DB is enough for one user |
| LLM | Ollama, `llama3.1:8b` locally (fallback `qwen2.5:7b-instruct`) | Fits in 16GB unified memory. `MODEL_NAME` in `config.py` is the single swap point for a future Claude API migration — keep this seam intact |
| Summary format | Plain-text section markers (`===FACTS===` / `===IMPACT===`), not JSON | Small local models are far more reliable at repeating literal delimiters than producing valid JSON |
| Full article text | Scrape via `trafilatura`, fallback to RSS excerpt on failure | `extracted_text` is LLM input only — **never** exposed via any API route |
| Scheduling | `APScheduler` `BackgroundScheduler` in FastAPI lifespan, interval job (30 min) + preference/manual triggers | No Celery/Redis needed for a single local process |

### Pipeline flow

`ingest (RSS) → extract (full text) → summarize (Ollama) → store (sqlite)`, orchestrated by `run_pipeline()` in `scheduler.py`. Each cycle reads the current preferences, purges stories older than 48 hours, ingests only selected categories, and processes their pending stories newest-first with up to three database-free workers. SQLite writes stay on the coordinator thread and commit per article so partial progress survives crashes. A refresh received during active work queues a complete rerun with freshly-read preferences. Network/extraction/LLM failures must never crash the pipeline — they set `summary_status='failed'` and the article is excluded from the feed.

### Directory layout

```
news/
  backend/
    app/
      main.py              # FastAPI app, lifespan startup/shutdown, CORS
      config.py             # model, paths, recency/concurrency, origins
      db.py                 # get_conn(), init_db()
      schema.sql
      ingest/rss.py
      ingest/extract.py
      summarize/prompt.py
      summarize/ollama_client.py
      scheduler.py
      routes/articles.py
      routes/preferences.py
      routes/admin.py       # /api/refresh
    tests/                  # unittest suite (test_*.py) + e2e_server.py
    pyproject.toml          # deps managed by uv (uv.lock committed)
  frontend/
    src/pages/Onboarding.jsx
    src/pages/Feed.jsx
    src/pages/Detail.jsx
    src/api.js
    src/*.test.jsx          # Vitest component tests
    e2e/news-flow.spec.js   # Playwright end-to-end test
  scripts/
    start.sh                # launch/bounce backend + frontend (+ Ollama if down)
    reset-feed.sh           # wipe DB + preferences, relaunch, trigger refresh
  data/news.db               # gitignored
```

### Data model (`backend/app/schema.sql`)

- `feeds` — curated RSS sources with a `category`.
- `articles` — one row per story, deduped on `url` (`UNIQUE`). Tracks both ingestion (`raw_excerpt`, `extracted_text`, `extraction_ok`) and summarization (`summary_facts`, `summary_impact`, `summary_status`: `pending|done|failed`).
- `preferences` — single-row table (`id=1` check constraint) holding `selected_categories` (JSON array string) and `onboarded` flag.

### API surface

- `GET /api/articles?category=Tech,World&limit=50` — headline list only (`summary_status='done'`), **no summary fields**.
- `GET /api/articles/{id}` — full detail including `summary_facts`/`summary_impact`; 404 if missing or not `done`.
- `GET /api/categories`, `GET /api/preferences`, `POST /api/preferences`, `POST /api/refresh`. Saving preferences queues an immediate pipeline run.

The feed silently polls every five seconds while empty and every fifteen seconds
after stories appear, so summaries become visible without a manual reload.

Keep this API client-agnostic (no server-rendered assumptions) since a mobile client is expected to reuse it later.

## Commands

```bash
# One-time setup
brew install uv ollama
ollama pull llama3.1:8b
cd backend && uv sync                       # creates .venv from pyproject/uv.lock
cd ../frontend && npm install && cp .env.example .env

# Run everything (launches/bounces backend + frontend, starts Ollama if down)
./scripts/start.sh                          # prints http://localhost:5173 when ready
./scripts/reset-feed.sh                     # destructive: wipe DB + prefs, relaunch at onboarding

# Manual run (three terminals) — use this dev path when you need --reload
cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000
cd frontend && npm run dev                  # port 5173, reads VITE_API_BASE from frontend/.env

# Manually trigger the ingest/summarize pipeline instead of waiting up to 30 min
curl -X POST http://localhost:8000/api/refresh

# Inspect the DB directly
sqlite3 data/news.db ".tables"

# Tests
cd backend && .venv/bin/python -m unittest discover -s tests -v
cd frontend && npm test                     # Vitest components
cd frontend && npm run build                # production build check
cd frontend && npm run test:e2e             # Playwright end-to-end (isolated API + Vite, real Chrome)
# If the default app ports are occupied:
NEWS_E2E_BACKEND_PORT=18000 NEWS_E2E_FRONTEND_PORT=15173 npm run test:e2e
```

`ollama serve` must be running before backend startup — `scripts/start.sh` handles this automatically; for the manual path start it yourself (menubar app or `ollama serve &`).

## Out of scope for v1

Auth/multi-user, cloud deployment/Docker/HTTPS, ML-based personalization beyond category filtering, cross-source story clustering/dedup, article images/thumbnails, the mobile app itself. Do not add these speculatively.

## Testing discipline

Verify each change end-to-end as you make it, not at the end. `docs/plan_mvp.md` has an explicit Verification Checklist section that still applies to the core pipeline; use it as a reference. Concretely, before considering a change done:

- New route → hit it (`curl`) and confirm the response shape matches what's documented here (e.g. `/api/articles` omits summary fields, `/api/articles/{id}` includes them).
- New pipeline stage (ingest/extract/summarize) → run it against real feeds/articles and inspect the DB row it produced (`sqlite3 data/news.db`), not just that it didn't throw.
- New frontend screen → load it in the browser and click through the actual flow (onboarding → feed → detail), not just that it compiles.
- Failure paths called out in the plan (bad feed URL, extraction failure, missing Ollama, malformed model output) should be exercised at least once, since the pipeline is designed to degrade per-article rather than crash — confirm it actually does.

## Keeping this file current

This file must evolve with the project instead of drifting out of date:

- When you change the code (architecture, directory layout, data model, API surface, commands), update the corresponding section here in the same change so this file keeps matching reality — note any deviations and why.
- Treat the `docs/plan_*.md` files as historical design docs and this file as the living summary — if they ever disagree about current reality, this file should be corrected to match the code, not the plan.
