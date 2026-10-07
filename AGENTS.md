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
- Storage: SQLite remains the local default; setting backend-only
  `DATABASE_URL` selects Supabase PostgreSQL through `psycopg`. The hand-written
  `backend/app/schema.sql` and `backend/app/schema_postgres.sql` define matching
  tables without an ORM. `backend/app/db.py` opens named-row connections and
  initializes the selected schema and seed rows idempotently. The PostgreSQL
  tables live in the private `news` schema.
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
  update. Each fetch queues at most four newly inserted stories. Other new
  headlines remain `unrequested` until the reader requests a summary;
  `run_requested_summaries()` drains queued work without refetching RSS.
- REST API: FastAPI exposes unrequested/pending/completed/failed headline lists,
  completed details, per-article summary requests, feed categories,
  single-user preferences, and manual refresh under `/api`. Pydantic response
  models constrain public article fields, and CORS allows the Vite development
  origin at `http://localhost:5173`.
- Frontend: React Router provides preference-gated onboarding, a
  category-filtered headline feed, and summary detail routes. Vite reads the API
  origin from `VITE_API_BASE`; the feed polls every five seconds while empty or
  while any visible summary is pending, and every fifteen seconds otherwise.
  Cards offer Summarize for untouched stories and Retry summary for failures.
  Vitest covers component behavior
  and Playwright exercises the complete flow in local Chrome against isolated
  real API data.
- CI: `.github/workflows/ci.yml` defines separate Backend tests, Frontend tests,
  Production build and Chrome E2E jobs on Ubuntu, triggered by every branch
  push, PR creation/update/reopening and manual workflow dispatch. Actions are
  pinned to verified official commit SHAs. It uses locked dependencies,
  Python 3.12, Node 22, uv 0.12.17 and explicitly installed Google Chrome.
  Tests need no Supabase credentials or running Ollama service.

The implemented data flow is:

`RSS ingest -> article extraction -> Ollama summarization -> SQLite or PostgreSQL -> REST API -> React UI`

Important invariants:

- Article URLs are the ingestion deduplication key.
- Summaries use literal `===FACTS===` and `===IMPACT===` markers.
- Extracted full article text is pipeline input only and must never be returned by the API.
- Feed/list responses omit summary text; article detail responses include it.
- Network, extraction, and model failures must be isolated per article and must not crash the service.
- Pipeline progress is committed per article and restart-safe through `summary_status`.
- Keep the REST API client-agnostic for later mobile reuse.

## Current status

### GitHub Actions CI (2026-10-07)

The user requested shared automatic verification for every pushed commit and
PR. `.github/workflows/ci.yml` adds four independent checks: Backend tests
(unit/API/pipeline tests and compileall), Frontend tests (Vitest), Production
build (Vite) and Chrome E2E. Branch pushes have no branch/path filters, PRs use
the default opened/synchronize/reopened events, and `workflow_dispatch` allows
manual reruns. Local commits trigger CI when pushed; PR checks test GitHub's
proposed merge. Pushes to an open PR can create both push and PR runs.

The workflow has read-only contents permissions, finite job timeouts, locked
dependency installs and explicitly empty `DATABASE_URL`. It uses isolated
SQLite and controlled model/extraction responses; live Ollama and Supabase
checks remain separate. Chrome is installed with Playwright's
`npx playwright install --with-deps chrome`. Playwright's CI configuration
uses one worker, rejects focused tests, emits list/HTML reports and retains
failure traces/screenshots. The browser job saves `chrome-e2e-results` for seven
days, including generated screenshots. README explains commit/PR logs,
artifacts and how an administrator can require the checks before merging.
Branch protection is not configured by this workflow.

Local verification: the 53 backend tests and compileall pass; frontend tests
in CI mode pass all eight tests; the production build passes with 29 modules;
Chrome E2E in CI mode passes on ports 18000/15173 and generates its report.
Official actionlint v1.7.12 was downloaded to an ignored runtime directory,
verified against the release SHA256 checksums, and reports no workflow errors.
The local E2E command exited normally; no test Chrome/API/Vite process remained,
and ports 8000, 5173, 11434, 18000 and 15173 were verified closed. No application
database was used or altered by these checks.

Done: workflow implementation and local verification. In progress: publish the
workflow and verify all four jobs on real GitHub runners. This extends MVP
step 11's verification workflow without adding application hosting or deployment.

### Selective AI summaries (2026-10-05)

The user requested that only the first three or four fetched articles receive
automatic summaries, with a per-article choice for the rest. The implementation
uses four (`AUTO_SUMMARY_LIMIT` in `backend/app/config.py`), selecting the newest
newly inserted stories across the selected feeds after ingestion finishes.
RSS explicitly writes `unrequested` stubs. Only that fetch's four selected rows
become `pending`; old untouched rows remain untouched across refreshes and
restarts. Existing `pending` rows remain previously queued work and resume as
before. Existing completed summaries are retained. No schema migration or new
dependency is needed: both database schemas retain their compatible `pending`
default and ingestion explicitly supplies the new state.

`POST /api/articles/{id}/summarize` atomically queues an untouched or failed
article with `UPDATE ... RETURNING`. Duplicate pending/completed requests reuse
existing work; unknown IDs return 404. The queued state commits before the
background task runs. The shared coordinator contains failures, commits each
result and queues overlapping triggers, retaining full-refresh work if a
summary-only request is also received. On-demand runs drain pending requests
without fetching feeds or purging again, even when category preferences changed.
Normal full refreshes retain category scoping and the rolling 48-hour purge.

Headline lists now include all four states and continue to omit summaries,
excerpts and extracted text. This supersedes the prior failed-row exclusion.
Detail remains done-only with its existing public fields. Untouched cards ask
"Would you like an AI summary?" and offer Summarize; pending cards show Summary
in progress; failed cards offer Retry summary. Request buttons disable during
submission and show an inline transport error when needed. Original-source
links remain available. Successful requests immediately refresh the feed;
empty/pending polling uses five seconds, other populated feeds fifteen seconds.
`docs/plan_selective_summaries.md` records the user-approved extension to MVP
steps 6, 7 and 9; README documents the behavior and endpoint.

Verified on Windows:
- `.venv/Scripts/python.exe -m unittest discover -s tests -v` from backend:
  53 tests pass, including the four-newest cap, untouched backlog after repeated
  refresh/restart, duplicate-safe and retryable requests, privacy, concurrent
  work, and preserving queued refreshes alongside on-demand triggers.
- `.venv/Scripts/python.exe -m compileall -q app tests`: passes.
- `npm.cmd test` from frontend: eight tests pass, including choice, disabled
  submission, request failure, pending-to-done polling, overlapping manual/poll
  refresh serialization and timer cleanup.
- `npm.cmd run build`: passes, 29 transformed modules.
- `NEWS_E2E_BACKEND_PORT=18000` and `NEWS_E2E_FRONTEND_PORT=15173` with
  `npm.cmd run test:e2e`: the isolated real API/Chrome flow passes onboarding,
  pending/untouched/completed cards, summary request through the actual
  coordinator, persisted detail, category filtering and new-tab source link.
  Its model/extraction boundaries use deterministic fixtures. The pending feed
  screenshot was visually inspected for the choice button and distinct states.
- A separate temporary SQLite probe exercised real RSS parsing/deduplication,
  real trafilatura extraction of a controlled HTML document and real Ollama.
  Six articles produced four done and two unrequested rows; repeated ingestion
  preserved them; a real API request completed a fifth and left the sixth
  untouched. Both saved sections were nonempty (252 FACTS/584 IMPACT characters
  for the requested story). The temporary database was removed.
- A Supabase transaction verified newest-four SQL, conditional request and
  duplicate-safe `RETURNING` behavior. Every probe write was rolled back and
  zero probe rows were confirmed afterward; no application row was modified.

The first sandboxed backend suite stalled and was terminated; both Python
processes were verified gone and its command reaped. Vitest's first sandboxed
run failed before executing tests due to temporary-file rename restrictions.
Elevated reruns passed. The Chrome E2E command exited normally and its temporary
API/Vite listeners were absent afterward. The isolated Ollama server PID 46688
and its descendants were terminated and the parent reaped after the live probe.
Final inspection found no test model runner or server, and ports 8000, 5173,
11434, 18000 and 15173 were closed at the end of implementation checks.

For the subsequent user-requested review, Ollama, Vite and a reloading FastAPI
backend were started using `backend/.env`; root PIDs are tracked in ignored
`.run/windows-dev.json` and output in `logs/`. At the user's request, the
backend tree was stopped and port 8000 verified closed, 11 Supabase articles
were deleted and onboarding/categories cleared in one committed transaction,
then FastAPI was restarted. The API confirmed zero articles, empty categories
and `onboarded=false`; Vite returned HTTP 200 and Ollama's configured model was
available. After review, the user requested shutdown: all ten tracked backend,
frontend, Ollama/model and console processes were stopped, their ports verified
closed, and `.run/windows-dev.json` removed.

Done: selective summaries and verification. Next: try the four-story batch and
per-article choice in normal use. The older physical stop-Ollama-mid-pipeline
MVP checklist item remains outstanding; these checks do not claim to close it.

### Supabase database connection (2026-09-30 to 2026-10-01)

The user chose Supabase for hosted article and preference storage while keeping
FastAPI, RSS/extraction, frontend, and local Ollama unchanged for now. The
backend now selects PostgreSQL when `DATABASE_URL` is present and otherwise
keeps the current SQLite behavior. It connects with `psycopg` and TLS, selects
the private `news` schema per connection, and creates the schema, tables,
indexes, eight feeds, and default preference row at startup. SQL write paths
use PostgreSQL-compatible conflict handling and `RETURNING id` for new article
rows. The PostgreSQL schema explicitly enables RLS on its three private tables;
the database-owner connection used by FastAPI remains able to read and write.
The database URL belongs only in ignored `backend/.env`, loaded by
Uvicorn's `--env-file` option. The POSIX launcher inherits its environment but
does not load this file. A Session pooler URI is
recommended because the backend uses session-local schema selection. This is
an explicit storage deviation from `docs/plan_mvp.md`; no cloud deployment,
authentication, or hosted AI work was added. Existing SQLite articles are not
copied; a new hosted database starts empty and can fetch current stories after
onboarding.

Verification on Windows: `uv lock` and `uv sync --locked` installed
`psycopg[binary]`; 49 backend tests pass, including PostgreSQL connection,
schema initialization, placeholder translation, and failure-close checks.
`compileall` passes. The isolated Chrome E2E onboarding, feed, detail, and
source-link flow passes against a temporary SQLite database and real API; its
test API/Vite ports 18000/15173 and test processes were verified absent after
completion. The first sandboxed browser run passed assertions but hung during
Windows cleanup, was interrupted, and left no isolated server; the elevated
rerun exited normally. The previously running development backend was stopped
for editing, then restored as reload supervisor PID 39672 with API listener
PID 34416. The user-requested frontend PID 42524 and Ollama PID 47112 were
preserved. Ports 8000, 5173, and 11434 respond, while 18000/15173 are closed.
The restored backend used SQLite until the hosted project was configured.

On 2026-10-01, the user supplied an ignored `backend/.env` with a Supabase
Session pooler URI. Its password still had the dashboard placeholder brackets;
those brackets were removed locally without displaying or committing the
credential. A real TLS connection and `SELECT 1` passed. Initialization created
the private `news` schema, all three tables, eight feeds, and one default
preference row. The initial automatic RLS project setting did not affect these
custom-schema tables, so explicit `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
statements were added to `schema_postgres.sql` and applied; catalog inspection
confirmed RLS on all three tables. The 49 backend tests and `compileall` pass
after that change.

The tracked old SQLite backend tree (PIDs 39672, 34416, 26844, and its
console child 26428) was stopped, reaped, and port 8000 verified closed. The
backend was restarted with `--env-file .env` as tracked PID 42696; startup
completed and Uvicorn reported loading `.env`. Its API returned five categories,
fresh `onboarded=false` preferences, and zero articles from Supabase, while the
frontend remained available. A completed probe article inserted into Supabase
was returned by `GET /api/articles/{id}` with HTTP 200, then deleted and
confirmed absent with HTTP 404. A second temporary article verified URL
deduplication with `ON CONFLICT(url) DO NOTHING RETURNING id` and was removed.
`POST /api/preferences` persisted a temporary selection in Supabase and was
read back via the API; the original `[]`, `onboarded=0` state was restored.
After explicit RLS activation, another API preference write succeeded and was
restored. Final hosted article count was zero. Initialization ran once in a
standalone process and again on FastAPI startup without duplicating seeds or
overwriting preferences. The user-requested Vite and Ollama processes were
preserved, and no temporary test server or probe row remains.

Done: hosted database connection, schema, API read/write, deduplication, and
restart-safe initialization. Ollama remains local and article summarization
speed is unchanged. The project has not been deployed publicly.

### Pending headline visibility (2026-09-30)

Historical verification: the selective-summary section above supersedes this
section's completed/pending-only list and failed-row exclusion.

The headline list now returns `pending` and `done` articles with a
`summary_status` field. This deliberately extends the MVP plan's completed-only
list contract so fetched headlines can appear before local Ollama finishes.
The list still omits RSS excerpts, extracted text, and both summary fields;
`failed` articles remain hidden. Detail remains available only for `done`
articles and retains its prior response shape and 404 behavior. Pending cards
show "Summary in progress" and a new-tab original-source link without offering
an unavailable detail link. The feed polls every five seconds while empty or
while any visible article is pending, then every fifteen seconds when all
visible articles are complete. This improves perceived freshness without
changing feed ingestion, model speed, or database storage.

Verified on Windows: 46 backend tests pass, including pending/done list shapes,
failed exclusion, filtering, status transition, private-field exclusion, and
done-only detail. Five Vitest tests pass, including a pending-to-done polling
transition. The Vite production build passes with 29 transformed modules.
The isolated Chrome E2E test passes onboarding, pending and completed cards,
filtered feed, detail, and original-source link. Its API/Vite listeners on
ports 18000/15173 and Playwright Chrome process were verified absent after
completion; no application database or user-owned process was touched. A
captured feed screenshot was visually inspected for clear pending/completed
distinction and a usable original-source link. The final E2E rerun passed and
its child processes and listeners were again verified absent.

Done: pending headline visibility and status behavior. Next: assess perceived
speed with normal selected feeds, then decide whether model or hosting changes
are needed. The pre-existing MVP Ollama interruption checklist item remains
outstanding.

### Windows environment setup (2026-09-27)

The Windows PC is configured for the existing MVP: uv 0.12.17, Node 22.22.2,
npm 10.9.7, Git, and Google Chrome were already available. `uv sync --locked`
installed Python 3.12.14 and 43 backend packages; `npm.cmd ci` installed 116
frontend packages. Winget installed Ollama 0.34.4, and `ollama pull llama3.1:8b`
downloaded the 4.9 GB model. `frontend/.env` was created from its example.
SQLite is provided by Python; no separate database server, WSL, or Docker is
required. Windows run commands are in README.md; the POSIX launcher/reset
scripts remain unchanged and are not Windows launchers.

Two portability fixes deviate from the original macOS-only setup baseline:
database connections now commit/roll back and explicitly close on context exit
(Windows otherwise refuses temporary database deletion), and Playwright uses
the Windows virtualenv executable on Windows and the installed Chrome channel
on both platforms. An explicit Chrome path override remains supported.

Verified on this PC:
- `.venv/Scripts/python.exe -m unittest discover -s tests -q` from
  backend: 46 tests pass, including
  new connection-close, commit, and rollback coverage.
- `.venv/Scripts/python.exe -m compileall -q app tests`: passes from backend.
- `.venv/Scripts/python.exe -m app.ingest.rss`: all eight live feeds pass;
  BBC returns 302, seven return 200, with 10-38 entries and no parser errors.
- `npm.cmd test`: 4 tests pass; `npm.cmd run build`: passes, 29 modules.
- `npm.cmd run test:e2e` with ports 18000/15173: passes onboarding, filtering,
  detail, persisted preferences, and new-tab source link in real Chrome.
  The detail screenshot was visually inspected. The first sandboxed run passed
  assertions but could not finish process cleanup; its tracked process tree was
  terminated, and an elevated rerun completed successfully with exit code zero.
- `ollama list`: confirms llama3.1:8b. A real call through `summarize_text`
  returned nonempty FACTS and IMPACT for a synthetic library-news article.
  No application database was modified by these isolated checks.

Process cleanup verified: the installer-started Ollama app (PID 39092), server
(25944), and model descendants were terminated after verification. Process
inspection found no remaining setup server, model process, or Playwright Chrome
process; ports 8000, 5173, 18000, 15173, and 11434 had no listeners. Test and
installer command sessions exited. Pre-existing user Chrome processes were
preserved. The app is installed but intentionally not left running.

`npm.cmd ci` reports seven dependency advisories (two moderate, five high).
Locked versions were preserved; advisory remediation remains separate work.
The existing FastAPI TestClient deprecation warning remains non-blocking.
The original MVP stop-Ollama-mid-pipeline checklist item remains outstanding;
normal shutdown after this setup's summary check does not satisfy that item.

Done: Windows dependency installation and portability verification. Next: use
the documented PowerShell terminals to run the app; address dependency
advisories separately. Overall MVP completion remains subject to the existing
failure-verification item below.

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
and inserts `unrequested` article stubs with
`ON CONFLICT(url) DO NOTHING RETURNING id`. Undated feed entries are
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
newly ingested stubs and queues at most four new stories, then processes
selected-category rows with
`summary_status='pending'`, newest first. Up to three workers perform extraction
and Ollama calls without database access; the coordinator owns all database writes
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

The REST surface is now implemented. `GET /api/articles` returns unrequested,
pending, failed and completed
article headline metadata plus `summary_status`, supports a trimmed comma-separated `category`
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
while empty or pending and every fifteen seconds otherwise. Untouched cards
offer Summarize and failed cards offer Retry summary.
Completed cards link to `/article/:id`; pending cards show status and
link to the original source. The detail screen shows FACTS, a visually distinct IMPACT
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
