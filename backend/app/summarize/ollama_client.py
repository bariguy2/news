"""Failure-isolated local Ollama summarization client."""

import logging
import re

import ollama

from app.config import MODEL_NAME, SUMMARY_MAX_TOKENS
from app.summarize.prompt import (
    FACTS_MARKER,
    IMPACT_MARKER,
    build_summary_prompt,
)


logger = logging.getLogger(__name__)

Summary = tuple[str, str]


def parse_summary(output: str | None) -> Summary | None:
    """Parse non-empty FACTS and IMPACT sections from model output."""
    if not output or FACTS_MARKER not in output or IMPACT_MARKER not in output:
        return None

    facts_part, impact = re.split(
        re.escape(IMPACT_MARKER),
        output,
        maxsplit=1,
    )
    _prefix, facts = facts_part.split(FACTS_MARKER, maxsplit=1)
    facts = facts.strip()
    impact = impact.strip()
    if not facts or not impact:
        return None
    return facts, impact


def summarize_text(article_text: str) -> Summary | None:
    """Generate and parse a two-part summary, retrying malformed output once.

    ``None`` signals the pipeline to mark the article as failed. Model transport
    errors are contained here so an unavailable Ollama service cannot crash the
    application.
    """
    if not article_text.strip():
        logger.warning("Cannot summarize empty article text")
        return None

    for attempt in range(2):
        prompt = build_summary_prompt(article_text, retry=attempt == 1)
        try:
            response = ollama.chat(
                model=MODEL_NAME,
                messages=[{"role": "user", "content": prompt}],
                options={"temperature": 0.3, "num_predict": SUMMARY_MAX_TOKENS},
            )
        except Exception:
            logger.exception("Ollama summarization failed using model %s", MODEL_NAME)
            return None

        parsed = parse_summary(response.message.content)
        if parsed is not None:
            return parsed

        if attempt == 0:
            logger.warning("Ollama returned malformed summary output; retrying once")

    logger.error("Ollama returned malformed summary output after retry")
    return None
