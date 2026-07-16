#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_DIR="$REPO_ROOT/.run"
LOG_DIR="$REPO_ROOT/logs"

BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"
OLLAMA_LOG="$LOG_DIR/ollama.log"

BACKEND_WAIT_ATTEMPTS="${START_BACKEND_WAIT_ATTEMPTS:-60}"
FRONTEND_WAIT_ATTEMPTS="${START_FRONTEND_WAIT_ATTEMPTS:-30}"
OLLAMA_WAIT_ATTEMPTS="${START_OLLAMA_WAIT_ATTEMPTS:-60}"

mkdir -p "$RUN_DIR" "$LOG_DIR"

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

url_is_ready() {
    curl -sf --max-time 1 "$1" >/dev/null
}

url_responds() {
    curl -sS --max-time 1 "$1" >/dev/null 2>&1
}

refuse_untracked_server() {
    local url="$1"
    local label="$2"
    local port="$3"

    if url_responds "$url"; then
        printf '%s port %s is already served by an untracked process; refusing to replace it.\n' \
            "$label" "$port" >&2
        exit 1
    fi
}

wait_for_url() {
    local url="$1"
    local attempts="$2"
    local pidfile="${3:-}"
    local attempt
    local pid
    local ready_checks=0

    for ((attempt = 0; attempt < attempts; attempt++)); do
        if [[ -n "$pidfile" ]]; then
            pid="$(read_pid "$pidfile")"
            if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
                return 1
            fi
        fi

        if url_is_ready "$url"; then
            ready_checks=$((ready_checks + 1))
            if ((ready_checks >= 2)); then
                return 0
            fi
        else
            ready_checks=0
        fi
        sleep 0.5
    done

    return 1
}

show_startup_failure() {
    local label="$1"
    local logfile="$2"

    printf '%s failed to become ready. Last 20 log lines:\n' "$label" >&2
    if [[ -f "$logfile" ]]; then
        tail -n 20 "$logfile" >&2
    else
        printf '(log file was not created)\n' >&2
    fi
    exit 1
}

stop_if_running "$BACKEND_PID_FILE" "backend"
stop_if_running "$FRONTEND_PID_FILE" "frontend"
refuse_untracked_server "http://localhost:8000" "Backend" "8000"
refuse_untracked_server "http://localhost:5173" "Frontend" "5173"

if ! url_is_ready "http://localhost:11434"; then
    printf 'Starting Ollama...\n'
    nohup ollama serve >"$OLLAMA_LOG" 2>&1 &
    if ! wait_for_url "http://localhost:11434" "$OLLAMA_WAIT_ATTEMPTS"; then
        show_startup_failure "Ollama" "$OLLAMA_LOG"
    fi
else
    printf 'Ollama is already running; leaving it untouched.\n'
fi

printf 'Starting backend...\n'
(
    cd "$REPO_ROOT/backend"
    nohup .venv/bin/uvicorn app.main:app --port 8000 >"$BACKEND_LOG" 2>&1 &
    printf '%s\n' "$!" >"$BACKEND_PID_FILE"
)
if ! wait_for_url "http://localhost:8000/api/categories" "$BACKEND_WAIT_ATTEMPTS" "$BACKEND_PID_FILE"; then
    show_startup_failure "Backend" "$BACKEND_LOG"
fi

printf 'Starting frontend...\n'
(
    cd "$REPO_ROOT/frontend"
    nohup node_modules/.bin/vite --port 5173 --strictPort >"$FRONTEND_LOG" 2>&1 &
    printf '%s\n' "$!" >"$FRONTEND_PID_FILE"
)
if ! wait_for_url "http://localhost:5173" "$FRONTEND_WAIT_ATTEMPTS" "$FRONTEND_PID_FILE"; then
    show_startup_failure "Frontend" "$FRONTEND_LOG"
fi

printf '\nBackend PID: %s (logs/backend.log)\n' "$(read_pid "$BACKEND_PID_FILE")"
printf 'Frontend PID: %s (logs/frontend.log)\n' "$(read_pid "$FRONTEND_PID_FILE")"
printf 'Ready: http://localhost:5173\n'
