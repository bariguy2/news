# Reset-Feed Script Plan — `scripts/reset-feed.sh`

## Context

`scripts/start.sh` (implemented) launches/bounces the three local processes but never touches stored data — running it again just swaps the backend/frontend processes, leaving `data/news.db` untouched. The user wants a second script that clears out the article data and preferences so the app comes back up as a true "from scratch" state, then relaunches the UI.

Confirmed requirements (via interview):
- **Reset action**: `DELETE FROM articles WHERE ...` — rows are removed entirely, not soft-reset. Since `articles.url` is `UNIQUE`, deleting frees those URLs up so the next pipeline run re-ingests, re-extracts, and re-summarizes them as if seen for the first time.
- **Category scope**: always resets **all** categories (no per-category args) — a full clean slate every run.
- **Onboarding**: also reset, so relaunching shows the onboarding picker again — `preferences.onboarded = 0` and `selected_categories` cleared back to `'[]'`.
- **Trigger refresh**: after relaunch, immediately call `POST /api/refresh` so the feed starts repopulating right away instead of waiting for the scheduler's next interval.

## Design

### Why the DB reset must happen while the backend is stopped
`backend/app/db.py`'s `get_conn()` opens a short-lived `sqlite3` connection per request (not a long-held connection), and the scheduler (`scheduler.py`) runs `run_pipeline()` immediately on backend startup (`next_run_time=now`) and every 30 minutes after. If we reset rows via the `sqlite3` CLI while the backend is running, we'd race the scheduler's own writes. So the sequence must be: **stop the backend first, reset the DB directly on the file, then start everything back up** — not reset-then-bounce, which is `start.sh`'s order today.

### Why this script doesn't just call `start.sh` blindly at the front
`start.sh` bounces backend/frontend as one atomic sequence (stop-old → start-new); there's no seam to inject a DB reset in the middle without editing it. Rather than restructure the working, already-verified `start.sh`, `reset-feed.sh` duplicates just its two small process-management helpers (`read_pid`, `stop_if_running` — ~30 lines) to stop the backend (and frontend, for consistency) itself, performs the reset, and then **calls `scripts/start.sh` unmodified** to do the actual relaunch (Ollama-if-needed, backend, frontend, readiness polling, PID/log files). This keeps `start.sh` untouched and avoids a race, at the cost of ~30 duplicated lines — noting the tradeoff here in case you'd rather extract a shared `scripts/lib.sh` instead.

### Script structure (`scripts/reset-feed.sh`)
1. `set -euo pipefail`; resolve `REPO_ROOT` the same way `start.sh` does; `DB_PATH="$REPO_ROOT/data/news.db"`.
2. Duplicate `read_pid` + `stop_if_running` from `start.sh` to stop backend and frontend (via `.run/backend.pid`, `.run/frontend.pid`) if running — safe/no-op if not.
3. Before deleting data, refuse to continue if an untracked process still serves port 8000 or 5173. This prevents racing an unowned backend and avoids wiping data before `start.sh` later rejects an occupied frontend port.
4. Guard: if `data/news.db` doesn't exist yet, print a message and exit early (nothing to reset).
5. Reset via `sqlite3`:
   ```sql
   DELETE FROM articles;
   UPDATE preferences SET onboarded = 0, selected_categories = '[]' WHERE id = 1;
   ```
   Print the number of deleted rows (`sqlite3 ... "SELECT changes()"` or `-cmd .changes on`) for confirmation.
6. Call `"$SCRIPT_DIR/start.sh"` (relaunches Ollama-if-needed, backend, frontend; already handles readiness polling and failure output — reset-feed.sh just propagates its exit code).
7. Once `start.sh` returns successfully, `curl -X POST http://localhost:8000/api/refresh` to kick the pipeline immediately.
8. Print a closing summary, e.g. `Feed reset. Onboarding will show on next visit to http://localhost:5173 — pipeline refresh triggered, first articles may take a few minutes.`

### Supporting changes
- `README.md`: add a short note under "Quick start" pointing at `./scripts/reset-feed.sh` and what it does (wipes articles + onboarding, relaunches, triggers refresh) — same style as the existing `start.sh` paragraph.
- `tests/test_reset_feed.sh`: exercise reset transaction results, process replacement, immediate repeat, cold start, missing database, refresh dispatch, Ollama preservation, and the untracked-server guard with isolated fake services and a temporary SQLite database.
- No schema, API, or `start.sh` changes required.

## Verification
1. With the app already running via `./scripts/start.sh` and some articles present (`sqlite3 data/news.db "SELECT COUNT(*) FROM articles"` > 0), run `./scripts/reset-feed.sh`.
2. Confirm backend/frontend PIDs changed (old ones stopped, new ones started) and Ollama was left untouched.
3. Verify the isolated reset transaction leaves `COUNT(*) = 0` and preferences at `0`, `'[]'`. In a real launch, check preferences directly but do not require a post-script article count of zero: the immediate scheduler and explicit refresh can repopulate articles before the script returns.
4. Open `http://localhost:5173` → onboarding screen appears (not the feed).
5. Confirm the pipeline was triggered: backend log (`logs/backend.log`) shows fetch/extract/summarize activity starting shortly after the script finishes, without waiting the full 30-minute interval.
6. Run `./scripts/reset-feed.sh` again immediately (nothing to reset yet, or mid-repopulation) → confirm it still completes cleanly (idempotent) rather than erroring on an empty table.
7. Run it with the app *not* already running (`.run/*.pid` absent/stale) → confirm `stop_if_running` no-ops gracefully and the script still resets + launches correctly from a cold start.
