"""Atomic budget reservation before each call, including retries and evaluation.

Uncertain or interrupted calls retain their full reservation. Never release an
unsettled reservation automatically: the provider may have already charged it.
Amounts track list-price estimates even for free-tier calls, not invoices.
"""

from datetime import UTC, datetime
from uuid import uuid4

from app.db import get_conn
from app.summarize.settings import allowance


class BudgetExceeded(Exception):
    pass


def reserve(config, prompt, scope, prompt_version, input_hash):
    now = datetime.now(UTC)
    period = now.strftime('%Y-%m')
    # UTF-8 bytes conservatively bound text tokens, with message wrapper margin.
    amount = (len(prompt.encode('utf-8')) + 256) * config.input_rate + config.max_output * config.output_rate
    limit = allowance(scope)
    attempt_id = str(uuid4())
    with get_conn() as conn:
        conn.execute("""INSERT INTO ai_budgets (period, scope, used_nano) VALUES (?, ?, 0)
            ON CONFLICT(period, scope) DO NOTHING""", (period, scope))
        claimed = conn.execute("""UPDATE ai_budgets SET used_nano = used_nano + ?
            WHERE period = ? AND scope = ? AND used_nano + ? <= ? RETURNING used_nano""",
            (amount, period, scope, amount, limit)).fetchone()
        if claimed is None or (config.provider != 'ollama' and limit == 0):
            raise BudgetExceeded('Monthly usage allowance reached')
        conn.execute("""INSERT INTO ai_attempts
            (id, period, scope, provider, model, prompt_version, input_hash, status,
             reserved_nano, charged_nano, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?)""",
            (attempt_id, period, scope, config.provider, config.model, prompt_version,
             input_hash, amount, amount, now.isoformat()))
    return attempt_id


def settle(attempt_id, config, *, status, elapsed_ms, completion=None, rejected=False):
    known = completion is not None and completion.input_tokens is not None and completion.output_tokens is not None
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM ai_attempts WHERE id = ?", (attempt_id,)).fetchone()
        if row is None or row['status'] != 'reserved':
            return
        amount = row['reserved_nano']
        if rejected:
            amount = 0  # Explicit HTTP rejection before generation (400/401/403/404/429).
        elif known:
            amount = completion.input_tokens * config.input_rate + completion.output_tokens * config.output_rate
        updated = conn.execute("""UPDATE ai_attempts SET status = ?, charged_nano = ?, input_tokens = ?,
            output_tokens = ?, reasoning_tokens = ?, estimated = ?, elapsed_ms = ?
            WHERE id = ? AND status = 'reserved' RETURNING id""",
            (status, amount, completion.input_tokens if known else None,
             completion.output_tokens if known else None,
             completion.reasoning_tokens if completion else None,
             int(not known and not rejected), elapsed_ms, attempt_id)).fetchone()
        if updated:
            conn.execute("UPDATE ai_budgets SET used_nano = used_nano + ? WHERE period = ? AND scope = ?",
                         (amount - row['reserved_nano'], row['period'], row['scope']))


def report(scope=None):
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM ai_budgets ORDER BY period, scope").fetchall()
    return [dict(row) for row in rows if scope is None or row['scope'] == scope]
