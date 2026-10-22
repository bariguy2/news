# AGENTS.md

## Project purpose

This repository is building a personal, single-user news aggregator that runs locally. It collects stories from a small curated set of RSS feeds, extracts article text, and uses configurable hosted AI (Groq by default, Gemini alternative, optional local Ollama) to produce shared two-part summaries:

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
- Summarization: `backend/app/summarize/service.py`, `providers.py`, and
  `settings.py` implement configurable Groq GPT-OSS 120B (default), Gemini
  3.5 Flash-Lite and optional Ollama llama3.1:8b through HTTPX streaming.
  Literal FACTS/IMPACT sections are strictly validated. Input is capped at
  6,000 characters; hosted output defaults to 2,048 tokens including reasoning,
  Ollama to 512. `usage.py` reserves and settles durable per-attempt estimated
  charges against independent monthly summary/evaluation allowances. These
  count list prices even for free-tier calls and never opt into paid billing.
  `versions.py` archives published summaries; legacy output migrates idempotently.
- Scheduling: `backend/app/scheduler.py` configures an immediate APScheduler
  interval job inside the FastAPI lifespan. `POST /api/refresh` queues the same
  pipeline through FastAPI background tasks, as does a successful preference
  update. `AUTO_SUMMARY_LIMIT` defaults to zero. New headlines remain
  `unrequested` until the reader requests a summary;
  `run_requested_summaries()` drains queued work without refetching RSS.
- REST API: FastAPI exposes unrequested/pending/completed/failed headline lists,
  completed details, per-article summary requests, feed categories,
  single-user preferences, and manual refresh under `/api`. Pydantic response
  models constrain public article fields, and CORS allows the Vite development
  origin at `http://localhost:5173`.
  Completed summaries are reused; public `regenerate=true` returns 403.
  Operator regeneration is queued through `python -m app.summarize.manage`.
  Detail responses include `summary_version_id` for future feedback attribution.
- Frontend: React Router provides preference-gated onboarding, a
  category-filtered headline feed, and summary detail routes. Vite reads the API
  origin from `VITE_API_BASE`; the feed polls every five seconds while empty or
  while any visible summary is pending, and every fifteen seconds otherwise.
  Cards offer Summarize for untouched stories and Retry summary for failures.
  Vitest covers component behavior
  and Playwright exercises the complete flow in local Chrome against isolated
  real API data.
- CI: `.github/workflows/ci.yml` defines separate Backend tests, Frontend tests,
  Production build and Chrome E2E jobs on Ubuntu 24.04, triggered by every branch
  push, PR creation/update/reopening and manual workflow dispatch. Actions are
  pinned to verified official commit SHAs. It uses locked dependencies,
  Python 3.12, Node 22, uv 0.12.17 and the runner's Google Chrome installation.
  Tests need no Supabase credentials or running Ollama service.

The implemented data flow is:

`RSS ingest -> on-demand extraction -> configurable AI -> SQLite or PostgreSQL -> REST API -> React UI`

Important invariants:

- Article URLs are the ingestion deduplication key.
- Summaries use literal `===FACTS===` and `===IMPACT===` markers.
- Extracted full article text is pipeline input only and must never be returned by the API.
- Feed/list responses omit summary text; article detail responses include it.
- Network, extraction, and model failures must be isolated per article and must not crash the service.
- Pipeline progress is committed per article and restart-safe through `summary_status`.
- Keep the REST API client-agnostic for later mobile reuse.

## Current status

### Profile button placeholder (2026-10-22)

The user narrowed the initial settings-page request to a placeholder button
only. Feed now has an accessible 44 px circular profile icon button at the
upper right, with a coming-soon tooltip, hover styling and visible keyboard
focus. Clicking it has no action. Header spacing keeps it clear of text on
desktop and mobile. No settings route, authentication, preference changes,
backend code, dependencies or new automated tests were added.

Verification: all 11 existing feed tests and production build pass. A temporary
Chrome session checked desktop, 320 px and 390 px layouts, no overflow, click
without navigation, and actual Tab/Shift+Tab focus. Desktop/mobile screenshots
were visually inspected; the temporary browser closed in finally. Development
services and real preferences/articles were preserved. Changes are uncommitted
on `chunny22/frontend`.

### Frontend branch rebased onto hosted-AI main (2026-10-21)

The user requested rebasing `chunny22/frontend` onto main's `fff9ce7` merge of
`16eb463` from `dev/bariguy/new_ai`. Local recovery branch
`codex/chunny22-frontend-before-rebase-2026-10-21` retains original tip `248e410`.
Unlike the earlier script-only merge, this upstream replaces the Ollama SDK
with hosted Groq/Gemini/optional-Ollama HTTPX providers, shared request-only
summaries, immutable versions, accounting/limits and offline comparisons.

Conflict resolution preserves upstream's zero default automatic summaries,
strict parsing/source grounding, durable reservation/settlement, history,
operator-only regeneration and removal of the reader regeneration button.
The obsolete Ollama client and tests stay deleted. Our three-step onboarding,
focused-interest storage, style choices, safe list rendering and faster typed
preview remain. SQLite initialization now performs both preference and article-
version migrations before preserving legacy summaries. Both status histories
are retained below; older local-only/regeneration descriptions are historical.

Style handling is adapted to `summarize/service.py`: workers pass their validated
style snapshot, prompts retain upstream safety instructions, and a v3 prompt
version plus tone/length/format is stored in attempt/version provenance. Hosted
token caps include reasoning and stay as configured; style never raises them
or bypasses reservations. Optional Ollama uses the smaller of its configured
cap and visible style budget. Streaming estimates use the visible style budget.
Prior comparison artifacts remain intact but the changed prompt version
requires a new output directory. UI/README now explain shared published
summaries and operator replacements instead of offering reader regeneration.

Verification: locked dependency sync removes the obsolete Ollama SDK; backend
suite runs 96 tests (92 pass, four opt-in PostgreSQL checks skip without a URL),
and compileall passes. All four PostgreSQL checks pass separately against only
connection-local temporary tables (reset/rollback, usage accounting, versions,
operator queue and history retention). All 36 frontend tests and the production
build pass (35 modules). Isolated Chrome E2E passes three-step onboarding,
typing/reduced motion, saved style and interest persistence, formatted details,
search/read/progress/immediate completion, reuse and blocked public regeneration.
New integration coverage checks Groq/Gemini/Ollama style propagation, unchanged
hosted caps, conservative reservations, retry style and version attribution.
No live hosted AI call or production data reset was used for verification.

The tracked dev backend was paused before rebase to prevent partial reloads;
frontend and Ollama were preserved. The user has now configured AI keys locally
for restart. Credentials were not displayed, changed, or committed. The rebased
commit is pushed with an explicit force-with-lease against the original remote
tip; remote concurrent work must never be overwritten.

### Hosted AI and automated comparison, steps 1–3 (2026-10-21)

The user approved replacing the local-only default with configurable hosted AI,
shared on-demand summaries and an automated Groq/Gemini comparison. This extends
the original MVP scope; `docs/plan_mvp.md` now records the approved extension.
Like/dislike feedback is on the follow-up list, attached to summary versions;
authentication, multi-user state and public deployment remain deferred.

Done: Groq `openai/gpt-oss-120b` default, Gemini `gemini-3.5-flash-lite`
alternative and optional Ollama behind one streaming service. HTTPX replaces
the Ollama SDK. Backend-only dotenv settings select providers/models and limits;
the launcher validates them before replacing services and skips Ollama in hosted
mode. No automatic fallback or account/billing upgrades occur. API keys in the
existing ignored `.env` were not modified or exposed.

Summaries now default to request-only (`AUTO_SUMMARY_LIMIT=0`). Concurrent
requests atomically reuse pending/completed work. The reader's Summarize again
button is removed and explicit HTTP regeneration returns 403. From `backend/`,
`.venv/bin/python -m app.summarize.manage regenerate ID` queues an operator
replacement for the next scheduler refresh or Refresh feed action. It does not
launch a competing pipeline. Failed attempts retain previous text; successful
ones atomically publish an immutable `summary_versions` row and article pointer.
Existing output migrates with legacy/unknown provenance. Detail responses expose
only the version ID in addition to existing fields, never full source text.

`ai_budgets` and `ai_attempts` persist reservations, token/reasoning counts,
latency, safe outcomes and estimated charges. Each attempt reserves before
network I/O; retries reserve separately. Unknown/interrupted usage retains the
reservation and explicit rejections refund it. Separate UTC-month allowances
default to $5 application/$1 evaluation in **list-price-equivalent usage**, even
on free tiers; these are not paid subscriptions or invoice guarantees. Zero
blocks hosted calls in that scope. Account free-tier status must be controlled
in the provider dashboard, not inferred from API keys. Summary history/usage
survive article purges and feed resets, with no automatic retention cutoff.
Three new PostgreSQL tables use the private news schema with RLS enabled.

`python -m app.summarize.benchmark export/run` freezes category-balanced stored
inputs, compares both providers and optionally judges with swapped candidate
order (default Groq GPT-OSS 20B). It records validity, timing, token/cost totals,
preferences and review flags under ignored `data/evaluations/`. Resume reuses
successful calls and includes previous failed-attempt costs; changed inputs or
model/prompt/price/evaluator settings require a new output directory. Quota,
credential and budget limits pause the run (CLI exit 2) until an operator resumes.
The judge is fallible and can share a model family with a candidate; no automatic
production switching occurs. README documents commands, configuration, limits,
manual review, local mode and retained history.

Verification:

- From `backend/`, `.venv/bin/python -m unittest discover -s tests -q` runs
  87 tests: 83 pass and four opt-in PostgreSQL tests skip without a test URL.
  `.venv/bin/python -m compileall -q app tests` passes. Coverage includes
  concurrent requests/reservations, retries, quota rejection, interrupted usage,
  streaming parsing and reasoning accounting, metadata-only API shapes,
  legacy/version preservation, operator regeneration, benchmark resume and
  changed-profile rejection.
- Two new opt-in PostgreSQL tests passed on the configured connection using
  only connection-local temporary tables: reservation/settlement/rollback and
  legacy migration/version replacement/deletion retention. Existing application
  tables were not initialized, migrated, reset or written by this check.
- All 24 frontend tests, the production build (30 modules), and all three shell
  suites (start/reset-feed/kill) pass. The launcher checks include hosted startup
  without an Ollama executable and preservation of dotenv secrets/precedence.
- Chrome E2E on isolated ports 18000/15173 passes onboarding/filter/search,
  on-demand generation, progress animation/immediate completion, persisted read
  state, summary reuse, source navigation and blocked public regeneration.
  `news-hosted-detail-mobile.png` was visually inspected at 390 px: sections and
  source button fit without overflow. No reader regeneration action remains.
- Real Groq/Gemini streaming and both judge orders succeeded on one frozen
  existing article. Both outputs contain validated FACTS/IMPACT and recorded
  usage; the report flags coverage differences for review. Accounting was
  isolated in `data/evaluations/hosted-smoke/usage.db`; production data was only
  read to export input. This is an integration smoke test, not evidence of a
  general quality winner. Only one usable stored article was available; the
  representative 30–50 article quality study remains follow-up work.
- `uv sync --locked` and `git diff --check` pass. Test commands exited normally; ports 18000/15173
  have no listeners and no test API/Vite/browser/benchmark processes remain.
  Pre-existing backend PID 76465 and Vite PID 76489 (started October 19) were
  preserved. The backend is not reloading and needs a restart to activate this
  change and apply idempotent schema initialization. No service restart or
  application data reset was performed. The user requested a separate local
  commit for hosted AI before developer-setup housekeeping; no push is requested.

Next: restart the app when ready, collect a representative frozen comparison
set, review its flags/sample, then implement version-linked like/dislike feedback.
The app still requires one backend process; distributed job claims and per-user
quotas are not implemented. Older entries below describe historical behavior.

### Onboarding changes approved for commit (2026-10-21)

After reviewing the three-step onboarding, saved focused interests, applied
summary styles and faster animated preview, the user requested committing and
pushing all these changes on `chunny22/frontend`. The verification records
below describe the included work; their uncommitted-status notes are historical.
Environment files, development logs/PID records and generated test artifacts
remain ignored. Development services are preserved for the user.

### Faster preview typing (2026-10-21)

At the user's request, preview typing is now twice as fast: six milliseconds
per character with a 0.6–1.75-second total duration, replacing 12 milliseconds
and 1.2–3.5 seconds. The existing 24 ms updates, sequential Facts/Impact reveal,
layout reservation, cancellation and reduced-motion behavior remain intact.
The three existing animation tests were checked with updated intermediate-time
assertions and pass; the production build passes (35 modules). No new tests,
dependencies or backend changes were needed. Changes remain uncommitted.

### Animated summary-style preview (2026-10-20)

The user requested a preview that appears to be typed. The third onboarding
screen now uses `TypingPreview.jsx` to reveal Facts followed by Impact with a
blinking caret. It replays on tone/length/format changes. Character counts use
elapsed time with a bounded 1.2–3.5-second duration and 24 ms updates. The full
layout is reserved with a transparent accessible copy, so controls stay still;
the visual partial text is hidden from assistive technology to avoid announcing
every character. Reduced motion shows full text immediately, including when the
OS preference changes while typing. Choice changes/unmount cancel old timers
and remove media-query listeners. This is a local React/CSS animation with no
model calls, dependencies, backend or database changes.

Verification: all 38 frontend tests and the production build pass (35 modules).
New fake-clock checks cover intermediate/sequential text, completion, cancellation,
unmount cleanup and reduced-motion changes. Chrome E2E on isolated ports
18000/15173 passes the full flow and verifies real intermediate text growth,
stable preview height, instant reduced-motion completion, and choice changes
under reduced motion. The typing screenshot was visually inspected; existing
desktop/mobile preview screenshots were refreshed. Backend tests were not rerun
for this frontend-only addition. Dev services remain available for review; all
onboarding changes are still uncommitted on `chunny22/frontend`.

### Third onboarding step for summary style (2026-10-20)

The user requested summary tone, length and presentation choices after the
focused interests screen. This supersedes the two-step flow described below.
Onboarding now has three screens: categories, focused interests, summary style.
The final screen offers Neutral/Conversational/Analytical, Brief/Standard/
Detailed, and Bullet points/Paragraphs/Mixed. Mixed means Facts as a list and
Impact as a paragraph. Native grouped radio controls, a local illustrative
preview and Back to topics fit the existing design. Back navigation preserves
all earlier choices and style; only the final Build my briefing saves. Defaults
are neutral/standard/paragraphs. Failure retains choices and allows retry.

Unlike focused interests (still saved only for the future backend), style is
already applied to new and explicitly regenerated summaries. Preferences
GET/POST adds validated `summary_style` with `tone`, `length`, `format`. Invalid
or unknown options fail before persistence or pipeline work; omitted/empty
objects use defaults. A separate JSON-text column defaults to `{}` in both
schemas; startup migration preserves existing data and onboarding. Feed reset
clears style and remains compatible with pre-migration tables.

Each coordinator cycle reads a validated immutable style snapshot and passes it
to workers, including summary-only retries/regeneration. Malformed stored
styles fall back to defaults. Prompts retain literal FACTS/IMPACT markers and
factual grounding for all tones. Length changes the prompt target and token cap
to 256/512/768; the streaming estimate uses that same budget. Exact model length
and styling are best-effort, as the preview explains. Existing summaries are
not automatically replaced. Detail safely renders simple lists and paragraphs
as React text, without interpreting HTML or introducing Markdown dependencies.

Verification on Windows:
- Backend: 81 tests, 79 pass and two opt-in PostgreSQL checks skip without a
  URL; compileall passes. Tests cover all 27 prompt combinations, style-aware
  retry/token limits/progress, saved pipeline style and invalid-storage fallback,
  regenerated articles using current style, API validation/persistence/defaults,
  legacy migration preservation, and atomic reset/rollback behavior.
- Frontend: all 35 tests and production build pass (34 modules). Tests cover
  the third-step defaults, choices and Back preservation, full saved payload,
  disabled controls, failure/retry, preview changes and safe list/paragraph/HTML
  text rendering. Prior search/read/progress/detail checks also pass.
- Chrome E2E passes on isolated ports 18000/15173: full three-step onboarding,
  style and interest persistence after reload, no premature save, Back choices,
  mixed-format generated details and existing regeneration/progress flow.
  Desktop and 390-pixel mobile style screenshots were visually inspected.
- Supabase column verified; preference route SQL tested only against a
  connection-local temporary table. Both updated real PostgreSQL reset tests
  pass separately against pg_temp tables. No real articles/preferences reset.
- Three synthetic, database-free calls through the actual installed Ollama
  model verify bullet-only, paragraph-only and mixed outputs with streaming.
  Outputs were 110/125/110 words for Brief, illustrating the approximate length
  target; each retained both parsed sections and reached the Saving stage.

Development services remain running for review. All onboarding changes remain
uncommitted on `chunny22/frontend`; no dependency or CI workflow change was
needed. Test-owned processes and listeners are checked after verification.

### Two-step onboarding and saved focused interests (2026-10-20)

On `chunny22/frontend` (renamed from dev-hjc after PR #4 merged), the user
requested a second onboarding screen for detailed interests and a Back button.
They explicitly chose to save these interests for their collaborator's upcoming
backend rather than add approximate keyword filtering now. This extends the
plan's single-step category picker; ingestion, ranking and summarization still
use only the existing broad categories. The UI clearly states this limitation.

Step one now uses Continue without saving or triggering ingestion. Step two
shows only selected categories: industries for Business, disciplines and teams
for Sports, plus Tech/World/Science topics. Sports have short suggested team
lists and a custom-team input. Choices are optional. Back to categories retains
choices; removing a category or sport clears its dependent interests/teams.
Build my briefing saves once, disables controls while saving, and preserves
choices on failure for retry. Headings receive focus on step changes; layouts
wrap at mobile widths. There are no new packages. The topic/team catalog lives
in `frontend/src/interests.js`; it is a starter list, not provider coverage.
Unfinished drafts live in component state and reset on reload. Already-onboarded
users are not forced through onboarding again.

The existing preferences GET/POST contract adds `focused_interests`, a map from
selected category to `{topics: [...], teams: {sport: [team names]}}`. Only Sports
can have teams, each sport key must be selected as a topic, category keys must
be selected, names are trimmed and bounded to 80 characters, and lists are
deduplicated and bounded to 20 topics/teams. Omitted details default to `{}`
for old clients. SQLite and private-schema PostgreSQL each store one JSON-text
column with an empty-object default. Startup adds the column idempotently,
preserving existing articles and preferences. Feed reset clears the new field
transactionally and still works on legacy tables before startup migration.
README documents the API and the current lack of focused article filtering.

Verification:
- Backend suite: 76 tests, 74 pass and two opt-in PostgreSQL tests skip without
  a test connection. Compileall passes. New checks cover preference round-trip,
  validation/no-save on failure, unchanged broad article filtering, legacy
  migration preservation, focused reset and pre-migration reset compatibility.
- Frontend: all 32 tests and production build pass. New checks cover conditional
  topics/teams, Back navigation, removed-category/sport cleanup, custom teams,
  optional broad choices, save failure/retry, disabled controls and team limits.
- Chrome E2E passes on isolated ports 18000/15173, including two-step choices,
  custom teams, Back preservation, no premature save, persistence after reload,
  mobile overflow checks, and the existing search/read/progress/regeneration
  flow. Desktop and 390-pixel mobile screenshots were visually inspected.
- Configured PostgreSQL column verified; real preference GET/POST SQL exercised
  against connection-local temporary preferences only. Both updated PostgreSQL
  reset/rollback tests pass separately against pg_temp tables. No test queued
  live background work, changed application preferences, or reset real articles.

Development services remain running for user review. Changes are uncommitted;
no pipeline/workflow modification is needed for these automatically discovered
tests. Test process/port cleanup is checked separately from the preserved dev
services.

### dev-hjc rebased onto main 21c4ca1 (2026-10-19)

The user requested assessment of main's `21c4ca1` merge and rebasing dev-hjc so
its four feature commits can merge. Main merged `bariguy/new_ai` (underscore
in the actual remote branch name), adding lifecycle/configuration work rather
than changing RSS or AI providers. `start.sh` loads backend/.env, `reset-feed.sh`
uses the new transactional SQLite/PostgreSQL `app.reset_feed` helper, and new
`kill.sh` stops only POSIX PID-tracked application services while preserving
Ollama/data. Root `/env` is now ignored. These remain macOS/POSIX scripts, not
PowerShell launchers. No application ingestion/model/schema code was changed
by that upstream merge.

A local recovery branch `codex/dev-hjc-before-rebase-2026-10-19` retains the
original d71c2e6 tip. All four commits were replayed onto origin/main 21c4ca1.
Each conflict was only adjacent status additions in AGENTS.md; both branches'
notes were retained. README merged automatically. Range-diff and blob checks
confirmed all 23 feature code/test files exactly match the recovery branch and
all ten upstream script/config/test files exactly match main. No application
code was rewritten to resolve the conflicts. This entry is folded into the
last feature commit to retain four commits above main.

Verification on the combined tree:
- Backend `.venv/Scripts/python.exe -m unittest discover -s tests -q`: 72 tests,
  70 pass and two opt-in PostgreSQL tests skip without a test URL. Those two
  PostgreSQL tests also passed separately using the configured connection and
  connection-local pg_temp tables only, verifying reset/repeat reset and full
  rollback after a preference constraint failure. The application's news
  tables were neither reset nor modified. Compileall passes.
- Frontend `npm.cmd test`: 26 tests pass. `npm.cmd run build`: passes with
  30 modules. Chrome E2E on isolated ports 18000/15173 passes the complete
  onboarding/search/read/streaming-animation/regeneration/immediate-completion
  flow. Its model/extraction boundaries remain deterministic fixtures.
- All six committed lifecycle/test shell files pass Bash syntax checks. The
  three full shell integration suites (start, reset-feed, kill) also pass in a
  disposable LF tree under Git Bash 5.3.9. Windows checkout files are CRLF, so
  the harness copied committed LF blobs; test-only wrappers supplied Windows
  Python and the SQLite stdlib in place of the absent sqlite3 CLI. Production
  scripts/test files were unchanged. Fake-service processes, test directories
  and the disposable tree were cleaned up. The ignored helper scripts were
  removed after verification.
- Test commands exited normally; process inspection found no isolated browser,
  API, Vite, shell-test or fake-service processes and no listeners on
  8000/5173/18000/15173/11434. The old Windows dev PID record was stale at the
  start (no matching running roots/ports) and was removed after verification;
  no live user-owned service was terminated or database credentials changed.

Done: rebase, conflict resolution and combined verification. The user-authorized
remote update uses force-with-lease against the original d71c2e6 remote tip so
concurrent remote work cannot be overwritten. Next: review GitHub CI and merge
the four rebased commits through the normal PR workflow. Earlier entries that
say these changes are uncommitted are historical; all four were already pushed
before this rebase. No open dev-hjc PR was returned by GitHub during inspection.

### Local work rebased onto updated main (2026-10-09)

`bariguy/new_ai` was rebased from `0096ed9` onto `origin/main` at `27ab794`
(the remote default branch is `main`, with no remote `master`). The selective
summaries and CI changes are retained alongside the local environment-file
protection, database-aware scripts, stop script, tests, and documentation.
The sole restore conflict was the adjacent status additions in this file;
both sets of entries were preserved. All 12 pre-rebase changed/new files are
present; the ten non-document files match the pre-rebase backup byte-for-byte.
The local work remains uncommitted, with a recovery stash retained. No cleanup
refactor had been applied before the user's rebase request.

Verification on the combined tree: 58 backend tests pass (two opt-in PostgreSQL
tests skipped), compileall passes, all eight frontend tests and the Vite build
pass, and all three shell integration suites pass. Chrome E2E passes on isolated
ports 18000/15173, including selective summary requests. Test commands exited;
application/test ports 8000/5173/18000/15173 are closed, and the pre-existing
Ollama service at PID 48955 is preserved. Both local credential files remain
present, identical, ignored, and untracked; application data was not reset.

### Stop script (2026-10-09)

Done: executable `scripts/kill.sh` stops the backend and frontend recorded in
`.run/backend.pid` and `.run/frontend.pid`. It resolves paths from the script
location, exits silently and successfully when nothing is running, and removes
stale/invalid PID files. It sends SIGTERM, waits up to five seconds, then uses
SIGKILL if required and verifies exit before removing each live PID file. It
attempts both services and returns nonzero if either cannot be stopped. PID 0,
PID 1, negative values, and malformed values are rejected. Ollama, untracked
services, logs, configuration, and database contents are left untouched.
README documents `./scripts/kill.sh` and its launcher-tracked scope.

Verified: `/bin/bash -n scripts/kill.sh tests/test_kill.sh` and
`/bin/bash tests/test_kill.sh` pass. Coverage includes no runtime directory,
running/partially running services, repeated no-op, stale/invalid PIDs,
SIGKILL fallback, and preservation of untracked services and a fake Ollama.
All test-owned processes were stopped, reaped, and checked; temporary files
were removed. A separate real launch in an isolated copy with a temporary
SQLite database served both API and Vite. `kill.sh` stopped backend PID 15449
and frontend PID 15470, removed their PID files, and closed ports 8000/5173;
a second run was silent with exit code zero. The temporary copy was removed,
real application data was untouched, and existing Ollama PID 48955 remains
running. `git diff --check` passes. No application or test server remains.

### Database-aware scripts (2026-10-09)

Done: `scripts/start.sh` passes `backend/.env` to Uvicorn when present, retaining
SQLite startup without that file. `scripts/reset-feed.sh` invokes
`backend/app/reset_feed.py`, which loads the same dotenv file before importing
database configuration and uses the existing SQLite/PostgreSQL connection helper.
Exported variables take precedence for both commands. Environment files are
parsed rather than sourced as shell code; file credentials are not exported to
Vite or Ollama. Reset deletes articles and clears preferences in one transaction,
preserves feeds/schema, and reports the selected database type without its URI.
A failure rolls back and prevents relaunch; a missing local SQLite database
remains a no-op. Reset now supports Supabase and does not silently reset SQLite
when PostgreSQL is configured. The success message explains that ingestion waits
for category selection. README documents these behaviors and the destructive
scope of a hosted reset. This supersedes the script limitations reviewed below.

Verified: system Bash syntax checks and both shell integration suites pass,
including absent/present dotenv handling, no shell execution of dotenv values,
environment precedence, PostgreSQL failure without SQLite fallback, no relaunch
after failure, and credential-safe reset errors. The backend suite runs 56 tests:
54 pass and two opt-in PostgreSQL tests skip without `NEWS_TEST_POSTGRES_URL`.
Both PostgreSQL tests also passed separately on a real connection using only
connection-local temporary tables and `search_path=pg_temp`; they verify reset,
repeat reset, and rollback after preference failure. Connection closure removes
those tables. `compileall` and `git diff --check` pass.

An isolated real-script run copied the app to a temporary directory, used a
temporary SQLite database and synthetic article, and exercised startup, reset,
and repeated reset. API categories/preferences/articles, Vite HTTP 200, zero
article rows, preserved feed seeds, and custom CORS configuration loaded from
dotenv were verified. Backend/frontend pairs 14742/14765, 14824/14841, and
14900/14921 were stopped and verified absent; ports 8000/5173 are closed and the
temporary directory was removed. Shell-test processes/directories were also
cleaned up. Real application databases were not reset; pre-existing Ollama PID
48955 was preserved. No application server is left running.

### App shutdown and script review (2026-10-09)

At the user's request, backend PID 13239 and frontend PID 15760 were stopped,
verified absent, and their `.run/` PID files removed. Ports 8000 and 5173 are
closed. The pre-existing Ollama service (PID 48955, port 11434) was preserved.
`/bin/bash -n scripts/start.sh scripts/reset-feed.sh tests/test_start.sh
tests/test_reset_feed.sh` passed, as did `/bin/bash tests/test_start.sh` and
`/bin/bash tests/test_reset_feed.sh`. Both suites used temporary fake services;
reset checks used a temporary SQLite database. Final inspection found no test
processes or temporary test directories. No real article data was reset.

At review time, the unchanged scripts passed their local SQLite tests but did
not support the file-based Supabase workflow. Startup ignored `backend/.env`,
and reset always targeted `data/news.db`. These findings were addressed in the
database-aware scripts update above.

### Local app launch with shared configuration (2026-10-09)

At the user's request, the app was left running for interactive use at
`http://localhost:5173`. `uv sync --locked` installed the missing PostgreSQL
driver in the macOS backend environment. A read-only `SELECT 1` using the
supplied `backend/.env` succeeded without displaying credentials. The tracked
old backend PID 15733 was stopped and verified exited, then replaced with PID
13239 running Uvicorn on 127.0.0.1:8000 with `--env-file .env`; `.run/backend.pid`
records the replacement and output goes to `logs/backend.log`. Existing Vite
PID 15760 and Ollama PID 48955 were preserved. API categories and frontend HTTP
checks passed. Chrome displayed the Business feed and a completed article's
FACTS, IMPACT, and original-source link. The browser was returned to the feed.
The requested application services remain running; no temporary test server was
started. This launch supersedes the untested-connection status below.

### Shared environment file protection (2026-10-08)

Added `/env` to the root `.gitignore` for the shared backend credentials file.
The existing `.env` rule already covers `backend/.env`. No backend environment
file existed in this checkout, so the shared file was copied to `backend/.env`
with owner-only permissions (0600). File equality was verified without printing
credentials; `git check-ignore -v env backend/.env` confirms both are ignored,
and `git ls-files -- env backend/.env` confirms neither is tracked.
`git diff --check` passes. No service was started or restarted, and the supplied
database connection was not tested. The manual backend command still needs
`--env-file .env` to load this configuration. At that time the POSIX launcher
did not load it; the database-aware scripts update above added that support.

### Immediate progress completion notification (2026-10-17)

The user noticed a delay between 100% and Open summary because the individual
progress poll runs every second while the feed polls every five seconds. The
progress component now notifies Feed immediately when its API confirms done or
failed. Feed synchronously promotes the matching pending card, enabling Open
summary or Retry summary, and queues a serialized refresh for current search/
metadata. Per-article update revisions prevent older in-flight feed responses
from reverting confirmed completion to pending. Later requests still trust the
database, so external regeneration is not permanently masked. Terminal progress
polls stop; the stable callback does not restart polling on unrelated renders.
README documents immediate completion behavior.

Verification: `npm.cmd test` passes all 26 frontend tests and `npm.cmd run build`
passes (30 modules). New tests prove the link is available after a one-second
progress response before the five-second feed timer or refresh request returns;
an older pending poll cannot hide it; serialized reruns/timer cleanup still
work; and done/failed callbacks fire once and stop progress polling. Chrome E2E
on ports 18000/15173 deliberately holds an actual stale pending feed response
while summary work finishes. Open summary becomes visible within the assertion's
one-second limit without releasing that response; normal progress, animation,
regeneration/read persistence and the full user flow also pass. Test command
exited normally and isolated browser/API/Vite processes/listeners were verified
absent. Existing development services were preserved. `git diff --check` passes.

Done: immediate completion notifications. After review, the user requested
commit/push of re-summarization, spacing and completion-notification changes on
dev-hjc. Hosted CI results for this change are not yet recorded here.

### Re-summarize completed articles (2026-10-17)

After review, the user requested moving the helper text closer to the original-
source button. The detail-specific adjacent selector now reduces that button's
top margin from 2rem to 0.75rem. The production build and isolated Chrome E2E
pass; the updated 390-pixel news-resummarize-mobile.png was visually inspected
to confirm the tighter gap and readable wrapping. The E2E command exited and
its test processes/listeners were verified absent. Existing development
services remain running. This spacing adjustment is included in the same
uncommitted re-summarization change.

The user requested the ability to re-summarize an article. The detail page now
offers Summarize again after FACTS/IMPACT. It calls the existing summary endpoint
with explicit `?regenerate=true`, disables submission, and navigates to the feed
on success for the existing individual progress display. A failed transport
request leaves the current detail visible with an inline retry message. A ref
guards duplicate clicks, and completion after leaving the detail does not
redirect the user back to the feed. The original-source link remains available.

`POST /api/articles/{id}/summarize` defaults to its existing reuse behavior.
Only explicit regenerate=true adds done to the eligible states in the atomic
conditional UPDATE/RETURNING. Pending duplicates do not queue another worker;
unknown IDs return 404 and invalid boolean values return 422. Category/read
state, URL and article ID are unchanged. Queuing commits before background
work. Persisted pending regeneration resumes after restart; it uses summary-
only coordination, without refetching RSS. The existing extraction/model
pipeline runs again; wording is not guaranteed to differ.

The coordinator now retains any existing summary text when an attempt fails,
instead of clearing both sections. Only successful output replaces FACTS and
IMPACT together. A failed row still follows existing failed-card/Retry summary
behavior and is not exposed by the done-only detail endpoint; no stale text is
presented as a fresh result. Queueing also retains the old stored sections.
No schema/dependency change was required. README documents the opt-in API,
navigation, failure preservation and pending detail availability.

Verified on Windows:
- `.venv/Scripts/python.exe -m unittest discover -s tests -q`: 65 backend tests
  pass. New real API/coordinator/SQLite checks verify default reuse, explicit
  pending regeneration, duplicate-safe queueing, initialization with pending
  work retained, replacement of the same article, read-state preservation,
  progress reset/completion, no RSS calls, 404/422, failed-generation retention
  of previous sections and a retryable failed state. Compileall passes.
- `npm.cmd test`: all 22 frontend tests pass, including disabled duplicate
  clicks, explicit regeneration opt-in, feed navigation, failed request/retry
  with the current summary still visible and no late redirect after leaving.
  `npm.cmd run build` passes with 30 transformed modules.
- Chrome E2E on isolated ports 18000/15173 passes the existing full flow and a
  regeneration of its already-completed/read article. It verifies the actual
  opt-in POST response, feed progress from 18% through successful 100%, read
  badge retention, changed FACTS/IMPACT and persistence after page reload.
  `frontend/test-results/news-resummarize-mobile.png` was visually inspected
  at 390 px: button, explanatory text and source link fit the detail layout.
- A temporary Supabase transaction exercised the actual route SQL/default
  reuse, explicit and duplicate requests, failure retention, successful write
  replacement and read-state preservation. The probe did not execute queued
  background tasks or touch existing rows. All probe writes were rolled back,
  zero probe rows confirmed afterward, and the script removed.
- Test commands exited normally. Final inspection found no isolated Chrome/
  API/Vite/probe process or listener on 18000/15173. Existing user-requested
  development services were preserved; frontend HTTP 200 was confirmed.

Done: re-summarization and verification. Next: user review, then commit/push
when requested. Changes remain uncommitted on dev-hjc.

### Smooth progress animation (2026-10-16)

The user requested smoother individual progress bars. ArticleProgress now uses
an accessible ARIA progressbar track/fill with an 800 ms eased width transition
(`cubic-bezier(0.22, 1, 0.36, 1)`) rather than a native progress element with
discrete jumps. The fill glides only toward the latest reported percentage;
model estimates and polling are unchanged. `prefers-reduced-motion: reduce`
disables the transition. Rounded tracks/fills match the existing feed styling.
README documents the visual behavior.

Verification: all 19 frontend tests and `npm.cmd run build` pass (30 modules).
Chrome E2E on isolated ports 18000/15173 passes; it measures a real interpolated
fill width strictly between the backend's 18% and 43% updates, verifies the
0.8-second transition, and confirms reduced motion changes duration to zero.
Existing article progress, onboarding/search/read/detail/source checks pass.
The E2E command exited normally; process inspection found no test browser/API/
Vite process or test-port listener. User development services were preserved.
Done: smooth progress animation. After review, the user requested commit/push
of the individual streaming progress bars and animation on dev-hjc. Hosted CI
results for this change are not yet recorded here. Development services remain
running for the user.

### Individual streaming summary progress (2026-10-16)

The user rejected the batch-wide top bar and requested percentages on each
article while it is being summarized. The earlier batch UI, count-only API and
component tests have been replaced. `SummaryProgress.jsx` was replaced by
`frontend/src/components/ArticleProgress.jsx`; Feed embeds it in pending/failed
and completed cards, with no global bar. Untouched cards have no bar. Each
pending card polls its own endpoint once per second; completed cards show a
static 100%. Search/unmount cleanup cancels polling and ignores stale responses.
Progress errors offer a retry without hiding the article or inventing progress.

`GET /api/articles/{id}/progress` returns stage, percentage, elapsed_seconds and
estimated, or 404 for an unknown ID. The database summary status is authoritative:
only done rows return 100%; failed rows stay below it. No partial model output,
RSS excerpt or extracted text is exposed. The former `/api/summary-progress`
batch endpoint has been removed from this uncommitted feature.

`app/summary_progress.py` now stores bounded current-batch per-article entries
under a lock, not batch counters. Workers report extraction at 2%; queued work
remains at 0%. The Ollama client accepts an optional on_progress callback and
streams when it is supplied. Emitted characters estimate generation from 10%
up to 95% against the 512-token cap using approximately four characters/token.
This is explicitly an output-budget estimate, not an exact completion fraction
or remaining-time promise: the output's final length is unknown. The bar does
not animate from a timer; it may pause during extraction/model prefill and jump
when generation finishes. Format retries update their stage without decreasing
the displayed estimate. Validated output reaches Saving at 99%, with 100% only
after coordinator commit. Failures preserve their partial percentage. Stream
errors are contained and generators are closed. Default direct client calls
without a callback retain their non-streaming behavior.

Elapsed time uses a monotonic clock from worker start and freezes at completion.
Tracker entries reset on backend restart/new batches; persisted pending rows
resume normally and done/failed states survive in the database. This remains
single-process runtime tracking without schema/dependency changes. README now
documents individual estimates and their limitations instead of batch progress.

Verified on Windows:
- `.venv/Scripts/python.exe -m unittest discover -s tests -q`: 63 backend tests
  pass. Streaming tests cover incremental estimates, malformed-output retry,
  interrupted stream containment/closure and valid two-section output. Tracker
  tests cover independent articles, queued 0%, monotonic/bounded estimates,
  failure below 100%, retry reset, frozen elapsed time and restart behavior.
  Real coordinator tests confirm per-article in-flight progress and post-commit
  completion. API tests verify exact metadata-only fields and database status.
  `.venv/Scripts/python.exe -m compileall -q app tests` passes.
- `npm.cmd test`: all 19 frontend tests pass, including individual 0/intermediate/
  99/100 states, separate article percentages, elapsed time, failed attempts,
  retry, stale response isolation and unmounted timer cleanup. `npm.cmd run
  build` passes with 30 modules.
- Isolated Chrome E2E (`NEWS_E2E_BACKEND_PORT=18000`,
  `NEWS_E2E_FRONTEND_PORT=15173`, `npm.cmd run test:e2e`) passes. A controlled
  model callback reports 18/43/72% on the requested story while other cards are
  already complete, then the actual coordinator commits a successful summary
  and the card reaches 100%. Existing onboarding/search/read/detail/source
  checks also pass. The 390-pixel `news-article-progress-mobile.png` screenshot
  was visually inspected: each card's bar/percentage/elapsed time fits, with
  no global bar and no horizontal overflow.
- A standalone synthetic article through the actual installed Ollama model
  produced 143 streaming updates and 32 distinct percentages from 10 to 99,
  with nonempty FACTS (217 characters) and IMPACT (489 characters). It did not
  touch the application database. The temporary probe script was removed.
- Test commands exited normally. No isolated Chrome/API/Vite/probe process or
  listener on 18000/15173 remained. User-requested Vite/FastAPI and pre-existing
  Ollama were preserved. The live Supabase-backed API returned the new per-
  article endpoint metadata and Vite returned HTTP 200 after automatic reload.

Done: individual estimated streaming progress and verification. Next: user
review, then commit/push when requested. Changes remain uncommitted on dev-hjc.

### Initial summary batch progress (superseded, 2026-10-16)

Historical implementation/verification only: the individual streaming progress
section above supersedes the following batch-only API, UI and test counts.

The user requested a percentage progress bar for summarization. This extends
MVP pipeline/API/feed steps with `app/summary_progress.py`, a lock-protected
in-memory snapshot for the current single-process coordinator. A batch starts
after ingestion selects pending work; only its pending articles count. The
coordinator advances counts after committing each article result. Percentage
is floor(100 * (completed + failed) / total). Old completed/failed stories and
unrequested headlines do not inflate it. Failure counts remain distinct from
ready summaries; 100% means attempts finished, not universal success. Exceptions
leave an interrupted snapshot rather than a false completion. Empty refreshes
retain the last nonempty batch; new/rerun batches replace its counters.

`GET /api/summary-progress` exposes only status, total, completed, failed,
processed and percentage, with a constrained response model. It is independent
of article search/category display filters and the 50-result limit. No schema,
dependency, external AI or ingestion-provider changes were needed. Counters
reset on backend restart; persisted pending rows resume and form a new batch
of remaining work. This intentionally does not add durable job history or
multi-process coordination. Those would require a shared progress store if
the architecture later changes.

`frontend/src/components/SummaryProgress.jsx` shows an accessible native
progress element below the feed header, an explicit percentage, processed/
ready/failed counts, and running/completion/interrupted descriptions. Its
independent serialized poll runs every five seconds; successful summary
requests refresh it immediately. Search does not reset or filter batch progress.
Stale in-flight requests and unmounted timers are ignored/cleared. Transport
failures hide the stale bar and show Retry progress without hiding the feed.
Idle zero-work state hides the panel. This is article-attempt progress, with
no invented per-article token percentage or time estimate. README documents
the API, denominator, failures, polling and restart behavior.

Verified on Windows:
- Backend `.venv/Scripts/python.exe -m unittest discover -s tests -q`: all 59
  tests pass. A controlled real coordinator/SQLite test observes 50% while
  the second worker is blocked and confirms the first result is already
  committed. It verifies a 100% batch with one ready/one failed, untouched and
  older-done exclusion, no-op retention, next-batch reset and interrupted save
  failure at 0%. API coverage checks exact idle count-only fields.
  `.venv/Scripts/python.exe -m compileall -q app tests` passes.
- Frontend `npm.cmd test`: 19 tests pass, including idle/0/50/100, failed and
  interrupted states, transport failure/retry, request-triggered refresh,
  stale-response isolation and timer cleanup. `npm.cmd run build` passes,
  with 30 transformed modules.
- `NEWS_E2E_BACKEND_PORT=18000`, `NEWS_E2E_FRONTEND_PORT=15173`,
  `npm.cmd run test:e2e`: the real API/coordinator/SQLite/Chrome flow passes,
  observing 1 of 2 processed at 50%, then 100% and completed summaries. Its
  controlled model boundary delays one fixture seven seconds to expose a
  genuine intermediate batch state. The existing onboarding/search/read/
  source-link flow also passes. The test has a 45-second timeout for that
  extra work. `frontend/test-results/news-summary-progress-mobile.png` was
  visually inspected at 390 px; the green bar, percentage and counts fit,
  and the browser assertion confirms no horizontal overflow.
- `git diff --check` passes. All test command sessions exited. Final process
  inspection found no isolated E2E browser/API/Vite processes, and ports
  18000/15173/8000/5173 had no listeners. An existing Ollama listener PID 25668
  on 11434 was preserved; this change did not start Ollama or use its model.
  No application database was used or changed by the isolated tests.

Done: summary batch progress and verification. Next: user review, then
commit/push when requested. Changes are uncommitted on `dev-hjc`; no development
servers were started for this work. The pre-existing AGENTS.md shutdown record
was preserved.

For the subsequent user-requested review, Vite was started (tracked root 33480)
and the existing Ollama listener PID 25668 reused; llama3.1:8b was available.
The first backend startup failed because the Supabase pooler rejected its
configured tenant/user. After the user confirmed the project was active, the
failed backend tree was replaced with tracked root 18372 using `--env-file .env`.
Readiness checks then confirmed five API categories, frontend HTTP 200, and
the actual summary-progress endpoint running at 25%. Development services are
intentionally left running at `http://localhost:5173/feed` for user review;
roots are recorded in ignored `.run/windows-dev.json` and output in `logs/`.
No database credential change, SQLite fallback or feed reset was performed.

### Read article indicators (2026-10-09)

The user requested a visible indication of articles already opened/read. This
extends MVP schema/API/feed/detail steps with nullable `articles.read_at` (UTC
ISO-8601 text) and `POST /api/articles/{id}/read`. An atomic `UPDATE` with
`COALESCE` and `RETURNING` preserves the first open and leaves summary state
unchanged. Unknown IDs return 404. Both list and completed detail responses
include `read_at` while retaining their private-field boundaries. This remains
single-user shared database state, not authentication or per-user tracking.

Both fresh schemas include the column. Existing SQLite databases are migrated
after inspecting `PRAGMA table_info`; PostgreSQL uses `ADD COLUMN IF NOT EXISTS`.
Startup initialization remains idempotent and preserves existing data; older
articles start unread. The configured running Supabase database now has the
column. No new dependency or historical read-state backfill is added.

The feed shows Read beside category/source metadata and uses a softer headline
color. A successfully loaded summary (including direct navigation) records an
open via POST; GET itself has no read-state side effects. Normal and middle
clicks on a feed original-source link also record it without delaying link
navigation. Read means opened, not measured reading completion; browser
context-menu opens cannot be detected by the app. Only successful writes show
the badge, failures offer an inline retry, and saved state survives polling,
search, refresh and restart. Feed-local confirmed timestamps prevent an older
poll response from hiding a just-saved badge. Normal article expiry/reset also
removes read history. README documents these semantics.

Verified on Windows:
- Backend `.venv/Scripts/python.exe -m unittest discover -s tests -q`: 57 tests
  pass. Coverage includes unread defaults, all four summary states, first-open
  idempotency, search/list/detail visibility, missing IDs, and existing SQLite
  migration with article/read-state preservation across repeat initialization.
  `.venv/Scripts/python.exe -m compileall -q app tests` passes.
- Frontend `npm.cmd test`: 15 tests pass, including direct detail opens, no
  write for unavailable/already-read details, failed-write retries, and original
  opens retaining the badge during polling. `npm.cmd run build` passes with
  29 transformed modules.
- `NEWS_E2E_BACKEND_PORT=18000`, `NEWS_E2E_FRONTEND_PORT=15173`,
  `npm.cmd run test:e2e`: real isolated API/SQLite/Chrome flow passes original
  new-tab opens, pending read state without starting summaries, detail read
  marking, reload persistence, and existing onboarding/search/summary flow.
  `frontend/test-results/news-read-mobile.png` was visually inspected at 390 px:
  Read badges and softer headlines remain legible and fit the card metadata.
- Supabase initialization ran twice successfully; a temporary transaction
  exercised the real read/list route functions with PostgreSQL, confirming
  first-open idempotency, unchanged unrequested state and list visibility.
  Probe writes were rolled back and zero probe rows confirmed afterward.
  Live development API responses expose read_at. The probe script was removed.

The first migration test passed its assertions but failed Windows cleanup due
to a plain SQLite connection left open. The fixture now uses ClosingConnection;
the full suite passed and the old temporary database was removed. The first
extended E2E placed its pending original-source check after the real summary
coordinator completed that fixture. Moving the check before summarization
resolved it; the rerun passed. Both browser commands exited and final inspection
found no E2E browser/server processes or listeners on ports 18000/15173.
During review, development services remained running with their tracked roots in
`.run/windows-dev.json`; Vite returned HTTP 200 and the backend served the new
fields after automatic reload. After the user's subsequent shutdown request,
all eight tracked application/Ollama descendant processes were stopped, ports
8000/5173/11434 verified closed, and `.run/windows-dev.json` removed.
Done: read indicators and verification. After
user review, the user requested commit/push on `dev-hjc`. Hosted CI results for
this change are not yet recorded here.

### Keyword article search (2026-10-09)

The user requested a search bar for fetched articles. This extends MVP steps 7
and 9 with optional `q` on `GET /api/articles` (maximum 200 characters).
Search trims surrounding whitespace, ignores case, and matches a literal phrase
against title, source, category, RSS excerpt and available FACTS/IMPACT summaries.
Blank search retains the original feed; category filters and all four summary
states remain supported. Parameterized SQL escapes `!`, `%` and `_` with an
explicit escape character on SQLite and PostgreSQL. Filtering precedes ordering
and the existing result limit. List responses still omit excerpts, summaries
and extracted text; extracted text is not searched. No schema or dependency
change, RSS fetch or AI request is needed for searching.

The feed has a labeled search input below its header, a 300 ms typing debounce,
a Clear search button and a distinct No matching stories state. Polls and
summary-triggered refreshes retain the active search. Effect cleanup ignores
responses from older searches and cancels their polling timers. Search uses
the existing selected-category scope and shows at most 50 matching stories.
README documents the scope, limit and API query.

Verified on Windows:
- Backend `.venv/Scripts/python.exe -m unittest discover -s tests -v`: all 55
  tests pass, including each searchable field, category scoping, trimming/case,
  literal wildcard punctuation, injection input, response privacy and matching
  an older article beyond 51 newer nonmatches. `compileall -q app tests` passes.
- Frontend `npm.cmd test`: all ten tests pass, including debouncing, search
  polling, no matches, clearing and ignoring a stale response.
- `npm.cmd run build`: passes with 29 transformed modules.
- `NEWS_E2E_BACKEND_PORT=18000`, `NEWS_E2E_FRONTEND_PORT=15173`,
  `npm.cmd run test:e2e`: isolated real API/SQLite/Chrome flow passes search,
  no-match/clear behavior and the existing onboarding/summary/detail/source flow.
  A 390-pixel mobile viewport has no horizontal overflow. The generated
  `frontend/test-results/news-search-mobile.png` was visually inspected: search,
  Clear search, helper text and matching card fit comfortably.
- A temporary read-only probe loaded the backend environment privately, tested
  literal/case-insensitive PostgreSQL matching, and called the actual list route
  with search/category filters through Supabase. Public shapes passed; no
  application rows were written or changed. The probe script was removed.

The E2E command exited normally and its API/Vite ports 18000/15173 were closed
afterward; no development services were started. Done: keyword search and
verification. After user review, the user requested commit/push on `dev-hjc`
with message `Search bar for article keyword`. CI runs when pushed; hosted
results for this change are not yet recorded here.

For user review on 2026-10-09, development services were subsequently started
and intentionally left running. Hidden Windows process roots are recorded in
ignored `.run/windows-dev.json` (backend 48900, frontend 45784, Ollama 54560),
with output in `logs/`. FastAPI loads `backend/.env`; readiness checks confirmed
five API categories, Vite HTTP 200 at `http://localhost:5173/feed`, and the
configured `llama3.1:8b` model available through Ollama. No feed reset was requested.

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
checks remain separate. The official Ubuntu 24.04 runner image includes Google
Chrome; CI verifies it with `google-chrome --version` before running the actual
Chrome flow. Playwright's CI configuration
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

The first GitHub run passed backend tests, frontend tests and production build,
but its redundant Chrome/dependency installation spent several minutes without
finishing. That run was cancelled and the workflow switched to the preinstalled
runner Chrome. Official action pins were also updated to checkout v7.0.1,
setup-node v7.0.0, setup-uv v10.2.0 and upload-artifact v7.0.2 after the first run
reported deprecated action runtimes. Ubuntu 24.04 is explicit to avoid a pending
`ubuntu-latest` image migration. The revised workflow passes actionlint.

Hosted verification: commit `583d4d7` completed all four jobs successfully in
GitHub run `37672890581`
(`https://github.com/bariguy2/news/actions/runs/37672890581`). Logs confirm 53
backend tests, eight frontend tests, 29 transformed production modules and one
passing Chrome E2E test using Google Chrome 154.0.8037.57. The uploaded
`chrome-e2e-results` artifact was confirmed present (524,373 bytes, unexpired).
The cancelled first run reached a terminal cancelled state and its CLI watcher
exited; the revised run watcher exited successfully. No local service or test
process remains from CI setup.

Done: workflow implementation, local validation and real GitHub execution with
all four jobs passing. Next: merge the CI change into `main` through the normal
PR workflow; an administrator can optionally require the four checks before
merging. This extends MVP step 11's verification workflow without adding
application hosting or deployment.

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
Uvicorn's `--env-file` option. The POSIX launcher now loads this file when present,
with inherited environment variables taking precedence. A Session pooler URI is
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
writes service output under `logs/`. It passes an existing `backend/.env` to
Uvicorn, preserving exported variable precedence and SQLite fallback when no
database URL is configured. Re-running it bounces only those tracked
backend and frontend processes. It polls real HTTP endpoints before reporting
readiness, tails the relevant log on failure, and refuses to replace untracked
processes already serving ports 8000 or 5173. The manual three-terminal
development workflow remains documented alongside it in `README.md`.

`scripts/reset-feed.sh` provides the destructive clean-slate workflow. It stops
PID-tracked backend/frontend processes, refuses to delete data while an
untracked application server is present, atomically deletes every article and
clears onboarding preferences in the configured SQLite or PostgreSQL database
using `app.reset_feed` and the backend connection helper, calls `scripts/start.sh`, and
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
5. Handle external failures explicitly. RSS, article extraction, and AI providers are unreliable boundaries and should fail without taking down the pipeline.
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
