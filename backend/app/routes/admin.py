"""Administrative API routes, including manual refresh."""

from fastapi import APIRouter, BackgroundTasks

from app.scheduler import run_pipeline


router = APIRouter(prefix="/api", tags=["admin"])


@router.post("/refresh")
def refresh(background_tasks: BackgroundTasks) -> dict[str, str]:
    """Queue a pipeline run after returning the HTTP response."""
    background_tasks.add_task(run_pipeline)
    return {"status": "started"}
