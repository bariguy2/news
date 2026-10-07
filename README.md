# Local News Aggregator

> ⚠️ **Work in progress.** This is an early, single-user prototype under active
> development. Features, schema, and APIs may change, and it is not intended for
> production use.

A single-user news briefing that runs locally on Windows or macOS. It collects a curated set of
RSS feeds, extracts article text, creates local FACTS and IMPACT summaries with
Ollama, and serves a category-filtered React interface.

## Prerequisites

- Windows (PowerShell), or macOS with Homebrew
- Python 3.12 managed by `uv`
- Node.js and npm
- Ollama with `llama3.1:8b`

On macOS, install the local tools and model:

```sh
brew install uv ollama
ollama pull llama3.1:8b
```

Install project dependencies:

```sh
cd backend
uv sync

cd ../frontend
npm install
cp .env.example .env
```

## Quick start

### Windows (PowerShell)

This PC has Python 3.12 managed by uv, the locked backend/frontend dependencies,
and Ollama installed. Open a new terminal after installation to refresh PATH.
For future dependency installs, run `uv sync --locked` in `backend` and
`npm.cmd ci` in `frontend`. Copy `frontend/.env.example` to `frontend/.env`
if the latter does not exist.

Run these commands in three separate PowerShell terminals from the repository root:

```powershell
# Terminal 1 (only if the Ollama desktop app is not already serving)
& "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" serve

# Terminal 2
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000

# Terminal 3
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

The script starts Ollama only when its local service is unavailable, then starts
the backend and frontend. It prints [http://localhost:5173](http://localhost:5173)
after both servers are ready and returns control to the terminal. Running it
again stops and replaces only the backend and frontend previously started by
the script; it never stops Ollama. It refuses to replace an untracked process
already serving port 8000 or 5173. Runtime PID files are written under `.run/`,
with service output under `logs/`.

Reset all stored articles and onboarding preferences, then relaunch and trigger
an immediate pipeline refresh:

```sh
./scripts/reset-feed.sh
```

This is a destructive full-feed reset: every article is deleted and current
category selections are cleared before the app restarts at onboarding.

Use the manual commands below when active development requires backend reloads.

## Run locally

The app uses three local processes. Keep each command running in its own
terminal.

1. Start Ollama (the macOS app can provide the same service):

   ```sh
   ollama serve
   ```

2. Start the REST API and background pipeline:

   ```sh
   cd backend
   .venv/bin/uvicorn app.main:app --reload --port 8000
   ```

3. Start the web interface:

   ```sh
   cd frontend
   npm run dev
   ```

Open [http://localhost:5173](http://localhost:5173). The frontend reads
`VITE_API_BASE=http://localhost:8000` from `frontend/.env`.

The scheduler runs immediately when the backend starts and then every 30
minutes. Before onboarding it has no selected categories and does no feed work.
Saving preferences triggers an immediate refresh that ingests only the selected
categories and only stories from the latest 48 hours. Up to three recent
articles are extracted and summarized concurrently with the local 8B model.
Each fetch automatically queues only its four newest new stories. Other
headlines ask whether you want an AI summary: choose **Summarize** on an
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

On macOS, add `--env-file .env` to the manual Uvicorn command from `backend/`;
the POSIX launcher continues to use the process environment. Restart the API
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
