"""Application configuration shared by backend modules."""

from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = PROJECT_ROOT / "data" / "news.db"
MODEL_NAME = "llama3.1:8b"
REFRESH_INTERVAL_MINUTES = 30
