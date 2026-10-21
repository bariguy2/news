"""Provider-independent generation, reservations, retries, and summary parsing."""

import hashlib
import logging
from dataclasses import dataclass, field, replace
from threading import BoundedSemaphore
from time import monotonic, sleep

from app.config import PIPELINE_CONCURRENCY
from app.summarize.prompt import PROMPT_VERSION, build_summary_prompt, parse_summary
from app.summarize.providers import Completion, ProviderError, generate
from app.summarize.settings import settings
from app.summarize.usage import BudgetExceeded, reserve, settle
from app.summarize.style import SummaryStyle

logger = logging.getLogger(__name__)
_slots = BoundedSemaphore(PIPELINE_CONCURRENCY)


@dataclass
class Generation:
    facts: str
    impact: str
    provider: str
    model: str
    prompt_version: str
    input_hash: str
    attempt_ids: list[str] = field(default_factory=list)


@dataclass
class CallResult:
    completion: Completion | None = None
    error: str | None = None
    attempt_ids: list[str] = field(default_factory=list)
    elapsed_ms: int = 0


def call_model(prompt, config, *, scope='summary', prompt_version=PROMPT_VERSION,
               validate=lambda result: True, on_progress=None, progress_tokens=512) -> CallResult:
    result = CallResult()
    started = monotonic()
    prompt_hash = hashlib.sha256(prompt.encode()).hexdigest()
    for attempt in range(config.attempts):
        stage = 'retrying' if attempt else 'summarizing'
        characters = 0

        def streamed(text):
            nonlocal characters
            characters += len(text)
            if on_progress:
                # Visible output only: an estimate, never expose reasoning.
                on_progress(stage, 10 + min(85, characters * 85 // (progress_tokens * 4)))

        with _slots:
            try:
                attempt_id = reserve(config, prompt, scope, prompt_version, prompt_hash)
            except BudgetExceeded:
                result.error = 'budget_exceeded'
                break
            result.attempt_ids.append(attempt_id)
            attempt_start = monotonic()
            if on_progress:
                on_progress(stage, 10)
            try:
                completion = generate(config, prompt, streamed)
            except ProviderError as exc:
                settle(attempt_id, config, status=exc.code,
                       elapsed_ms=int((monotonic() - attempt_start) * 1000), rejected=exc.rejected)
                result.error = exc.code
                if not exc.retryable:
                    break
            else:
                valid = completion.finish_reason in ('stop', 'STOP', 'end_turn') and validate(completion.text)
                result.completion = completion
                result.error = None if valid else 'invalid_output'
                settle(attempt_id, config, status='success' if valid else 'invalid_output',
                       elapsed_ms=int((monotonic() - attempt_start) * 1000), completion=completion)
                if valid:
                    break
        if attempt + 1 < config.attempts:
            sleep(2 ** attempt)
    result.elapsed_ms = int((monotonic() - started) * 1000)
    return result


def summarize_text(article_text, *, on_progress=None, provider=None, scope='summary', diagnostics=None,
                   style: SummaryStyle | None = None):
    if not article_text.strip():
        return None
    try:
        config = settings(provider)
        style = style or SummaryStyle()
        # Never reduce hosted reasoning budgets or exceed the operator's token cap.
        if config.provider == 'ollama':
            config = replace(config, max_output=min(config.max_output, style.max_tokens))
        prompt_version = f'{PROMPT_VERSION}:{style.version}'
        prompt = build_summary_prompt(article_text, style=style)
        result = call_model(prompt, config, scope=scope, validate=lambda text: parse_summary(text) is not None,
                            on_progress=on_progress, prompt_version=prompt_version, progress_tokens=style.max_tokens)
        if diagnostics is not None:
            diagnostics.update(error=result.error, elapsed_ms=result.elapsed_ms, attempt_ids=result.attempt_ids)
        if result.error or result.completion is None:
            logger.warning('Summary failed: provider=%s code=%s', config.provider, result.error)
            return None
        facts, impact = parse_summary(result.completion.text)
        if on_progress:
            on_progress('saving', 99)
        return Generation(facts, impact, config.provider, config.model, prompt_version,
                          hashlib.sha256(article_text.strip()[:6000].encode()).hexdigest(), result.attempt_ids)
    except Exception as exc:
        # Errors may carry database credentials or request headers; log type only.
        logger.error('Summary failure (%s)', type(exc).__name__)
        if diagnostics is not None:
            diagnostics['error'] = 'configuration_or_storage_error'
        return None
