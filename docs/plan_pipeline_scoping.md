# Plan: Fix slow cold-start feed by scoping the pipeline to selected, recent news

## Status

Implementation completed and verified on 2026-08-27. The implementation
includes the newest-first ordering, guaranteed queued reruns, and adaptive
5/15-second feed polling added during plan review. `scripts/start.sh` also
applies the optional `OLLAMA_NUM_PARALLEL=3` setting when it owns Ollama
startup. Real checks used temporary data and alternate browser-test ports so
the user's running application and `data/news.db` were not modified. The
physical checklist action of stopping the user's Ollama service remains pending
explicit approval; automated coverage verifies the same model-unavailable
failure path.

## Context

**Problem.** On first launch and after `reset-feed.sh`, the category feed sits on "No summarized stories yet" for a long time. Root cause: the feed only shows articles with `summary_status='done'`, and today the pipeline ingests **every** enabled feed across **all** categories, then scrapes + summarizes **every** article **one at a time** with the local 8B Ollama model before any of it is shown. The user's category choice is applied only as a display filter at the very end (`GET /api/articles`), so during cold-start the model spends most of its time on categories the user can't even see. The feed page also loads once and never refreshes, so finished summaries don't appear until a manual reload.

**Decision (from interview).** Restructure the pipeline so it only does work the user will actually see, and only for current news:

1. **Scope ingestion + summarization to the user's selected categories only.** Unselected categories are never fetched or summarized until selected. (Keep the feed summary-gated — no lazy/headlines-first display.)
2. **Recency window: 48 hours (rolling).** Only ingest articles published within the last 48h; purge anything older from the DB so we don't hoard stale news.
3. **On category change, immediately trigger a refresh** so a newly-selected category populates without waiting for the 30-min scheduler.
4. **Auto-refresh the feed** so summaries pop in on their own during the cold-start batch.
5. **Speed up the batch without a model swap** (keep `llama3.1:8b`): overlap network scraping with model work via bounded concurrency, and cap summary output length. This is a secondary boost on an already much smaller workload.
6. **Prioritize the newest pending stories first** so the first summaries shown are the most useful ones.

**Known tradeoffs accepted by the user:** adding a category later incurs a fresh cold-start for it (softened by the auto-refresh-on-change), and a later-added category starts from "now" (won't backfill stories that already rolled off the RSS feed).

## Approach

### Backend

**`backend/app/config.py`** — add three settings (keep `MODEL_NAME = "llama3.1:8b"`):
- `RECENCY_WINDOW_HOURS = 48`
- `PIPELINE_CONCURRENCY = 3` (worker threads for extract+summarize)
- `SUMMARY_MAX_TOKENS = 512` (Ollama `num_predict` cap)

**`backend/app/ingest/rss.py`** — scope + recency at ingest:
- `fetch_all_feeds(conn, categories, parse=...)`: add a `categories: list[str]` param; select feeds with `WHERE enabled = 1 AND category IN (...)`. Empty list → fetch nothing.
- Skip entries whose `published_parsed` is older than `now(UTC) - RECENCY_WINDOW_HOURS`. Entries with no published date are kept (just appeared in the feed → treat as current). Reuse the existing `_published_at()` helper for the timestamp.

**`backend/app/scheduler.py`** — the core restructure of `run_pipeline()`:
- Read selected categories from `preferences` (id=1) at the top; if none, log and return (nothing to do — correct for the pre-onboarding state).
- **Purge** stale rows first: `DELETE FROM articles WHERE COALESCE(published_at, fetched_at) < <cutoff>` (cutoff = now UTC − 48h, ISO-8601; string compare is valid since all timestamps are stored as UTC `+00:00` isoformat).
- Call `fetch_all_feeds(conn, categories)`.
- Select pending work scoped to selection: `WHERE summary_status='pending' AND category IN (...)`.
- Order pending work by `COALESCE(published_at, fetched_at) DESC, id DESC` so the freshest stories reach the feed first.
- **Parallelize** with a `ThreadPoolExecutor(max_workers=PIPELINE_CONCURRENCY)`: each worker runs `extract_full_text(url)` then `summarize_text(...)` and returns the result — **workers never touch the DB**. The main thread consumes results via `as_completed` and does all writes on a single connection, committing per-article (preserves crash-safety; avoids SQLite cross-thread issues). `extract.py` and `ollama_client.py` already do no DB access, so this is safe. Keep the existing `_pipeline_lock` and per-article `failed`/`done` update logic unchanged.
- If `run_pipeline()` is called while another run owns `_pipeline_lock`, record a rerun request instead of dropping the trigger. The active runner must perform another complete cycle after it finishes, re-reading preferences so a category change is applied immediately. Handle the lock-release boundary so a trigger cannot be lost to a race.

**`backend/app/summarize/ollama_client.py`** — add `"num_predict": SUMMARY_MAX_TOKENS` to the existing `options` dict so generation (the slowest per-article step) is bounded. No other change; retry/parse logic stays.

**`backend/app/routes/preferences.py`** — after a successful `POST /api/preferences`, trigger the pipeline in the background (inject `BackgroundTasks`, schedule `run_pipeline`), mirroring how `routes/admin.py` already does `/api/refresh`. This makes a category change repopulate immediately. If a run is already active, the pipeline's queued-rerun behavior guarantees the new selection is processed as soon as that run finishes.

**`scripts/start.sh`** (optional enabler) — start Ollama with `OLLAMA_NUM_PARALLEL=3` so concurrent summarize calls actually batch on the model. Only applies when the script starts Ollama itself (line ~142); if Ollama is already running untouched, the extraction-overlap win still stands. Note this as best-effort.

### Frontend

**`frontend/src/pages/Feed.jsx`** — auto-refresh:
- Poll `getArticles(selected_categories)` while mounted; use a short interval (~5s) while the feed is empty, then relax to ~15s after stories appear. Clear every scheduled timer on unmount.
- Distinguish **initial load** (show "Loading headlines…") from **silent background refresh** (update the list in place, no spinner flicker). Replace the list with each fetch's result (already ordered `published_at DESC`).
- No API change needed; reuse existing `getArticles` in `src/api.js`.

### Tests to update/add
- `backend/tests/test_rss.py` — new `categories` param + recency skip.
- `backend/tests/test_scheduler.py` — category-scoped processing, purge of >48h rows, newest-first dispatch, parallel path still commits per-article and marks `done`/`failed`, and an overlapping trigger causes a guaranteed rerun with freshly-read preferences.
- `backend/tests/test_ollama_client.py` — `num_predict` passed in options.
- `backend/tests/test_api.py` (preferences) — POST schedules a background refresh.
- Frontend — a Feed test asserting the short empty-feed poll re-fetches, new articles appear without a manual reload or spinner flicker, and polling relaxes after content arrives (extend `App.test.jsx` or add a `Feed.test.jsx`).

## Files to modify
- `backend/app/config.py`
- `backend/app/ingest/rss.py`
- `backend/app/scheduler.py`
- `backend/app/summarize/ollama_client.py`
- `backend/app/routes/preferences.py`
- `scripts/start.sh` (optional)
- `frontend/src/pages/Feed.jsx`
- Test files listed above
- `CLAUDE.md` — update Pipeline flow / API surface notes to reflect selection-scoped, recency-bounded ingestion and the preferences-triggered refresh.

## Verification (end-to-end)
1. **Backend unit tests**: `cd backend && .venv/bin/python -m unittest discover -s tests -v` — all pass, including new scope/recency/parallel cases.
2. **Cold-start scoping**: `./scripts/reset-feed.sh`, onboard selecting a **single** category, and confirm in logs + `sqlite3 data/news.db "SELECT category,count(*) FROM articles GROUP BY category"` that only that category's articles are ingested/summarized. Time-to-first-visible-story should be markedly shorter than before.
3. **Auto-refresh**: sit on the feed during the initial batch and confirm new stories appear without reloading (no full-page spinner on each poll); verify empty feeds poll on the short interval and populated feeds relax to the longer interval.
4. **Recency**: seed/insert an article with `published_at` older than 48h, run a pipeline cycle, confirm it is purged and never shown.
5. **Category change**: change selection via onboarding/preferences and confirm a refresh fires immediately (backend log shows a pipeline run) and the newly-selected category begins populating. Repeat while a pipeline run is active and confirm the trigger produces a queued rerun rather than waiting for the scheduler.
6. **Failure paths intact**: stop Ollama mid-run → per-article `summary_status='failed'`, no crash; bad feed URL still skipped without aborting the batch.
7. **Frontend**: `cd frontend && npm test && npm run build`; optionally `npm run test:e2e`.

## Notes / risks
- **Parallelization ceiling**: each 8B summary still takes the same wall-clock time; the win is overlapping network scraping and letting Ollama batch a few generations. The dominant cold-start reduction comes from #1 (scoping) + #2 (recency), not concurrency.
- **Ollama thread-safety**: concurrent `ollama.chat` calls from worker threads use the sync httpx client (thread-safe); verify no shared-state errors under `PIPELINE_CONCURRENCY=3` during step 2.
- **Time to first story**: the feed remains summary-gated, so cold start still includes at least one local model inference. Newest-first ordering and the five-second empty-feed poll minimize the additional delay around that unavoidable work.
- **SQLite**: all writes remain on the main thread/single connection — no `check_same_thread` violations introduced.
