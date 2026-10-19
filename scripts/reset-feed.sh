#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_DIR="$REPO_ROOT/.run"

BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"

read_pid() {
    local pidfile="$1"
    local pid=""

    if [[ -f "$pidfile" ]]; then
        pid="$(sed -n '1p' "$pidfile" 2>/dev/null || true)"
    fi

    if [[ "$pid" =~ ^[0-9]+$ ]]; then
        printf '%s' "$pid"
    fi
}

stop_if_running() {
    local pidfile="$1"
    local label="$2"
    local pid
    local attempt

    pid="$(read_pid "$pidfile")"
    if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
        rm -f "$pidfile"
        return
    fi

    printf 'Stopping %s (PID %s)...\n' "$label" "$pid"
    kill "$pid" 2>/dev/null || true

    for ((attempt = 0; attempt < 50; attempt++)); do
        if ! kill -0 "$pid" 2>/dev/null; then
            rm -f "$pidfile"
            return
        fi
        sleep 0.1
    done

    printf '%s did not stop cleanly; sending SIGKILL.\n' "$label" >&2
    kill -9 "$pid" 2>/dev/null || true
    for ((attempt = 0; attempt < 20; attempt++)); do
        if ! kill -0 "$pid" 2>/dev/null; then
            rm -f "$pidfile"
            return
        fi
        sleep 0.1
    done

    printf 'Unable to stop %s (PID %s).\n' "$label" "$pid" >&2
    exit 1
}

url_responds() {
    curl -sS --max-time 1 "$1" >/dev/null 2>&1
}

refuse_untracked_server() {
    local url="$1"
    local label="$2"
    local port="$3"

    if url_responds "$url"; then
        printf '%s port %s is already served by an untracked process; refusing to reset the database.\n' \
            "$label" "$port" >&2
        exit 1
    fi
}

stop_if_running "$BACKEND_PID_FILE" "backend"
stop_if_running "$FRONTEND_PID_FILE" "frontend"
refuse_untracked_server "http://localhost:8000" "Backend" "8000"
refuse_untracked_server "http://localhost:5173" "Frontend" "5173"

# Use the backend's connection helper and the same dotenv precedence as Uvicorn.
if (cd "$REPO_ROOT/backend" && .venv/bin/python -m app.reset_feed); then
    :
else
    reset_status=$?
    if [[ "$reset_status" == "3" ]]; then
        exit 0  # Missing local SQLite database: preserve the existing no-op.
    fi
    exit "$reset_status"
fi

"$SCRIPT_DIR/start.sh"

refresh_response="$(curl -sf --max-time 5 -X POST http://localhost:8000/api/refresh)"
if [[ "$refresh_response" != *'"status":"started"'* ]]; then
    printf 'Refresh request returned an unexpected response: %s\n' "$refresh_response" >&2
    exit 1
fi

printf 'Feed reset. Open http://localhost:5173 and choose categories to fetch new articles.\n'
printf 'Pipeline refresh triggered; it does no feed work until onboarding is complete.\n'
