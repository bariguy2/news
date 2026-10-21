"""Validated reader choices shared by preferences and the summary pipeline."""

from typing import Literal

from pydantic import BaseModel, ConfigDict


class SummaryStyle(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    tone: Literal["neutral", "conversational", "analytical"] = "neutral"
    length: Literal["brief", "standard", "detailed"] = "standard"
    format: Literal["bullets", "paragraphs", "mixed"] = "paragraphs"

    @property
    def max_tokens(self) -> int:
        """Visible-text estimate; hosted providers retain their configured reasoning budget."""
        return {"brief": 256, "standard": 512, "detailed": 768}[self.length]

    @property
    def version(self) -> str:
        return f"{self.tone}-{self.length}-{self.format}"
