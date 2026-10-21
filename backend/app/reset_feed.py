"""Reset the configured database after scripts/reset-feed.sh stops the app."""

from pathlib import Path
import sys

from dotenv import load_dotenv


def reset_database() -> int | None:
    """Atomically clear articles and preferences, preserving feeds and schema."""
    # Import only after main has loaded the same environment file as Uvicorn.
    from app import db

    if not db.DATABASE_URL and not db.DB_PATH.is_file():
        return None

    with db.get_conn() as conn:
        if not db.DATABASE_URL:
            conn.execute("BEGIN IMMEDIATE")
        deleted = conn.execute("DELETE FROM articles").rowcount
        # Resets can run before startup migrates a legacy database.
        preference = conn.execute("SELECT * FROM preferences WHERE id = 1").fetchone()
        preference_columns = set(dict(preference)) if preference is not None else set()
        extra_resets = ''.join(
            f", {column} = '{{}}'" for column in ('focused_interests', 'summary_style')
            if column in preference_columns
        )
        conn.execute(
            "UPDATE preferences SET onboarded = 0, selected_categories = '[]'" + extra_resets + " WHERE id = 1"
        )
    return deleted


def main() -> int:
    # Explicit environment variables take precedence, just as with --env-file.
    load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)
    try:
        from app import db

        target = "PostgreSQL" if db.DATABASE_URL else "SQLite"
        print(f"Resetting configured {target} database.", flush=True)
        deleted = reset_database()
    except Exception as exc:
        # Driver errors can contain credentials; don't echo their messages.
        print(
            f"Database reset failed ({type(exc).__name__}); app was not restarted. "
            "Check backend/.env and database availability.",
            file=sys.stderr,
        )
        return 1

    if deleted is None:
        print("No local SQLite database found; nothing to reset.")
        return 3
    print(f"Deleted {deleted} article rows and reset onboarding preferences.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
