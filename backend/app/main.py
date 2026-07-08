"""FastAPI application entry point."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import init_db
from app.routes.admin import router as admin_router
from app.routes.articles import router as articles_router
from app.routes.preferences import router as preferences_router
from app.scheduler import create_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize durable state and own the background scheduler lifecycle."""
    init_db()
    scheduler = create_scheduler()
    scheduler.start()
    app.state.scheduler = scheduler
    try:
        yield
    finally:
        scheduler.shutdown()


app = FastAPI(title="News Aggregator API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(admin_router)
app.include_router(articles_router)
app.include_router(preferences_router)
