#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_DIR="$REPO_ROOT/.run"

stop_if_running() {
    local pidfile="$1"
    local label="$2"
    local pid=""
    local attempt

    [[ -f "$pidfile" ]] || return 0
    pid="$(sed -n '1p' "$pidfile" 2>/dev/null || true)"

    # Only positive process IDs greater than 1; never signal a process group.
    if [[ ! "$pid" =~ ^[1-9][0-9]*$ || "$pid" == "1" ]]; then
        rm -f "$pidfile"
        return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
        rm -f "$pidfile"
        return 0
    fi

    printf 'Stopping %s (PID %s)...\n' "$label" "$pid"
    kill "$pid" 2>/dev/null || true
    for ((attempt = 0; attempt < 50; attempt++)); do
        if ! kill -0 "$pid" 2>/dev/null; then
            rm -f "$pidfile"
            return 0
        fi
        sleep 0.1
    done

    printf '%s did not stop cleanly; sending SIGKILL.\n' "$label" >&2
    kill -9 "$pid" 2>/dev/null || true
    for ((attempt = 0; attempt < 20; attempt++)); do
        if ! kill -0 "$pid" 2>/dev/null; then
            rm -f "$pidfile"
            return 0
        fi
        sleep 0.1
    done

    printf 'Unable to stop %s (PID %s).\n' "$label" "$pid" >&2
    return 1
}

# Stop both tracked services even if one cannot be stopped. Ollama is shared.
stop_status=0
stop_if_running "$RUN_DIR/backend.pid" "backend" || stop_status=1
stop_if_running "$RUN_DIR/frontend.pid" "frontend" || stop_status=1
exit "$stop_status"
