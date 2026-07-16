# Launch Script Plan — `scripts/start.sh`

## Context

The News Aggregator prototype (`docs/plan_mvp.md`) is fully built: a FastAPI backend (`backend/`, run via `uvicorn`), a Vite/React frontend (`frontend/`), and a local Ollama model, currently started as three manual commands in three terminals (per `README.md`). The goal is a single shell script that launches all three and prints the app URL, and — if the script is run again while a previous launch is still up — "bounces" (stops and restarts) the app instead of erroring or double-launching.

Confirmed requirements (via interview):
- **Bounce scope**: kill and restart backend + frontend only. Ollama is treated as a system service the script doesn't own — start it only if not already running, never kill it.
- **Process model**: detach to the background. The script starts backend/frontend as background processes, writes PID files and log files, and returns control of the terminal immediately (no blocking, no Ctrl+C teardown).
- **Browser**: do not auto-open a browser tab; just print the URL once ready.
- **Dependency setup**: assume `backend/.venv` and `frontend/node_modules` already exist (per repo state) — the script launches, it doesn't install.

## Design

### Why PID files (not port-scanning) for bounce detection
Since the script owns backend/frontend, tracking their PIDs in files under a gitignored `.run/` directory is simpler and safer than `lsof -ti:PORT` port-killing, which could kill an unrelated process that happens to occupy 8000/5173. Each run: read the PID file, `kill -0 $pid` to check liveness, `kill $pid` + wait-loop if alive (stale/missing PID file is treated as "not running", no error). This is the bounce mechanism — no separate "is it already running" check needed.

### Why no `--reload` / no `npm run dev` wrapper for backend/frontend
- `uvicorn --reload` runs a supervisor process that spawns a worker subprocess; killing the supervisor's PID via a plain `kill` can orphan the worker. Since this script is a "launch it" tool (not an active-development workflow — the README's manual three-terminal instructions remain the dev-iteration path with `--reload`), the script runs uvicorn **without** `--reload`, so the captured PID is the actual server process.
- Likewise, `npm run dev &` captures the `npm` wrapper's PID, not Vite's — killing it can orphan Vite. The script instead runs `frontend/node_modules/.bin/vite --port 5173 --strictPort` directly, so `$!` is the real dev-server PID.

### Readiness checks
Poll instead of a fixed sleep:
- Ollama: `curl -sf http://localhost:11434` (its API root) — start `ollama serve` in the background only if this fails.
- Backend: `curl -sf http://localhost:8000/api/categories` (a real, already-existing route that only succeeds once `init_db()` in `main.py`'s lifespan has completed) — poll up to ~30s.
- Frontend: `curl -sf http://localhost:5173` — poll up to ~15s.

On timeout for backend/frontend, print the last ~20 lines of that process's log file and exit non-zero (don't leave a half-started, untracked process — but the PID file is written before the wait, so a subsequent bounce will still clean it up).

### File layout
```
scripts/start.sh          # executable launcher
.run/                     # new, gitignored — backend.pid, frontend.pid
logs/                     # new, gitignored — ollama.log, backend.log, frontend.log
```

### `scripts/start.sh` structure
1. `set -euo pipefail`; resolve repo root via `SCRIPT_DIR`/`BASH_SOURCE`; `mkdir -p .run logs`.
2. `stop_if_running(pidfile, label)` helper: if pidfile exists and `kill -0` succeeds, `kill` it and poll `kill -0` in a short loop until it exits (fallback `kill -9` after a timeout), then remove the pidfile; if not running, just remove any stale pidfile. Called for backend and frontend before starting — this is "bounce."
3. Ollama: check readiness URL; if down, `nohup ollama serve > logs/ollama.log 2>&1 &` (not PID-tracked, never killed by this script).
4. Start backend: `cd backend && nohup .venv/bin/uvicorn app.main:app --port 8000 > ../logs/backend.log 2>&1 & echo $! > ../.run/backend.pid`. Poll readiness URL; on failure, tail log and exit 1.
5. Start frontend: `cd frontend && nohup node_modules/.bin/vite --port 5173 --strictPort > ../logs/frontend.log 2>&1 & echo $! > ../.run/frontend.pid`. Poll readiness URL; on failure, tail log and exit 1.
6. Print a summary: PIDs, log file paths, and `Ready: http://localhost:5173`.

### Supporting changes
- `.gitignore`: add `.run/` and `logs/`.
- `README.md`: add a short "Quick start" note pointing at `./scripts/start.sh` as the one-command way to launch, alongside (not replacing) the existing three-terminal manual instructions for active development with `--reload`.
- `CLAUDE.md`: not touched — it documents architecture/commands for the app itself; a launch convenience script doesn't change architecture.

## Verification
1. Fresh run: `./scripts/start.sh` with nothing running → Ollama starts if needed, backend and frontend come up, script prints PIDs + `Ready: http://localhost:5173`, and returns control of the terminal.
2. `curl http://localhost:8000/api/categories` and open `http://localhost:5173` manually — confirm both are actually serving.
3. Run `./scripts/start.sh` again while the first pair is still up → confirm via `ps` that the old backend/frontend PIDs are gone and new ones are running (different PIDs), Ollama's PID is untouched, and the app is reachable throughout (brief gap during the swap is expected).
4. Kill a process out-of-band (`kill -9 $(cat .run/backend.pid)`) then run `./scripts/start.sh` again → confirm it detects the stale PID file gracefully (no error) and starts a fresh backend.
5. Simulate a failure (e.g. temporarily stop Ollama, or otherwise break backend startup) to confirm the script prints the tailed log and exits non-zero instead of hanging or silently succeeding.
