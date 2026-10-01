"""Application configuration shared by backend modules."""

import os
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = PROJECT_ROOT / "data" / "news.db"
DATABASE_URL = os.environ.get("DATABASE_URL")
MODEL_NAME = "llama3.1:8b"
REFRESH_INTERVAL_MINUTES = 30
RECENCY_WINDOW_HOURS = 48
PIPELINE_CONCURRENCY = 3
SUMMARY_MAX_TOKENS = 512
FRONTEND_ORIGIN = os.environ.get("FRONTEND_ORIGIN", "http://localhost:5173")
