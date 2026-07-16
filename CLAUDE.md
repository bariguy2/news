# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Communication style

When explaining how something works (a bug, a feature, a workflow), default to plain, concise English — the user cannot read code. Do not paste or narrate code as the explanation. Instead, describe what happens in plain terms and say where in the pipeline it happens (e.g. "during summarization, before the result is saved to the database" rather than quoting the function). Only show actual code when the user explicitly asks for it.

## Project state

This repository currently contains only planning docs (`README.md`, `docs/plan_mvp.md`) — no backend or frontend code has been written yet. **`docs/plan_mvp.md` is the authoritative implementation plan** and should be read in full before starting any implementation work; it contains the architecture decisions, schema, file layout, and step-by-step build order. Everything below is derived from that plan and will apply once the code exists.

## What this is

A personal, local prototype of a Google-News-style aggregator: RSS headlines get an AI-generated two-part summary (neutral facts, then an opinionated "impact" paragraph) via a local LLM, with a link out to the original source. Single-user, no auth, runs on localhost on a Mac mini — not a production system.

## Architecture

| Area | Decision | Why |
|---|---|---|
| Backend | Python 3.12 (pinned via `uv`) + FastAPI + Uvicorn | Best ecosystem fit for Ollama/feedparser/trafilatura; `uv` avoids system Python issues |
| Frontend | React + Vite + `react-router-dom` (2 routes) | Minimal deps; `fetch`/`useState`/`useEffect` is enough at this scope |
| Storage | Plain `sqlite3` (stdlib) + hand-written `schema.sql`, no ORM | Single-file DB is enough for one user |
| LLM | Ollama, `llama3.1:8b` locally (fallback `qwen2.5:7b-instruct`) | Fits in 16GB unified memory. `MODEL_NAME` in `config.py` is the single swap point for a future Claude API migration — keep this seam intact |
| Summary format | Plain-text section markers (`===FACTS===` / `===IMPACT===`), not JSON | Small local models are far more reliable at repeating literal delimiters than producing valid JSON |
| Full article text | Scrape via `trafilatura`, fallback to RSS excerpt on failure | `extracted_text` is LLM input only — **never** exposed via any API route |
| Scheduling | `APScheduler` `BackgroundScheduler` in FastAPI lifespan, interval job (30 min) + manual `POST /api/refresh` | No Celery/Redis needed for a single local process |

### Pipeline flow

`ingest (RSS) → extract (full text) → summarize (Ollama) → store (sqlite)`, orchestrated by `run_pipeline()` in `scheduler.py`. It re-processes any article with `summary_status='pending'` (covers both newly-ingested articles and leftovers from a crashed prior run), committing per-article so partial progress survives crashes. Network/extraction/LLM failures must never crash the pipeline — they set `summary_status='failed'` and the article is simply excluded from the feed.

### Planned directory layout

```
news/
  backend/
    app/
      main.py              # FastAPI app, lifespan startup/shutdown, CORS
      config.py             # MODEL_NAME, DB_PATH, refresh interval
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
  frontend/
    src/pages/Onboarding.jsx
    src/pages/Feed.jsx
    src/pages/Detail.jsx
    src/api.js
  data/news.db               # gitignored
```

### Data model (`backend/app/schema.sql`)

- `feeds` — curated RSS sources with a `category`.
- `articles` — one row per story, deduped on `url` (`UNIQUE`). Tracks both ingestion (`raw_excerpt`, `extracted_text`, `extraction_ok`) and summarization (`summary_facts`, `summary_impact`, `summary_status`: `pending|done|failed`).
- `preferences` — single-row table (`id=1` check constraint) holding `selected_categories` (JSON array string) and `onboarded` flag.

### API surface

- `GET /api/articles?category=Tech,World&limit=50` — headline list only (`summary_status='done'`), **no summary fields**.
- `GET /api/articles/{id}` — full detail including `summary_facts`/`summary_impact`; 404 if missing or not `done`.
- `GET /api/categories`, `GET /api/preferences`, `POST /api/preferences`, `POST /api/refresh`.

Keep this API client-agnostic (no server-rendered assumptions) since a mobile client is expected to reuse it later.

## Commands (once scaffolded per Step 0 of the plan)

```bash
# One-time setup
brew install uv ollama
ollama pull llama3.1:8b

# Backend
cd backend && uv venv --python 3.12 && source .venv/bin/activate
uv pip install fastapi "uvicorn[standard]" feedparser trafilatura apscheduler ollama
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend && npm install
npm run dev   # port 5173, expects VITE_API_BASE=http://localhost:8000 in frontend/.env

# Manually trigger the ingest/summarize pipeline instead of waiting up to 30 min
curl -X POST http://localhost:8000/api/refresh

# Inspect the DB directly
sqlite3 data/news.db ".tables"
```

`ollama serve` must be running before backend startup (menubar app or `ollama serve &`).

## Out of scope for v1

Auth/multi-user, cloud deployment/Docker/HTTPS, ML-based personalization beyond category filtering, cross-source story clustering/dedup, article images/thumbnails, the mobile app itself. Do not add these speculatively.

## Testing discipline

Verify each step from `docs/plan_mvp.md` as it's built, not at the end — this plan has an explicit Verification Checklist section; use it. Concretely, before considering a step done:

- New route → hit it (`curl`) and confirm the response shape matches what's documented here (e.g. `/api/articles` omits summary fields, `/api/articles/{id}` includes them).
- New pipeline stage (ingest/extract/summarize) → run it against real feeds/articles and inspect the DB row it produced (`sqlite3 data/news.db`), not just that it didn't throw.
- New frontend screen → load it in the browser and click through the actual flow (onboarding → feed → detail), not just that it compiles.
- Failure paths called out in the plan (bad feed URL, extraction failure, missing Ollama, malformed model output) should be exercised at least once, since the pipeline is designed to degrade per-article rather than crash — confirm it actually does.

## Keeping this file current

This file must evolve with the project instead of drifting out of date:

- When a step from `docs/plan_mvp.md` is implemented, update the corresponding section here (architecture, directory layout, data model, API surface, commands) to reflect what actually exists, not just what was planned — note any deviations from the plan and why.
- Once `backend/`/`frontend/` exist, replace the "Project state" section and the placeholder "Commands (once scaffolded...)" heading with the real, verified commands (build/lint/test/run), removing the "planned" framing.
- Treat `docs/plan_mvp.md` as the historical design doc and this file as the living summary — if they ever disagree about current reality, this file should be corrected to match the code, not the plan.
