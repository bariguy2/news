"""Single-user preference API routes."""

import json
from collections.abc import Mapping

from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel

from app.db import get_conn
from app.scheduler import run_pipeline


router = APIRouter(prefix="/api/preferences", tags=["preferences"])


class PreferencesUpdate(BaseModel):
    selected_categories: list[str]


class PreferencesResponse(PreferencesUpdate):
    onboarded: bool


def _preferences_response(row: Mapping[str, object]) -> dict[str, object]:
    return {
        "onboarded": bool(row["onboarded"]),
        "selected_categories": json.loads(row["selected_categories"]),
    }


@router.get("", response_model=PreferencesResponse)
def get_preferences() -> dict[str, object]:
    """Return the single local user's persisted onboarding preferences."""
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT selected_categories, onboarded
            FROM preferences
            WHERE id = 1
            """
        ).fetchone()

    if row is None:
        return {"onboarded": False, "selected_categories": []}
    return _preferences_response(row)


@router.post("", response_model=PreferencesResponse)
def update_preferences(
    preferences: PreferencesUpdate,
    background_tasks: BackgroundTasks,
) -> dict[str, object]:
    """Persist selected categories and mark onboarding complete."""
    selected_categories = json.dumps(preferences.selected_categories)
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO preferences (id, selected_categories, onboarded)
            VALUES (1, ?, 1)
            ON CONFLICT(id) DO UPDATE SET
                selected_categories = excluded.selected_categories,
                onboarded = 1
            """,
            (selected_categories,),
        )
        row = conn.execute(
            """
            SELECT selected_categories, onboarded
            FROM preferences
            WHERE id = 1
            """
        ).fetchone()

    background_tasks.add_task(run_pipeline)
    return _preferences_response(row)
