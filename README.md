# Local News Aggregator

A single-user news briefing that runs on your Mac. It collects a curated set of
RSS feeds, extracts article text, creates local FACTS and IMPACT summaries with
Ollama, and serves a category-filtered React interface.

## Prerequisites

- macOS with Homebrew
- Python 3.12 managed by `uv`
- Node.js and npm
- Ollama with `llama3.1:8b`

Install the local tools and model:

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
minutes. The initial batch can take several minutes or longer because every
article is extracted and summarized locally with an 8B model. A manual refresh
can be queued with:

```sh
curl -X POST http://localhost:8000/api/refresh
```

Runtime data stays in `data/news.db` and is not committed.

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
before running the browser test.
