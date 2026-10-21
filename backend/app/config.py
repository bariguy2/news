"""Application configuration shared by backend modules."""

import os
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = PROJECT_ROOT / "data" / "news.db"
DATABASE_URL = os.environ.get("DATABASE_URL")
REFRESH_INTERVAL_MINUTES = 30
RECENCY_WINDOW_HOURS = 48
PIPELINE_CONCURRENCY = max(1, min(8, int(os.environ.get("PIPELINE_CONCURRENCY", "3"))))
AUTO_SUMMARY_LIMIT = max(0, int(os.environ.get("AUTO_SUMMARY_LIMIT", "0")))
FRONTEND_ORIGIN = os.environ.get("FRONTEND_ORIGIN", "http://localhost:5173")
