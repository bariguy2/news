#!/usr/bin/env bash

set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/news-reset-test.XXXXXX")"
FAKE_BIN="$TEST_ROOT/fake-bin"
REFRESH_COUNT_FILE="$TEST_ROOT/refresh-count"
OLLAMA_PID_FILE="$TEST_ROOT/ollama.pid"

cleanup_failed=0

stop_pid() {
    local pid="$1"
    local attempt

    if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
        return
    fi

    kill "$pid" 2>/dev/null || true
    for ((attempt = 0; attempt < 30; attempt++)); do
        if ! kill -0 "$pid" 2>/dev/null; then
            return
        fi
        sleep 0.1
    done
    kill -9 "$pid" 2>/dev/null || true
    for ((attempt = 0; attempt < 20; attempt++)); do
        if ! kill -0 "$pid" 2>/dev/null; then
            return
        fi
        sleep 0.1
    done

    printf 'FAIL: cleanup could not stop PID %s\n' "$pid" >&2
    cleanup_failed=1
}

cleanup() {
    local pidfile
    local pid

    for pidfile in \
        "$TEST_ROOT/.run/backend.pid" \
        "$TEST_ROOT/.run/frontend.pid" \
        "$OLLAMA_PID_FILE"; do
        if [[ -f "$pidfile" ]]; then
            pid="$(sed -n '1p' "$pidfile" 2>/dev/null || true)"
            if [[ "$pid" =~ ^[0-9]+$ ]]; then
                stop_pid "$pid"
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

start_fake_process() {
    nohup sleep 300 >/dev/null 2>&1 &
    printf '%s' "$!"
}

mkdir -p "$TEST_ROOT/scripts" "$TEST_ROOT/data" "$TEST_ROOT/.run" "$FAKE_BIN"
cp "$SOURCE_ROOT/scripts/reset-feed.sh" "$TEST_ROOT/scripts/reset-feed.sh"
chmod +x "$TEST_ROOT/scripts/reset-feed.sh"

cat >"$TEST_ROOT/scripts/start.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$repo_root/.run"
nohup sleep 300 >/dev/null 2>&1 &
printf '%s\n' "$!" >"$repo_root/.run/backend.pid"
nohup sleep 300 >/dev/null 2>&1 &
printf '%s\n' "$!" >"$repo_root/.run/frontend.pid"
printf 'Ready: http://localhost:5173\n'
EOF

cat >"$FAKE_BIN/curl" <<'EOF'
#!/usr/bin/env bash
url="${*: -1}"
if [[ "$url" == "http://localhost:8000/api/refresh" ]]; then
    count=0
    if [[ -f "$FAKE_REFRESH_COUNT_FILE" ]]; then
        count="$(sed -n '1p' "$FAKE_REFRESH_COUNT_FILE")"
    fi
    printf '%s\n' "$((count + 1))" >"$FAKE_REFRESH_COUNT_FILE"
    printf '{"status":"started"}'
    exit 0
fi
if [[ "$url" == "http://localhost:8000" && "${FAKE_UNTRACKED_BACKEND:-0}" == "1" ]]; then
    exit 0
fi
case "$url" in
    http://localhost:8000)
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

chmod +x "$TEST_ROOT/scripts/start.sh" "$FAKE_BIN/curl"

sqlite3 "$TEST_ROOT/data/news.db" <<'SQL'
CREATE TABLE articles (id INTEGER PRIMARY KEY, title TEXT NOT NULL);
CREATE TABLE preferences (
    id INTEGER PRIMARY KEY,
    selected_categories TEXT NOT NULL,
    onboarded INTEGER NOT NULL
);
INSERT INTO articles (title) VALUES ('one'), ('two');
INSERT INTO preferences VALUES (1, '["Tech"]', 1);
SQL

export PATH="$FAKE_BIN:$PATH"
export FAKE_REPO_ROOT="$TEST_ROOT"
export FAKE_REFRESH_COUNT_FILE="$REFRESH_COUNT_FILE"

ollama_pid="$(start_fake_process)"
printf '%s\n' "$ollama_pid" >"$OLLAMA_PID_FILE"
old_backend_pid="$(start_fake_process)"
old_frontend_pid="$(start_fake_process)"
printf '%s\n' "$old_backend_pid" >"$TEST_ROOT/.run/backend.pid"
printf '%s\n' "$old_frontend_pid" >"$TEST_ROOT/.run/frontend.pid"

first_output="$($TEST_ROOT/scripts/reset-feed.sh)"
[[ "$first_output" == *"Deleted 2 article rows"* ]] || fail "first reset did not report two deleted rows"
[[ "$first_output" == *"pipeline refresh triggered"* ]] || fail "first reset did not report refresh"
assert_stopped "$old_backend_pid"
assert_stopped "$old_frontend_pid"
assert_running "$ollama_pid"
first_backend_pid="$(sed -n '1p' "$TEST_ROOT/.run/backend.pid")"
first_frontend_pid="$(sed -n '1p' "$TEST_ROOT/.run/frontend.pid")"
assert_running "$first_backend_pid"
assert_running "$first_frontend_pid"
[[ "$(sqlite3 "$TEST_ROOT/data/news.db" 'SELECT COUNT(*) FROM articles')" == "0" ]] || fail "articles were not deleted"
[[ "$(sqlite3 "$TEST_ROOT/data/news.db" "SELECT onboarded || '|' || selected_categories FROM preferences WHERE id = 1")" == "0|[]" ]] || fail "preferences were not reset"
[[ "$(sed -n '1p' "$REFRESH_COUNT_FILE")" == "1" ]] || fail "refresh was not requested once"

second_output="$($TEST_ROOT/scripts/reset-feed.sh)"
[[ "$second_output" == *"Deleted 0 article rows"* ]] || fail "empty reset was not idempotent"
second_backend_pid="$(sed -n '1p' "$TEST_ROOT/.run/backend.pid")"
second_frontend_pid="$(sed -n '1p' "$TEST_ROOT/.run/frontend.pid")"
[[ "$second_backend_pid" != "$first_backend_pid" ]] || fail "backend PID did not change on second reset"
[[ "$second_frontend_pid" != "$first_frontend_pid" ]] || fail "frontend PID did not change on second reset"
assert_stopped "$first_backend_pid"
assert_stopped "$first_frontend_pid"
assert_running "$second_backend_pid"
assert_running "$second_frontend_pid"
assert_running "$ollama_pid"
[[ "$(sed -n '1p' "$REFRESH_COUNT_FILE")" == "2" ]] || fail "refresh was not requested twice"

stop_pid "$second_backend_pid"
stop_pid "$second_frontend_pid"
rm -f "$TEST_ROOT/.run/backend.pid" "$TEST_ROOT/.run/frontend.pid"
sqlite3 "$TEST_ROOT/data/news.db" "INSERT INTO articles (title) VALUES ('cold'); UPDATE preferences SET selected_categories='[\"World\"]', onboarded=1 WHERE id=1;"
cold_output="$($TEST_ROOT/scripts/reset-feed.sh)"
[[ "$cold_output" == *"Deleted 1 article rows"* ]] || fail "cold reset did not delete the article"
cold_backend_pid="$(sed -n '1p' "$TEST_ROOT/.run/backend.pid")"
cold_frontend_pid="$(sed -n '1p' "$TEST_ROOT/.run/frontend.pid")"
assert_running "$cold_backend_pid"
assert_running "$cold_frontend_pid"
assert_running "$ollama_pid"
[[ "$(sed -n '1p' "$REFRESH_COUNT_FILE")" == "3" ]] || fail "cold reset did not request refresh"

stop_pid "$cold_backend_pid"
stop_pid "$cold_frontend_pid"
rm -f "$TEST_ROOT/.run/backend.pid" "$TEST_ROOT/.run/frontend.pid"
export FAKE_UNTRACKED_BACKEND=1
sqlite3 "$TEST_ROOT/data/news.db" "INSERT INTO articles (title) VALUES ('preserve');"
if conflict_output="$($TEST_ROOT/scripts/reset-feed.sh 2>&1)"; then
    fail "untracked backend conflict returned success"
fi
[[ "$conflict_output" == *"refusing to reset the database"* ]] || fail "untracked backend conflict was not reported"
[[ "$(sqlite3 "$TEST_ROOT/data/news.db" 'SELECT COUNT(*) FROM articles')" == "1" ]] || fail "conflict guard changed the database"
unset FAKE_UNTRACKED_BACKEND

rm "$TEST_ROOT/data/news.db"
missing_output="$($TEST_ROOT/scripts/reset-feed.sh)"
[[ "$missing_output" == *"nothing to reset"* ]] || fail "missing database guard was not reported"
[[ ! -f "$TEST_ROOT/.run/backend.pid" ]] || fail "missing database guard launched backend"
[[ ! -f "$TEST_ROOT/.run/frontend.pid" ]] || fail "missing database guard launched frontend"
assert_running "$ollama_pid"

cleanup
trap - EXIT
printf 'reset-feed.sh integration checks passed\n'
