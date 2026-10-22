# Local News Aggregator

> ⚠️ **Work in progress.** This is an early, single-user prototype under active
> development. Features, schema, and APIs may change, and it is not intended for
> production use.

A single-user news briefing that runs locally on Windows or macOS. It collects a curated set of
RSS feeds, extracts article text, creates shared FACTS and IMPACT summaries with
configurable hosted AI, and serves a category-filtered React interface.

## Prerequisites

- Windows (PowerShell), or macOS with Homebrew
- Python 3.12 managed by `uv`
- Node.js and npm
- A Groq API key (default), or Gemini API key; Ollama is optional for local mode

On macOS, install uv:

```sh
brew install uv
```

Install project dependencies:

```sh
cd backend
uv sync --locked

cd ../frontend
npm ci
cp .env.example .env
```

Create `backend/.env` from `backend/.env.example` **only if it does not already
exist**, then set `GROQ_API_KEY`. Keep all AI keys on the backend. To use Gemini
instead, set `SUMMARY_PROVIDER=gemini` and `GEMINI_API_KEY`. Both keys are needed
for the optional comparison tool. Restart the backend after configuration changes.

Start with free-tier accounts; no paid subscription is required by the app.
Free quotas are limited, and the app cannot determine billing status from an API
key. Keep paid billing disabled in the provider dashboards if zero charges are
required. The app never upgrades accounts or falls back to another provider.

## Quick start

### Windows (PowerShell)

Use Python 3.12 managed by uv and the locked backend/frontend dependencies.
Open a new terminal after installation to refresh PATH.
For future dependency installs, run `uv sync --locked` in `backend` and
`npm.cmd ci` in `frontend`. Copy `frontend/.env.example` to `frontend/.env`
if the latter does not exist.

Run these commands in two separate PowerShell terminals from the repository root:

```powershell
# Terminal 1
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000 --env-file .env

# Terminal 2
cd frontend
npm.cmd run dev
```

Open [http://localhost:5173](http://localhost:5173). Stop each terminal's server
with Ctrl+C when finished. The existing `scripts/start.sh` and
`scripts/reset-feed.sh` are macOS/POSIX launchers; use the commands above on
Windows. WSL, Docker, Homebrew, and a separate SQLite installation are not
needed for this workflow.

Windows checks: run `.\.venv\Scripts\python.exe -m unittest discover -s tests -v`
from `backend`; run `npm.cmd test`, `npm.cmd run build`, and
`npm.cmd run test:e2e` from `frontend`. The browser test uses installed Chrome
on either platform; `PLAYWRIGHT_CHROME_PATH` can override its location.

### macOS

Launch the complete app in the background from the repository root:

```sh
./scripts/start.sh
```

The script validates AI configuration, then starts the backend and frontend.
Hosted mode does not require or start Ollama. With `SUMMARY_PROVIDER=ollama`,
it starts Ollama only when its local service is unavailable.
It prints [http://localhost:5173](http://localhost:5173)
after both servers are ready and returns control to the terminal. Running it
again stops and replaces only the backend and frontend previously started by
the script; it never stops Ollama. It refuses to replace an untracked process
already serving port 8000 or 5173. Runtime PID files are written under `.run/`,
with service output under `logs/`.

The launcher loads `backend/.env` when it exists. A nonempty `DATABASE_URL`
selects Supabase PostgreSQL; otherwise the backend uses `data/news.db`.
Variables already exported in your terminal take precedence over the file.
The file is parsed as dotenv configuration, never executed as shell code.

Stop the backend and frontend started by the launcher:

```sh
./scripts/kill.sh
```

This stops only the processes recorded in `.run/backend.pid` and
`.run/frontend.pid`, leaving Ollama and stored data untouched. It exits quietly
when the app is already stopped and clears stale PID files. It waits up to five
seconds for graceful shutdown, then uses SIGKILL if needed. Manually started,
untracked servers must be stopped in their own terminals.

Reset all stored articles and onboarding preferences, then relaunch and trigger
an immediate pipeline refresh:

```sh
./scripts/reset-feed.sh
```

This is a destructive full-feed reset of the **configured database**, including
Supabase when `DATABASE_URL` is set. It uses the same `backend/.env` and exported
variable precedence as the launcher. Every article is deleted and current
category selections are cleared in one transaction before the app restarts at
onboarding; feeds, summary-version history, and AI usage records are preserved.
History retains summary text and source URLs after article deletion. Reset is
not a complete data-erasure command and cannot reset the usage allowance.
A failed reset rolls back and does
not relaunch the app. A missing local SQLite database is a no-op.
The queued refresh does no feed work until you select categories again.

Use the manual commands below when active development requires backend reloads.

## Run locally

Hosted mode uses two local processes. Keep each command running in its own
terminal. Start the REST API and background pipeline:

```sh
cd backend
.venv/bin/uvicorn app.main:app --reload --port 8000 --env-file .env
```

Start the web interface:

```sh
cd frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The frontend reads
`VITE_API_BASE=http://localhost:8000` from `frontend/.env`.

Onboarding has three steps. Choose broad categories, then optionally choose more
focused topics: business industries, sports and teams, technology subjects,
world regions, or science topics. Finally, choose how AI summaries should read.
Team choices include a short starting list and an **Add team** field.
**Back to categories** and **Back to topics** preserve current choices;
removing a category clears its details, and removing a sport clears its teams.
Only **Build my briefing** on the final screen saves and completes onboarding. A failed save keeps
the choices available for retry.

Detailed interests are saved for upcoming backend support. They do **not**
currently filter, rank, fetch, or summarize articles; the feed still uses broad
categories. The second screen makes this limitation visible. Existing users
are not forced through onboarding again. Reloading an unfinished onboarding
starts a fresh selection; there is no saved draft.

`GET` and `POST /api/preferences` now include optional `focused_interests`, a
map from selected category to `{ "topics": [...], "teams": { "Basketball":
["Toronto Raptors"] } }`. Team keys must match selected Sports topics. A
category can have up to 20 topics, each sport up to 20 teams, and names up to
80 characters. Requests omitting this field remain valid and save an empty
map. Preferences use one JSON-text column with an empty-object default;
startup migrates existing SQLite and PostgreSQL tables without resetting
articles or onboarding. Resetting the feed also clears these details.

The final screen offers **Neutral**, **Conversational**, or **Analytical** tone;
**Brief**, **Standard**, or **Detailed** length; and **Bullet points**,
**Paragraphs**, or **Mixed** format. Mixed uses bullets for Facts and a paragraph
for Impact. A local illustrative preview types out Facts followed by Impact
with a blinking caret when choices change, without calling the model. The
completed layout is reserved to avoid shifting controls while text appears.
Screen readers receive the complete text; reduced-motion preferences show it
immediately. Unlike the focused topics, summary style is already used by the
configured AI provider for newly generated summaries and operator replacements.
Published summaries are shared and reused; a new preference does not rewrite
them. There is no reader regeneration button. Facts remain grounded and neutral
in all tones.
The model's wording, exact length, and adherence to the requested style may vary.

Preferences GET/POST adds `summary_style` with `tone`, `length`, and `format`.
Defaults are `neutral`, `standard`, and `paragraphs`; omitted or empty objects
use defaults, and invalid/unknown options return 422 before saving or queuing
work. SQLite/PostgreSQL store a separate JSON-text field with an empty-object
default and an idempotent startup migration. Feed reset restores default style,
including on legacy databases before migration. Each pipeline cycle snapshots
the saved style for its workers. Malformed stored styles fall back to defaults.
Hosted generation retains the configured provider output cap, including room
for reasoning; choosing a style never increases that cap or bypasses usage
reservations. In optional Ollama mode, the visible 256/512/768-token style
budget is capped by `OLLAMA_MAX_OUTPUT_TOKENS`. Streaming progress uses the
chosen style's visible-text estimate. Version provenance records the prompt
version and tone/length/format; comparisons made with the prior prompt version
require a new result directory. Facts and Impact markers remain
unchanged, and article details safely render plain paragraphs and simple lists
without interpreting model-provided HTML.

The scheduler runs immediately when the backend starts and then every 30
minutes. Before onboarding it has no selected categories and does no feed work.
Saving preferences triggers an immediate refresh that ingests only the selected
categories and only stories from the latest 48 hours. Up to three requested
articles are extracted and summarized concurrently. Automatic generation is
off by default (`AUTO_SUMMARY_LIMIT=0`). Choose **Summarize** on an
article to queue it, or follow its original-source link. Untouched stories
remain waiting across refreshes and restarts. Failed summaries show a
**Retry summary** button. Existing queued summaries resume after restart.
The feed polls every five seconds while empty or while a summary is pending,
and every fifteen seconds otherwise. A manual refresh can also be queued with:

```sh
curl -X POST http://localhost:8000/api/refresh
```

To request one summary through the API, use
`POST /api/articles/{id}/summarize`. Repeated requests reuse queued or completed
work. This processes queued articles without refetching feeds.

All clients read the same saved summary for an article. Opening it does not call
AI again. The public Summarize again action is removed and
`POST /api/articles/{id}/summarize?regenerate=true` returns 403. An operator can
queue a replacement from `backend/`:

```sh
.venv/bin/python -m app.summarize.manage regenerate 123
```

This queues work for the next scheduler refresh or **Refresh feed** action;
it does not launch another worker. Successful replacements publish a new
immutable version and preserve earlier versions and read state. Failures keep
the old stored sections but use the existing failed-card/retry flow; pending or
failed details remain unavailable. Detail responses include `summary_version_id`.
Startup archives existing summaries as `legacy` with unknown model attribution.

Use **Search articles** at the top of the feed to find fetched stories in your
selected categories. Search ignores letter case and matches a literal phrase
in titles, sources, categories, RSS excerpts, and available FACTS/IMPACT summaries.
Results update after a short typing pause; **Clear search** restores the feed.
Search does not fetch new articles or request AI summaries. The API accepts
`GET /api/articles?category=Tech&q=quantum`; filtering happens before the
existing 50-result limit, so matches outside the latest 50 stories can appear.
Extracted full article text is not searched or returned.

Article cards show a **Read** badge and a softer headline color after you open
their summary or use the feed's original-source link (including middle-click).
Here, Read means opened; the app does not measure reading completion. Opening
a summary directly also records it. The first-open timestamp is stored in the
selected database and survives refreshes and restarts. Existing articles start
unread. If saving fails, the article remains usable and offers a retry message.
`POST /api/articles/{id}/read` records the first open idempotently; headline and
detail responses include nullable `read_at`. Startup adds this column to
existing SQLite and PostgreSQL tables without clearing articles or preferences.
This is still a single-user app: the read state is shared by clients using the
same database and is removed when its article is purged or the feed is reset.

Opening an unread summary plays the onboarding-style typing effect in both
Facts and Analysis at the same time. Each section has its own duration.
The saved read timestamp prevents replay
on later visits or reloads. The first animation continues while read status
is saved; once finished, the full text stays visible. Reduced motion shows
everything immediately. The layout is reserved while typing, and screen
readers receive complete text. This is a display effect on the saved summary;
it does not request AI again.

Each requested article has its own progress bar. Queued articles start at 0%,
reading the article starts at 2%, and streamed model output advances an
**Estimated** percentage from 10% up to 95%. A valid two-section response moves
to Saving at 99%; **100% is reserved for a successful database commit**. Failed
attempts stop below 100% and retain the Retry summary action. Untouched articles
have no bar. Completed cards show Summary ready and 100%.

Estimates update every second while pending, alongside the processing stage
and elapsed processing time.
When progress confirms completion, the card immediately enables **Open summary**
without waiting for the feed's separate five-second refresh. Confirmed failures
likewise enable retry immediately. Progress polling stops on either final state.

The bar's fill glides to each reported percentage with an 800 ms ease-out
transition. Reduced-motion preferences disable this animation. This visual
transition does not create additional model progress or advance past the latest
reported value.

The generation estimate uses emitted visible characters against a 2,048-character
target; hidden reasoning is excluded. This target is separate from token limits.
It cannot know the final output length or remaining time: the bar may pause or
jump as stages complete and is explicitly labeled estimated. Format retries
change the stage without decreasing the estimate. It does not advance from a
timer while the model is stalled. Progress-request failures offer Retry progress.

`GET /api/articles/{id}/progress` returns only stage, percentage, elapsed_seconds
and estimated. It does not expose article text or partially generated summaries.
Tracking lives in memory for the current single-process backend. After a
restart, persisted pending work resumes from a fresh estimate; completed and
failed states remain authoritative in the database.

## AI configuration and usage safeguards

`SUMMARY_PROVIDER=groq` uses `openai/gpt-oss-120b`; `gemini` uses
`gemini-3.5-flash-lite`. Set `GROQ_MODEL` or `GEMINI_MODEL` to change models.
Custom models require explicit `*_INPUT_USD_PER_MILLION` and
`*_OUTPUT_USD_PER_MILLION` prices. Default rates are based on the
[Groq model list](https://console.groq.com/docs/models) and
[Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).
These rate cards need updating when provider prices change.

`AI_MONTHLY_BUDGET_USD=5` and `AI_EVAL_MONTHLY_BUDGET_USD=1` are separate monthly
**list-price-equivalent usage allowances**, not subscriptions, actual invoice
amounts, or paid-tier opt-ins. Even free calls count against them. Set either to
zero to block hosted calls for that scope. Reservations are committed before
every attempt, including retries, so concurrent calls cannot reserve beyond
the allowance. Reported input/output usage settles reservations; output includes
reasoning tokens. Interrupted calls or missing usage retain the conservative
reservation. Accounting survives resets/restarts and uses UTC calendar months.
These estimates cannot guarantee an invoice amount, particularly if provider
prices change; provider billing settings remain authoritative.

Defaults: 6,000 source characters, 2,048 hosted output tokens including reasoning,
60-second request timeout, at most two attempts, and three concurrent calls per
process. Configuration is documented in `backend/.env.example`. Quota (429) and
credential errors stop an article attempt without retry or provider fallback.
Other transient/format failures have bounded retries; every attempt is recorded.
View persisted usage from `backend/`:

```sh
.venv/bin/python -m app.summarize.manage usage
```

Amounts are integer nanodollars (`used_nano / 1e9` gives estimated USD). The
`ai_attempts` table records provider/model, prompt version/hash, tokens, latency,
outcome and estimated charge without storing credentials or reasoning text.
Summary history and usage currently have no automatic retention limit.

Run one backend process; pipeline coordination and progress are process-local.
This remains a single-user prototype, without authentication, per-user quotas,
distributed job claims, or public deployment controls.

For local generation, set `SUMMARY_PROVIDER=ollama`, install Ollama, pull
`llama3.1:8b`, and start `ollama serve` before manual API startup. The macOS
launcher handles starting its service. Local calls use the same interface and
record zero estimated cost; no automatic fallback to Ollama occurs.

## Automated Groq/Gemini comparison

One application is enough: the offline runner sends the same frozen source text
to both providers without changing published summaries. From `backend/`:

```sh
.venv/bin/python -m app.summarize.benchmark export --output ../data/evaluations/cases.json --limit 40
.venv/bin/python -m app.summarize.benchmark run --input ../data/evaluations/cases.json --output ../data/evaluations/run-1
```

Export samples stored text across categories, falling back to RSS excerpts, and
refuses to overwrite the input. It may export fewer cases if insufficient usable
text exists. Aim for 30–50 representative articles before deciding on quality.
The default evaluator is Groq GPT-OSS 20B with candidate order swapped. It scores
source faithfulness, coverage, clarity, and grounded impact. It can be biased or
wrong and is not an external fact checker. Use `--judge none` to skip judging or
`--judge gemini` / `--judge ollama` for the selected provider's configured model.

The runner saves `manifest.json`, `results.json`, and `report.md`, including
valid-output rate, latency, token/cost totals including retries, order-consistent
preferences, flagged cases, and a small review sample. Check flagged cases and
the sample against their sources before selecting a provider; switching is
always explicit. Automated checks reduce review, but cannot prove factual truth.

Calls are paced 30 seconds apart (`--pause-seconds`), use the separate evaluation
allowance, and pause on budget/quota/credential limits (CLI exit 2). Resume the
same command after resolving the limit; successful calls are reused. Input,
model, price, prompt, or evaluator changes require a new output directory.
Other terminal failures remain saved; use a new run to retest them. After a
crash, remove `running.lock` only after verifying its process has exited.
Artifacts contain source text and stay under ignored `data/evaluations/`.

Likes/dislikes tied to summary versions, user accounts, and public hosting are
follow-up work; this change lays the foundation without adding those features.

By default, runtime data stays in the ignored `data/news.db`. To store it in
Supabase Postgres, create a Supabase project and copy its **Session pooler**
connection URI from the project's Connect panel into an ignored `backend/.env`
file as `DATABASE_URL=...`. Use the URI exactly as supplied by Supabase, with
your database password filled in; keep it out of `frontend/.env`, Git, and chat.
The backend uses TLS by default. The Session pooler is the suitable option for
this persistent FastAPI process when a direct IPv6 connection is unavailable.
The transaction pooler is not supported because the backend selects a private
schema for each connection.

On Windows, copy `backend/.env.example` to `backend/.env`, replace the commented
placeholder with the real URI, and start the API from `backend/` with:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000 --env-file .env
```

On macOS, add `--env-file .env` to the manual Uvicorn command from `backend/`,
or use `./scripts/start.sh`, which loads the file automatically. Restart the API
after changing the file. The frontend and
Ollama commands do not change. FastAPI initializes the private `news` schema,
its tables, RLS, and starter feeds on first connection. A new Supabase database starts
with empty articles and onboarding preferences; existing SQLite articles are not
automatically copied. The local database remains available when `DATABASE_URL`
is absent. Keep the database URI on the backend only.

## Verify

Backend tests:

```sh
cd backend
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m compileall -q app tests
```

On macOS, check the launcher, reset, and stop scripts from the repository root:

```sh
/bin/bash tests/test_start.sh
/bin/bash tests/test_reset_feed.sh
/bin/bash tests/test_kill.sh
```

These use temporary services and data. The backend suite also includes opt-in
PostgreSQL reset and hosted-AI storage tests: with `NEWS_TEST_POSTGRES_URL` set privately in your
environment, run `.venv/bin/python -m unittest discover -s tests -p
'test_reset_feed_postgres.py'` from `backend/`. They use connection-local temporary
tables, leaving the application's `news` tables untouched. Use the pattern
`test_hosted_postgres.py` for budget settlement, version migration and retention.

Frontend component and production-build checks:

```sh
cd frontend
npm test
npm run build
```

The Playwright test starts an isolated real API and Vite server, uses the local
Google Chrome installation, and does not touch `data/news.db`:

```sh
cd frontend
npm run test:e2e
```

If Chrome is installed elsewhere, set `PLAYWRIGHT_CHROME_PATH` to its executable
before running the browser test. When ports 8000 or 5173 are already occupied,
set `NEWS_E2E_BACKEND_PORT` and `NEWS_E2E_FRONTEND_PORT` to unused ports.

## Automated checks on GitHub

`.github/workflows/ci.yml` runs on every branch push, on pull request creation,
updates and reopening, and through the Actions tab's **Run workflow** button.
Local commits trigger it after they are pushed. It reports four separate checks:

- **Backend tests**: locked Python 3.12 dependencies, unit/API/pipeline tests,
  and Python compilation.
- **Frontend tests**: locked npm dependencies and Vitest.
- **Production build**: the Vite production build.
- **Chrome E2E**: isolated FastAPI/Vite servers and the real Google Chrome flow.

Open a commit's checks, a PR's **Checks** tab, or the repository's **Actions** tab
to see the tested commit and each job's logs. The browser job uploads
`chrome-e2e-results` for seven days, including its HTML report, screenshots and
failure traces when available. Pushes to an open PR can produce both a push run
and a PR run; the PR run checks the proposed merge with the base branch.

CI uses temporary SQLite data and controlled external-service responses. It
needs no `.env` files, Supabase credentials or local Ollama service. Live model
and hosted-database checks remain separate integration checks. A concise PR
test plan can reference the CI results and describe any manual checks.

To prevent merges when CI fails, a repository administrator can configure
protection for `main` to require these four checks. The workflow itself reports
results; it does not configure branch protection.
