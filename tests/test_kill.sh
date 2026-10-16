#!/usr/bin/env bash

set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/news-kill-test.XXXXXX")"
pids=()

cleanup() {
    local pid
    for pid in "${pids[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" 2>/dev/null || true
        fi
        wait "$pid" 2>/dev/null || true
        if kill -0 "$pid" 2>/dev/null; then
            printf 'FAIL: cleanup could not stop PID %s\n' "$pid" >&2
            return 1
        fi
    done
    rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

assert_stopped() {
    wait "$1" 2>/dev/null || true
    if kill -0 "$1" 2>/dev/null; then
        fail "PID $1 is still running"
    fi
}

mkdir -p "$TEST_ROOT/scripts"
cp "$SOURCE_ROOT/scripts/kill.sh" "$TEST_ROOT/scripts/kill.sh"
chmod +x "$TEST_ROOT/scripts/kill.sh"

# It works from another directory, without even creating runtime files.
output="$(cd / && "$TEST_ROOT/scripts/kill.sh")"
[[ -z "$output" && ! -e "$TEST_ROOT/.run" ]] || fail "stopped app was not a quiet no-op"
mkdir "$TEST_ROOT/.run"

sleep 300 &
untracked_pid=$!
pids+=("$untracked_pid")
sleep 300 &
ollama_pid=$!
pids+=("$ollama_pid")
printf '%s\n' "$ollama_pid" >"$TEST_ROOT/.run/ollama.pid"

sleep 300 &
backend_pid=$!
pids+=("$backend_pid")
sleep 300 &
frontend_pid=$!
pids+=("$frontend_pid")
printf '%s\n' "$backend_pid" >"$TEST_ROOT/.run/backend.pid"
printf '%s\n' "$frontend_pid" >"$TEST_ROOT/.run/frontend.pid"
"$TEST_ROOT/scripts/kill.sh"
assert_stopped "$backend_pid"
assert_stopped "$frontend_pid"
[[ ! -e "$TEST_ROOT/.run/backend.pid" && ! -e "$TEST_ROOT/.run/frontend.pid" ]] || fail "stopped PID files remain"
kill -0 "$untracked_pid" || fail "untracked process was stopped"
kill -0 "$ollama_pid" || fail "Ollama was stopped"

output="$("$TEST_ROOT/scripts/kill.sh")"
[[ -z "$output" ]] || fail "repeated stop was not a quiet no-op"

# Stale or malformed PID files cannot become process-group kill targets.
for invalid in "$backend_pid" '' 0 1 -1 0000 not-a-pid; do
    printf '%s\n' "$invalid" >"$TEST_ROOT/.run/backend.pid"
    output="$("$TEST_ROOT/scripts/kill.sh")"
    [[ -z "$output" && ! -e "$TEST_ROOT/.run/backend.pid" ]] || fail "stale/invalid PID was not cleared quietly"
done

# A single running service is still stopped if the other PID file is absent.
sleep 300 &
frontend_pid=$!
pids+=("$frontend_pid")
printf '%s\n' "$frontend_pid" >"$TEST_ROOT/.run/frontend.pid"
"$TEST_ROOT/scripts/kill.sh"
assert_stopped "$frontend_pid"

# Exercise the five-second SIGTERM timeout with no child process to orphan.
/bin/bash -c 'trap "" TERM; printf ready >"$1"; exec sleep 300' bash "$TEST_ROOT/ready" &
backend_pid=$!
pids+=("$backend_pid")
for ((attempt = 0; attempt < 50; attempt++)); do
    [[ -f "$TEST_ROOT/ready" ]] && break
    sleep 0.1
done
[[ -f "$TEST_ROOT/ready" ]] || fail "stubborn service did not start"
printf '%s\n' "$backend_pid" >"$TEST_ROOT/.run/backend.pid"
"$TEST_ROOT/scripts/kill.sh" >"$TEST_ROOT/stop-output" 2>&1
assert_stopped "$backend_pid"
[[ "$(cat "$TEST_ROOT/stop-output")" == *"sending SIGKILL"* ]] || fail "forced-stop fallback was not exercised"
kill -0 "$untracked_pid" || fail "untracked process was stopped"
kill -0 "$ollama_pid" || fail "Ollama was stopped"

cleanup
trap - EXIT
printf 'kill.sh integration checks passed\n'
