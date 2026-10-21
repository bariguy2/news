"""Operator-only regeneration and usage reports; never expose through HTTP."""

import argparse
import json
from pathlib import Path

from dotenv import load_dotenv


def queue_regeneration(article_id):
    from app.db import get_conn
    from app.summarize.versions import preserve_legacy
    with get_conn() as conn:
        preserve_legacy(conn)
        row = conn.execute("""UPDATE articles SET summary_status = 'pending'
            WHERE id = ? AND summary_status IN ('done', 'failed', 'unrequested') RETURNING id""",
            (article_id,)).fetchone()
        if row:
            return 'queued'
        existing = conn.execute('SELECT id FROM articles WHERE id = ?', (article_id,)).fetchone()
        return 'already_pending' if existing else 'not_found'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    regen = sub.add_parser('regenerate')
    regen.add_argument('article_id', type=int)
    sub.add_parser('usage')
    args = parser.parse_args()
    load_dotenv(Path(__file__).resolve().parents[2] / '.env', override=False)
    try:
        from app.db import init_db
        init_db()
        if args.command == 'regenerate':
            status = queue_regeneration(args.article_id)
            print(status + ': pending work runs on the next scheduler refresh (or Refresh feed).')
            return 1 if status == 'not_found' else 0
        from app.summarize.usage import report
        print(json.dumps(report(), indent=2))
        return 0
    except Exception as exc:
        print(f'Operator command failed ({type(exc).__name__}); check backend configuration.')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
