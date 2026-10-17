"""Ephemeral per-article estimates; stored summary status is authoritative."""

from threading import Lock
from time import monotonic

_lock = Lock()
_articles: dict[int, dict] = {}


def start_batch(article_ids: list[int]) -> None:
    if article_ids:
        with _lock:
            _articles.clear()
            _articles.update({article_id: {'stage': 'queued', 'percentage': 0, 'started': None}
                              for article_id in article_ids})


def update_article(article_id: int, stage: str, percentage: int) -> None:
    with _lock:
        entry = _articles.get(article_id)
        if entry is None:
            return
        if entry['started'] is None:
            entry['started'] = monotonic()
        entry['stage'] = stage
        entry['percentage'] = max(entry['percentage'], min(99, max(0, percentage)))


def finish_article(article_id: int, success: bool) -> None:
    with _lock:
        if article_id in _articles:
            entry = _articles[article_id]
            entry['stage'] = 'done' if success else 'failed'
            if success:
                entry['percentage'] = 100
            entry['finished'] = monotonic()


def interrupt_batch() -> None:
    with _lock:
        for entry in _articles.values():
            if entry['stage'] not in ('done', 'failed'):
                entry['stage'] = 'interrupted'
                entry['finished'] = monotonic()


def get_article_progress(article_id: int, summary_status: str) -> dict[str, object]:
    with _lock:
        entry = dict(_articles.get(article_id, {}))
    stage = entry.get('stage', 'queued')
    percentage = entry.get('percentage', 0)
    if summary_status == 'done':
        stage, percentage = 'done', 100
    elif summary_status == 'failed':
        stage, percentage = 'failed', min(99, percentage)
    elif summary_status == 'unrequested':
        stage, percentage = 'unrequested', 0
    elif stage in ('done', 'failed'):
        entry = {}
        stage, percentage = 'queued', 0
    started = entry.get('started')
    elapsed = max(0, int(entry.get('finished', monotonic()) - started)) if started is not None else 0
    return {'stage': stage, 'percentage': percentage,
            'elapsed_seconds': elapsed, 'estimated': summary_status == 'pending'}
