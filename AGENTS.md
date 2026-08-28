# AGENTS.md

## Project purpose

This repository is building a personal, single-user news aggregator that runs locally. It collects stories from a small curated set of RSS feeds, extracts article text, and uses a local Ollama model to produce two-part summaries:

- `FACTS`: a neutral, evidence-focused summary.
- `IMPACT`: an opinionated explanation of why the story matters.

The web UI lets the user choose category interests, browse a filtered headline feed, open a summary detail view, and follow a link to the original article. The backend must remain a clean REST API so a future mobile client can reuse it.

This is an MVP, not a production platform. Keep the implementation simple and do not add authentication, multi-user support, cloud deployment infrastructure, advanced personalization, story clustering, images, or a mobile app unless the project plan is explicitly changed.

## Authoritative plan

Read `docs/plan_mvp.md` in full before implementing anything. It defines the intended schema, API contracts, directory layout, implementation order, acceptance criteria, and end-to-end verification checklist.

Treat the plan as the design baseline and this file as the living record of the repository's actual state. When implementation differs from the plan, document the current behavior and the reason for the deviation here.

## Architecture and stack

The system uses:

- Backend: Python 3.12 managed with `uv`, FastAPI, and Uvicorn.
- Frontend: React, Vite, and `react-router-dom`.
- Storage: standard-library `sqlite3` with the hand-written
  `backend/app/schema.sql`; no ORM. `backend/app/db.py` opens named-row
  connections with foreign-key enforcement and initializes the schema and
  seed rows idempotently.
- Sources: eight curated RSS feeds parsed with `feedparser`.
  `backend/app/ingest/rss.py` verifies the feeds and ingests entries only from
  enabled feeds in the user's selected categories. It keeps entries published
  within a rolling 48-hour window and relies on the unique article URL
  constraint for deduplication.
  The live feed verification command is
  `.venv/bin/python -m app.ingest.rss`, run from `backend/`.
- Extraction: `backend/app/ingest/extract.py` uses `trafilatura` and returns an
  explicit success flag. The pipeline persists successful text and selects the
  RSS excerpt when extraction fails.
- Summarization: `backend/app/summarize/ollama_client.py` calls local Ollama
  using the configurable `llama3.1:8b` model, parses literal FACTS/IMPACT
  sections, caps generation at 512 tokens, and contains model failures.
- Scheduling: `backend/app/scheduler.py` configures an immediate APScheduler
  interval job inside the FastAPI lifespan. `POST /api/refresh` queues the same
  pipeline through FastAPI background tasks, as does a successful preference
  update.
- REST API: FastAPI exposes completed article lists/details, feed categories,
  single-user preferences, and manual refresh under `/api`. Pydantic response
  models constrain public article fields, and CORS allows the Vite development
  origin at `http://localhost:5173`.
- Frontend: React Router provides preference-gated onboarding, a
  category-filtered headline feed, and summary detail routes. Vite reads the API
  origin from `VITE_API_BASE`; the feed polls every five seconds while empty
  and every fifteen seconds once populated. Vitest covers component behavior
  and Playwright exercises the complete flow in local Chrome against isolated
  real API data.

The implemented data flow is:

`RSS ingest -> article extraction -> Ollama summarization -> SQLite -> REST API -> React UI`

Important invariants:

- Article URLs are the ingestion deduplication key.
- Summaries use literal `===FACTS===` and `===IMPACT===` markers.
- Extracted full article text is pipeline input only and must never be returned by the API.
- Feed/list responses omit summary text; article detail responses include it.
- Network, extraction, and model failures must be isolated per article and must not crash the service.
- Pipeline progress is committed per article and restart-safe through `summary_status`.
- Keep the REST API client-agnostic for later mobile reuse.

## Current status

Steps 0 through 11 are implemented. Backend startup initializes the SQLite
database at `data/news.db`, creates the `feeds`, `articles`, and `preferences`
tables and article indexes, seeds eight verified starter feeds, and creates the
default single-user preference row. Repeated initialization preserves existing
preferences and does not duplicate seed data.

`backend/app/ingest/rss.py` provides a read-only live verification command for
the starter feeds. A feed passes when it returns HTTP 2xx/3xx, parses without a
`bozo` error, and contains at least one entry. On 2026-08-27, all eight feeds
passed using feedparser's default user agent with 10-44 entries. Seven returned
HTTP 200; BBC returned HTTP 302 and resolved to its HTTPS URL with 26 entries
and no parser error. No feed URL or user-agent change was required.

`fetch_all_feeds(conn, categories)` selects only enabled feeds in the supplied
categories and returns immediately for an empty selection. It isolates feed
request and HTTP failures, skips entries without a URL or title, converts parsed
publication times to UTC ISO-8601 strings, rejects entries older than 48 hours,
and inserts article stub rows with `INSERT OR IGNORE`. Undated feed entries are
kept as newly observed stories. It returns only newly inserted article IDs and
leaves transaction control to its caller. Parser errors are logged, while any
usable entries returned with a partial feed are still considered individually.

`extract_full_text(url)` downloads with `trafilatura.fetch_url`, extracts plain
text with comments disabled and recall favored, trims the result, and accepts it
only when it is at least 200 characters. Missing downloads, missing or short
extractions, network errors, and malformed documents return `(None, False)` and
are logged without escaping the article boundary. Successful results return
`(text, True)`. The pipeline stores successful extracted text and otherwise
passes the RSS excerpt to the summarizer.

`build_summary_prompt()` limits article input to 6,000 characters and requires
literal `===FACTS===` and `===IMPACT===` sections. `summarize_text()` calls
Ollama with the configured model, temperature 0.3, and a 512-token generation
cap, validates that both parsed sections are non-empty, and retries malformed
output once with an explicit format reminder. Empty input, model transport
errors, or a second malformed response return `None` without raising; the
pipeline translates that result to a failed article status.

`run_pipeline()` reads the current selected categories and does no feed work
before onboarding. Each active cycle purges rows older than 48 hours, commits
newly ingested stubs, then processes only selected-category rows with
`summary_status='pending'`, newest first. Up to three workers perform extraction
and Ollama calls without database access; the coordinator owns all SQLite writes
and commits after each article. Malformed/model-failed summaries are marked
`failed`; pending rows resume after restart, while `done` and `failed` rows are
not reprocessed. Expected dependency failures and unexpected per-article
failures are logged without stopping later articles. An overlapping scheduled,
manual, or preference-triggered call records a guaranteed rerun; the active
runner repeats the full cycle with freshly-read preferences instead of dropping
the trigger.

FastAPI startup initializes the database, creates and starts a scheduler with an
immediate run and a configurable 30-minute interval, and shuts that scheduler
down during lifespan cleanup. `POST /api/refresh` returns
`{"status": "started"}` and schedules `run_pipeline()` as a background task.

The REST surface is now implemented. `GET /api/articles` returns only completed
article headline metadata, supports a trimmed comma-separated `category`
filter and a positive `limit` (default 50), and orders by newest publication
time. `GET /api/articles/{id}` returns the two summary fields only for completed
articles and otherwise returns 404. Neither route exposes `raw_excerpt` or
`extracted_text`. `GET /api/categories` returns sorted distinct feed
categories. `GET /api/preferences` returns the decoded single-user row, while
`POST /api/preferences` upserts the supplied category list, marks onboarding
complete, and queues an immediate pipeline cycle. CORS preflight responses
allow `http://localhost:5173` by default and do not allow unrelated origins;
the allowed frontend origin is configurable for isolated browser tests.

The React application reads preferences before routing. A new local user is
sent to `/onboarding`, where categories come from the API and at least one must
be selected before preferences are saved. An onboarded user is sent to `/feed`;
that screen reloads persisted categories, requests the filtered headline list,
renders source/category/relative-time cards, silently polls every five seconds
while empty and every fifteen seconds once populated, and links each card to
`/article/:id`. The detail screen shows FACTS, a visually distinct IMPACT
section, and an original-source link with `target="_blank"` and
`rel="noopener noreferrer"`. Loading, empty, API-error, and retry states are
implemented without images or other out-of-scope features.

Local development wiring is documented in `README.md`. `frontend/.env.example`
and the local ignored `frontend/.env` set
`VITE_API_BASE=http://localhost:8000`. Backend dependencies are locked in
`backend/uv.lock`; frontend dependencies and test tooling are locked in
`frontend/package-lock.json`.

`scripts/start.sh` is the detached one-command launcher. It starts
Ollama with `OLLAMA_NUM_PARALLEL=3` by default only when the service is
unavailable, then starts non-reloading Uvicorn and direct Vite processes,
records the application PIDs under `.run/`, and
writes service output under `logs/`. Re-running it bounces only those tracked
backend and frontend processes. It polls real HTTP endpoints before reporting
readiness, tails the relevant log on failure, and refuses to replace untracked
processes already serving ports 8000 or 5173. The manual three-terminal
development workflow remains documented alongside it in `README.md`.

`scripts/reset-feed.sh` provides the destructive clean-slate workflow. It stops
PID-tracked backend/frontend processes, refuses to delete data while an
untracked application server is present, atomically deletes every article and
clears onboarding preferences with `sqlite3`, calls `scripts/start.sh`, and
posts `/api/refresh`. Because backend startup already schedules an immediate
pipeline run, the scheduler still wakes during relaunch, but the cleared
category selection makes both that run and the reset script's manual refresh
no-ops. Articles begin repopulating only after onboarding saves at least one
category and triggers its own refresh. The isolated integration test verifies
the zero-row transaction boundary.

- Done: Step 0, repository scaffold and local toolchain setup; Step 1, SQLite
  schema, connection helper, idempotent initialization, startup integration,
  seed/default rows, and database tests; Step 2, live verification of all eight
  seeded feeds and a repeatable feed verification command with automated tests;
  Step 3, enabled-feed RSS ingestion, article stub persistence, URL
  deduplication, timestamp normalization, and feed/entry failure isolation;
  Step 4, quality-gated full-text extraction and failure-safe excerpt fallback
  signaling; Step 5, constrained two-part prompting, Ollama invocation, summary
  parsing, one malformed-output retry, and model failure isolation; Step 6,
  restart-safe pipeline orchestration, per-article persistence, interval
  scheduling, overlap prevention, lifespan ownership, and manual refresh; Step
  7, client-neutral article/category/preferences routes, exact response-field
  boundaries, persistence, validation, 404 behavior, and CORS; Step 8,
  preference-gated category onboarding; Step 9, filtered headline cards and
  relative times; Step 10, FACTS/IMPACT detail and new-tab source link; Step 11,
  environment wiring, dependency locks, startup documentation, component
  tests, production build, and browser flow. The `docs/plan_launch_UI.md`
  launcher implementation, documentation, ignored runtime paths, and controlled
  process-lifecycle integration test are also complete, including real
  fixed-port fresh-launch, bounce, and stale-PID verification. The
  `docs/plan_reset_feed.md` destructive article/onboarding reset, guarded
  relaunch, immediate refresh, documentation, isolated integration coverage,
  and real running/cold/repeated reset verification are complete. The
  `docs/plan_pipeline_scoping.md` selection-scoped, 48-hour pipeline,
  newest-first bounded concurrency, queued refresh reruns, generation cap,
  adaptive feed polling, tests, and isolated real integration verification are
  complete.
- In progress: final MVP failure verification. The physical checklist action of
  stopping the user's running Ollama service mid-pipeline remains unperformed;
  automated tests cover model unavailability without disrupting that external
  service.
- Next: with explicit approval, stop Ollama during an isolated pipeline run and
  verify FastAPI remains healthy to finish the MVP failure checklist.

Verified commands and checks:

- `bash -n scripts/start.sh scripts/reset-feed.sh tests/test_start.sh
  tests/test_reset_feed.sh` — passes syntax validation using the system Bash
  3.2 runtime targeted by macOS.
- `tests/test_start.sh` — passes controlled fresh launch, PID-changing bounce,
  Ollama preservation, stale backend PID recovery, tailed backend failure, and
  refusal of an untracked port owner. All fake backend, frontend, and Ollama
  processes are terminated and verified stopped by the test cleanup, and its
  temporary runtime files are removed.
- `tests/test_reset_feed.sh` — passes isolated running-app, immediate repeat,
  cold-start, missing-database, and untracked-server cases. It verifies exact
  article deletion counts, zero rows at the transaction boundary, cleared
  preferences, changed application PIDs, refresh dispatch, preserved Ollama,
  fail-before-delete behavior, idempotency, and complete process cleanup.
- A 2026-07-08 read-only process/port check found a manually started Uvicorn
  reload process on port 8000, a frontend server on port 5173, and an Ollama
  service, all predating this launcher work. They were not terminated or
  modified. Running the real `./scripts/start.sh` in that state exits nonzero with the
  explicit untracked-backend message, preserves the existing process IDs, and
  creates no PID files. A sandboxed Ollama bind probe failed immediately and
  its tracked process exited.
- With explicit authorization on 2026-07-08, the manual backend/frontend
  process groups were stopped and their ports verified closed. A real
  `./scripts/start.sh` run returned after serving five categories from the API and HTTP
  200 from Vite. A second run replaced both application PIDs while preserving
  the pre-existing Ollama PID; killing the tracked backend out of band and
  running the script again recovered from the stale PID file with another new
  backend/frontend pair. The first bounce exercised the specified SIGKILL
  fallback because an active scheduler run did not finish within the graceful
  five-second stop window. The final pair was terminated, verified absent, and
  its PID files removed; ports 8000 and 5173 return no response while the
  original Ollama service remains unchanged. The launcher runs ingested current
  feed items into the application database, which ended the check with 434
  completed and 49 restart-safe pending articles. Ignored launcher logs remain
  under `logs/` for inspection.
- After moving the launcher into `scripts/` on 2026-07-08,
  `./scripts/start.sh` was run from the repository root and again returned only
  after the five-category API response and Vite HTTP 200 were available. Its
  backend and frontend were then terminated and verified absent, both PID files
  were removed, ports 8000 and 5173 stopped responding, and the pre-existing
  Ollama process remained unchanged. The restart-safe scheduler completed one
  additional article during this check, leaving 435 completed and 48 pending.
- A 2026-07-08 real reset began with 483 articles, onboarded Sports/Tech
  preferences, and a tracked running app. `./scripts/reset-feed.sh` stopped the
  old pair, reported 483 deletions, cleared preferences, launched new backend
  and frontend PIDs, preserved the Ollama process, posted `/api/refresh`, and
  repopulated 168 current articles. Headless Chrome verified that `/` redirected
  to the onboarding heading. An immediate second reset deleted those 168 rows
  and replaced both PIDs; after that pair was stopped and PID files removed, a
  cold reset also deleted 168 repopulated rows and launched successfully. Final
  cleanup closed Chrome and all agent-started application processes, removed
  runtime PID files, confirmed ports 8000/5173 were closed, and left Ollama
  unchanged. The database ended with 168 newly ingested articles (one done, 167
  pending) and preferences at `onboarded=0`, `selected_categories='[]'`; this
  nonzero count reflected the then-current unscoped startup pipeline. The
  current selection-scoped pipeline keeps the reset database empty until
  onboarding saves a category.
- `.venv/bin/python -m unittest discover -s tests -v` — passes 45 database,
  ingestion, extraction, summarization, pipeline, scheduler, lifespan, REST API,
  persistence, response-shape, and CORS tests. The pipeline coverage includes
  empty-selection skipping, selected-category scoping, the 48-hour purge,
  newest-first per-article commits, three simultaneous workers, and a queued
  rerun that observes changed preferences.
- `.venv/bin/python -m compileall -q app tests` — passes.
- `uv sync` — resolves 45 packages and checks the backend environment from
  `backend/uv.lock`.
- `ollama list` — shows the configured `llama3.1:8b` model locally.
- `.venv/bin/python -m app.ingest.rss` — live-checks all eight starter feeds;
  on 2026-08-27 all passed with 10-44 entries per feed. BBC returned HTTP 302
  and the other seven returned HTTP 200, all without parser errors.
- A 2026-08-27 live selected-category ingestion check used a fresh temporary
  database and requested only Tech. It inserted 50 rows, every row had category
  `Tech`, and no row with a publication time was outside the rolling 48-hour
  window. The temporary database was removed.
- A 2026-08-27 real concurrency check sent three synthetic articles through
  `llama3.1:8b` simultaneously. All three returned valid, non-empty FACTS and
  IMPACT sections in 14.89 seconds with section lengths of 233-257 and 371-430
  characters. The check was read-only and did not modify application data.
- A 2026-08-27 isolated end-to-end pipeline check limited the live TechCrunch
  feed to one current entry and used a temporary database. Real extraction
  succeeded, real Ollama summarization stored `summary_status='done'`, and the
  saved row contained 357 FACTS characters and 619 IMPACT characters. The
  temporary probe and database were removed.
- A 2026-07-06 live integration run against a fresh temporary database inserted
  165 article rows from all eight feeds. Every row had required fields populated
  and `summary_status='pending'`; there were no duplicate URLs. Running the same
  ingestion again immediately returned no new IDs and left the row count at 165.
- A 2026-07-06 transient live extraction check covered current BBC, TechCrunch,
  ESPN, CNBC, and NASA articles. All five succeeded with 560-5,587 extracted
  characters and had RSS excerpts available. The check did not persist article
  text. Automated tests separately verify missing downloads, short/missing text,
  timeouts, and malformed-document fallback behavior.
- A 2026-07-06 local integration call sent a synthetic article through
  `llama3.1:8b`; the client parsed non-empty FACTS and IMPACT sections of 362 and
  550 characters respectively. Automated tests verify malformed-output retry
  and model-unavailable behavior. The integration check did not write to the
  database.
- A 2026-07-06 APScheduler integration check observed the configured immediate
  `news-refresh` job execute and remain scheduled for its next interval.
- A 2026-07-06 full pipeline check used a temporary database and one current
  TechCrunch article. It stored 5,898 extracted characters, 571 FACTS
  characters, 573 IMPACT characters, and `summary_status='done'`. A second run
  processed zero articles and preserved both summaries exactly. Automated tests
  separately verify RSS excerpt fallback, per-article commit visibility,
  restart handling, model/extraction failures, overlapping-run suppression,
  scheduler lifecycle, and `POST /api/refresh`. The application database was
  not modified by this integration check.
- FastAPI integration tests use the real application routes and a temporary
  SQLite database. They verify category filtering, publication ordering,
  limits, completed-only visibility, exact list/detail fields, missing and
  incomplete article 404s, preference persistence, distinct categories, request
  validation, and CORS preflights. Inspection confirms no API response contains
  RSS excerpts or extracted article text.
- A 2026-07-06 literal `POST /api/refresh` integration check used a temporary
  database, a current TechCrunch article, real extraction, and local Ollama. The
  response was `{"status":"started"}`, logs reported one summarized article,
  and the row stored 5,898 extracted characters plus non-empty 611-character
  FACTS and 665-character IMPACT sections with `summary_status='done'`.
- `npm install` — installs the locked frontend and test dependencies with zero
  reported vulnerabilities.
- `npm test` — passes 4 Vitest component/helper tests across 3 files,
  including empty-feed five-second polling, silent story appearance, transition
  to the fifteen-second populated interval, and timer cleanup on unmount.
- `npm run build` — completes the Vite production build with 29 transformed
  modules.
- `npm run test:e2e` — passes the Playwright Chrome flow against an isolated
  Uvicorn/FastAPI server and temporary SQLite database. It verifies first-launch
  onboarding, persisted category selection, filtered headlines, detail FACTS
  and IMPACT, root redirect after onboarding, and an actual intercepted
  new-tab source-link popup. The generated detail screenshot was visually
  inspected for layout and IMPACT distinction. On 2026-08-27 it passed using
  `NEWS_E2E_BACKEND_PORT=18000` and `NEWS_E2E_FRONTEND_PORT=15173` because
  user-owned processes were already serving the default ports. The isolated
  listeners were verified closed afterward, and a filtered process check found
  no Playwright, test Chrome, isolated API, or alternate-port Vite process. The
  pre-existing backend/frontend PIDs were unchanged immediately after the test;
  at final handoff they were still alive but no longer listening on ports 8000
  or 5173. The agent did not signal them. No application data was changed.
- Starting the FastAPI lifespan against a deleted `data/news.db`, twice, then
  inspecting it with `sqlite3` verifies three tables, both article indexes,
  eight enabled feeds, one default preference row, and idempotent startup.

Known non-blocking test warning: FastAPI's current `TestClient` import emits a
`StarletteDeprecationWarning` recommending `httpx2`. The backend suite still
passes; this warning does not affect application runtime.

Do not claim a planned component exists. As files and features are added, replace planned descriptions in this document with verified commands, paths, behavior, and status.

## How to work in this codebase

1. Read `docs/plan_mvp.md` and identify the exact step and acceptance criteria being implemented.
2. Inspect the current repository and this file; do not assume the planned layout has already been created.
3. Keep changes scoped to the current plan step. Avoid speculative abstractions and out-of-scope production infrastructure.
4. Preserve the intended simple seams: plain SQLite access, a client-neutral REST API, and an isolated summarizer/model configuration.
5. Handle external failures explicitly. RSS, article extraction, and Ollama are unreliable boundaries and should fail without taking down the pipeline.
6. Add focused automated tests with each behavior wherever practical. Do not defer all testing until the end of the plan.
7. Run the relevant tests and perform the integration or manual checks required by the plan before updating status.
8. Document verified setup, run, test, lint, and migration commands here as they become real. Never present an untested command as known-working.

## MANDATORY: terminate and verify every started process

Any agent that starts a long-running or background process—including Uvicorn,
Vite, Ollama test instances, schedulers, browser automation, test servers, or
watch-mode commands—must clean it up before handing off work.

For every process started by an agent:

1. Track the process and any child processes created by it.
2. Terminate the process when the related check or task finishes.
3. Wait for termination and confirm the process was reaped; do not leave hanging
   or zombie processes.
4. Confirm that related child processes, ports, and temporary servers are no
   longer active.
5. Do not terminate processes that predated the agent's work or belong to the
   user unless the user explicitly authorizes it.
6. Record the process cleanup and verification result in `AGENTS.md` whenever a
   plan step or implementation change used a long-running process.
7. If termination or verification cannot be completed, report the exact process
   and leave the work in progress rather than claiming completion.

## MANDATORY: test and verify before marking work complete

**A feature or plan step is not done merely because code was written, the app compiled, or the happy path did not throw. It is done only after its acceptance criteria have been tested and the resulting behavior has been verified.**

For every feature or plan step:

1. Translate the relevant requirements and `docs/plan_mvp.md` verification items into explicit checks.
2. Write or update automated tests appropriate to the changed layer and run them successfully.
3. Run existing relevant tests to detect regressions.
4. Exercise the real integration or UI flow where mocks cannot prove the feature works.
5. Check observable results, not only process exit codes: inspect API response shapes, database rows, logs, UI state, outbound links, and persisted behavior as applicable.
6. Exercise important failure and restart paths called out by the plan.
7. Record what was run and its result in the work handoff. If a required check cannot run, state that clearly and leave the work in progress; do not mark it complete.

Minimum verification expectations by area:

- Database: initialize a fresh database, inspect tables/seeds, and test constraints and idempotency.
- RSS ingestion: check each live feed's parser/HTTP result, insertions, and URL deduplication.
- Extraction and summarization: run against representative articles, inspect stored output, validate both summary sections, and test fallback/malformed-output behavior.
- Pipeline/scheduler: verify manual and scheduled execution, per-article commits, restart behavior, and that dependency failures do not crash FastAPI.
- REST API: test status codes, filtering, persistence, and exact response fields, especially that list routes omit summaries and detail routes never expose extracted article text.
- Frontend: run its automated checks and manually verify onboarding -> filtered feed -> detail -> original-source link in a browser.
- End-to-end: complete every applicable item in the plan's Verification Checklist before declaring the MVP complete.

## MANDATORY: keep AGENTS.md current on every implementation change

**Every agent that onboards a feature or executes or completes a step from `docs/plan_mvp.md` must update `AGENTS.md` in the same change. This is a completion requirement, not optional documentation cleanup.**

On each such change:

- Update `Current status` so `Done`, `In progress`, and `Next` match reality.
- Replace planned architecture, paths, commands, and behavior with what is actually implemented and verified.
- Add the real test/run commands and relevant manual verification steps once they exist.
- Record material deviations from the MVP plan and why they were necessary.
- Remove stale guidance that no longer describes the repository.
- Do not move work to `Done` until the mandatory verification above has passed.

Before handing off any feature or plan-step work, re-read this file and confirm it accurately represents the latest repository state. If code and `AGENTS.md` disagree, the work is not complete.

## Planned implementation map

The MVP plan currently sequences work as follows:

0. Scaffold the Python/Ollama and React toolchains.
1. Add the SQLite schema and initialization.
2. Seed and verify curated RSS feeds.
3. Implement deduplicating RSS ingestion.
4. Implement full-text extraction with excerpt fallback.
5. Implement and parse local two-part summaries.
6. Orchestrate and schedule the resilient pipeline.
7. Add the REST API routes and CORS configuration.
8. Add category onboarding.
9. Add the filtered headline feed.
10. Add the summary detail screen and source link.
11. Verify local development wiring and document startup.

Use the detailed objectives and verification checklist in `docs/plan_mvp.md`; this map is only a status-oriented summary.
