#!/usr/bin/env bash

set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/news-start-test.XXXXXX")"
FAKE_BIN="$TEST_ROOT/fake-bin"
OLLAMA_PID_FILE="$TEST_ROOT/ollama.pid"

cleanup() {
    local pidfile
    local pid
    local attempt
    local cleanup_failed=0

    for pidfile in \
        "$TEST_ROOT/.run/backend.pid" \
        "$TEST_ROOT/.run/frontend.pid" \
        "$OLLAMA_PID_FILE"; do
        if [[ -f "$pidfile" ]]; then
            pid="$(sed -n '1p' "$pidfile" 2>/dev/null || true)"
            if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
                kill "$pid" 2>/dev/null || true
                for ((attempt = 0; attempt < 30; attempt++)); do
                    if ! kill -0 "$pid" 2>/dev/null; then
                        break
                    fi
                    sleep 0.1
                done
                if kill -0 "$pid" 2>/dev/null; then
                    kill -9 "$pid" 2>/dev/null || true
                    for ((attempt = 0; attempt < 20; attempt++)); do
                        if ! kill -0 "$pid" 2>/dev/null; then
                            break
                        fi
                        sleep 0.1
                    done
                fi
                if kill -0 "$pid" 2>/dev/null; then
                    printf 'FAIL: cleanup could not stop PID %s\n' "$pid" >&2
                    cleanup_failed=1
                fi
            fi
        fi
    done
    rm -rf "$TEST_ROOT"
    return "$cleanup_failed"
}
trap cleanup EXIT

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

assert_running() {
    kill -0 "$1" 2>/dev/null || fail "expected PID $1 to be running"
}

assert_stopped() {
    local pid="$1"
    local attempt

    for ((attempt = 0; attempt < 30; attempt++)); do
        if ! kill -0 "$pid" 2>/dev/null; then
            return
        fi
        sleep 0.1
    done
    fail "expected PID $pid to be stopped"
}

mkdir -p \
    "$TEST_ROOT/backend/.venv/bin" \
    "$TEST_ROOT/frontend/node_modules/.bin" \
    "$TEST_ROOT/scripts" \
    "$FAKE_BIN"
cp "$SOURCE_ROOT/scripts/start.sh" "$TEST_ROOT/scripts/start.sh"
chmod +x "$TEST_ROOT/scripts/start.sh"

cat >"$FAKE_BIN/curl" <<'EOF'
#!/usr/bin/env bash
url="${*: -1}"
case "$url" in
    http://localhost:11434)
        pidfile="$FAKE_OLLAMA_PID_FILE"
        ;;
    http://localhost:8000/api/categories)
        if [[ "${FAKE_UNTRACKED_BACKEND:-0}" == "1" ]]; then
            exit 0
        fi
        pidfile="$FAKE_REPO_ROOT/.run/backend.pid"
        ;;
    http://localhost:8000)
        if [[ "${FAKE_UNTRACKED_BACKEND:-0}" == "1" ]]; then
            exit 0
        fi
        pidfile="$FAKE_REPO_ROOT/.run/backend.pid"
        ;;
    http://localhost:5173)
        pidfile="$FAKE_REPO_ROOT/.run/frontend.pid"
        ;;
    *)
        exit 1
        ;;
esac
[[ -f "$pidfile" ]] || exit 1
pid="$(sed -n '1p' "$pidfile")"
kill -0 "$pid" 2>/dev/null
EOF

cat >"$FAKE_BIN/ollama" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$$" >"$FAKE_OLLAMA_PID_FILE"
exec sleep 300
EOF

cat >"$TEST_ROOT/backend/.venv/bin/uvicorn" <<'EOF'
#!/usr/bin/env bash
if [[ "${FAKE_BACKEND_FAIL:-0}" == "1" ]]; then
    printf 'simulated backend failure\n' >&2
    exit 1
fi
exec sleep 300
EOF

cat >"$TEST_ROOT/frontend/node_modules/.bin/vite" <<'EOF'
#!/usr/bin/env bash
exec sleep 300
EOF

chmod +x \
    "$FAKE_BIN/curl" \
    "$FAKE_BIN/ollama" \
    "$TEST_ROOT/backend/.venv/bin/uvicorn" \
    "$TEST_ROOT/frontend/node_modules/.bin/vite"

export PATH="$FAKE_BIN:$PATH"
export FAKE_REPO_ROOT="$TEST_ROOT"
export FAKE_OLLAMA_PID_FILE="$OLLAMA_PID_FILE"
export START_BACKEND_WAIT_ATTEMPTS=4
export START_FRONTEND_WAIT_ATTEMPTS=4
export START_OLLAMA_WAIT_ATTEMPTS=4

first_output="$($TEST_ROOT/scripts/start.sh)"
[[ "$first_output" == *"Ready: http://localhost:5173"* ]] || fail "fresh launch did not report readiness"
first_backend_pid="$(sed -n '1p' "$TEST_ROOT/.run/backend.pid")"
first_frontend_pid="$(sed -n '1p' "$TEST_ROOT/.run/frontend.pid")"
ollama_pid="$(sed -n '1p' "$OLLAMA_PID_FILE")"
assert_running "$first_backend_pid"
assert_running "$first_frontend_pid"
assert_running "$ollama_pid"

second_output="$($TEST_ROOT/scripts/start.sh)"
[[ "$second_output" == *"Ollama is already running; leaving it untouched."* ]] || fail "bounce did not preserve Ollama"
second_backend_pid="$(sed -n '1p' "$TEST_ROOT/.run/backend.pid")"
second_frontend_pid="$(sed -n '1p' "$TEST_ROOT/.run/frontend.pid")"
[[ "$second_backend_pid" != "$first_backend_pid" ]] || fail "backend PID did not change on bounce"
[[ "$second_frontend_pid" != "$first_frontend_pid" ]] || fail "frontend PID did not change on bounce"
assert_stopped "$first_backend_pid"
assert_stopped "$first_frontend_pid"
assert_running "$second_backend_pid"
assert_running "$second_frontend_pid"
assert_running "$ollama_pid"

kill -9 "$second_backend_pid"
assert_stopped "$second_backend_pid"
stale_output="$($TEST_ROOT/scripts/start.sh)"
[[ "$stale_output" == *"Ready: http://localhost:5173"* ]] || fail "stale PID recovery did not report readiness"
third_backend_pid="$(sed -n '1p' "$TEST_ROOT/.run/backend.pid")"
assert_running "$third_backend_pid"

kill -9 "$third_backend_pid"
assert_stopped "$third_backend_pid"
export FAKE_BACKEND_FAIL=1
if failure_output="$($TEST_ROOT/scripts/start.sh 2>&1)"; then
    fail "simulated backend failure returned success"
fi
[[ "$failure_output" == *"Backend failed to become ready"* ]] || fail "failure did not identify backend readiness"
[[ "$failure_output" == *"simulated backend failure"* ]] || fail "failure did not include backend log tail"

unset FAKE_BACKEND_FAIL
export FAKE_UNTRACKED_BACKEND=1
if conflict_output="$($TEST_ROOT/scripts/start.sh 2>&1)"; then
    fail "untracked backend conflict returned success"
fi
[[ "$conflict_output" == *"Backend port 8000 is already served by an untracked process"* ]] || \
    fail "untracked backend conflict was not reported"
assert_running "$ollama_pid"

cleanup
trap - EXIT
printf 'start.sh integration checks passed\n'
