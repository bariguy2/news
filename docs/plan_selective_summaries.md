# Selective AI summaries

The user requested a small automatic batch and a per-article choice for the
remaining headlines. This extends MVP steps 6, 7 and 9 without changing the
local model, storage provider or summary format.

## Behavior and acceptance criteria

- RSS ingestion explicitly stores new headlines as `unrequested` in either
  SQLite or PostgreSQL. After all selected feeds are fetched, the pipeline
  queues at most four **newly inserted** articles, newest publication time
  first (observed time for undated stories; ID breaks ties).
- The remaining articles stay `unrequested` across polling, refreshes and
  restarts. A subsequent fetch may automatically queue up to four new stories;
  it must never promote old untouched stories.
- Existing `pending` rows represent work already queued and continue to resume
  after restart. Existing completed summaries are reused. The schema default
  stays `pending` for compatibility; the RSS writer explicitly sets the new
  state, so existing databases require no schema migration.
- Headline responses include `unrequested`, `pending`, `done` and `failed`
  states, without summaries, excerpts or extracted text. Detail stays done-only.
- `POST /api/articles/{id}/summarize` atomically changes `unrequested` or
  `failed` to `pending` and dispatches the existing coordinator. Duplicate
  requests for `pending` or `done` are safe and do not queue another call.
  Unknown IDs return 404. The response contains only `summary_status`.
- User-requested processing does not fetch RSS or purge articles again. It
  drains queued work even if preferences changed. Full refreshes retain their
  category scope and rolling 48-hour purge. Requests that overlap a run queue
  a rerun; a queued full refresh must retain its fetch work.
- Untouched cards ask whether the reader wants an AI summary and show a
  `Summarize` button. Queued cards show `Summary in progress`; completed cards
  link to their detail. Failed summaries remain visible with `Retry summary`.
  Requests disable the button while submitting and show an inline error on
  transport failure. Every incomplete card keeps its original-source link.
- Empty/pending feeds poll every five seconds. A populated feed with only
  completed, failed or untouched stories polls every fifteen seconds. An
  accepted request immediately reloads state and starts pending polling.

## Verification

Run backend unit/API/pipeline tests, frontend component tests, the production
build, and the isolated Chrome flow. Verify four automatic summaries from more
than four input articles, an untouched backlog after repeated refresh, persisted
requests, duplicate requests, failure retry, and overlapping refresh/request
triggers. Exercise the real local model against a temporary database and inspect
both saved sections. Inspect the feed screenshot and verify all test processes
and ports are cleaned up. Record verified results in `AGENTS.md`.
