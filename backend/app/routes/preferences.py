"""Single-user preference API routes."""

import json
from collections.abc import Mapping
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator

from app.db import get_conn
from app.scheduler import run_pipeline
from app.summarize.style import SummaryStyle


router = APIRouter(prefix="/api/preferences", tags=["preferences"])


InterestName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
InterestNames = Annotated[list[InterestName], Field(max_length=20)]


class FocusedInterest(BaseModel):
    topics: list[InterestName] = Field(default_factory=list, max_length=20)
    teams: dict[InterestName, InterestNames] = Field(default_factory=dict, max_length=20)

    @field_validator("topics")
    @classmethod
    def unique_topics(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(value))

    @field_validator("teams")
    @classmethod
    def unique_teams(cls, value: dict[str, list[str]]) -> dict[str, list[str]]:
        return {sport: list(dict.fromkeys(teams)) for sport, teams in value.items() if teams}


class PreferencesUpdate(BaseModel):
    selected_categories: list[str]
    focused_interests: dict[InterestName, FocusedInterest] = Field(default_factory=dict, max_length=20)
    summary_style: SummaryStyle = Field(default_factory=SummaryStyle)

    @model_validator(mode="after")
    def validate_interests(self):
        for category, interests in self.focused_interests.items():
            if category not in self.selected_categories:
                raise ValueError("Focused interests must belong to a selected category")
            if interests.teams and category != "Sports":
                raise ValueError("Team choices belong to Sports")
            if any(sport not in interests.topics for sport in interests.teams):
                raise ValueError("Team choices must belong to a selected sport")
        return self


class PreferencesResponse(PreferencesUpdate):
    onboarded: bool


def _preferences_response(row: Mapping[str, object]) -> dict[str, object]:
    return {
        "onboarded": bool(row["onboarded"]),
        "selected_categories": json.loads(row["selected_categories"]),
        "focused_interests": json.loads(row["focused_interests"]),
        "summary_style": SummaryStyle.model_validate(json.loads(row["summary_style"])).model_dump(),
    }


@router.get("", response_model=PreferencesResponse)
def get_preferences() -> dict[str, object]:
    """Return the single local user's persisted onboarding preferences."""
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT selected_categories, onboarded, focused_interests, summary_style
            FROM preferences
            WHERE id = 1
            """
        ).fetchone()

    if row is None:
        return {"onboarded": False, "selected_categories": [], "focused_interests": {},
                "summary_style": SummaryStyle().model_dump()}
    return _preferences_response(row)


@router.post("", response_model=PreferencesResponse)
def update_preferences(
    preferences: PreferencesUpdate,
    background_tasks: BackgroundTasks,
) -> dict[str, object]:
    """Persist selected categories and mark onboarding complete."""
    selected_categories = json.dumps(preferences.selected_categories)
    focused_interests = json.dumps({
        category: interests.model_dump()
        for category, interests in preferences.focused_interests.items()
        if interests.topics
    })
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO preferences (id, selected_categories, onboarded, focused_interests, summary_style)
            VALUES (1, ?, 1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                selected_categories = excluded.selected_categories,
                onboarded = 1,
                focused_interests = excluded.focused_interests,
                summary_style = excluded.summary_style
            """,
            (selected_categories, focused_interests, preferences.summary_style.model_dump_json()),
        )
        row = conn.execute(
            """
            SELECT selected_categories, onboarded, focused_interests, summary_style
            FROM preferences
            WHERE id = 1
            """
        ).fetchone()

    background_tasks.add_task(run_pipeline)
    return _preferences_response(row)
