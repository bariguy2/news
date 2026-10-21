"""Small streaming HTTP adapters. Provider payloads and credentials stay private."""

import json
import os
from dataclasses import dataclass
from time import monotonic
from urllib.parse import quote

import httpx


@dataclass
class Completion:
    text: str = ''
    input_tokens: int | None = None
    output_tokens: int | None = None  # includes reasoning
    reasoning_tokens: int | None = None
    finish_reason: str | None = None


class ProviderError(Exception):
    def __init__(self, code, *, retryable=False, rejected=False):
        super().__init__(code)
        self.code = code
        self.retryable = retryable
        self.rejected = rejected


def token_count(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def generate(config, prompt, on_text=None):
    if config.provider != 'ollama' and not config.key:
        raise ProviderError('missing_api_key', rejected=True)
    headers = {}
    if config.provider == 'groq':
        url = 'https://api.groq.com/openai/v1/chat/completions'
        headers = {'Authorization': 'Bearer ' + config.key}
        payload = {'model': config.model, 'messages': [{'role': 'user', 'content': prompt}],
                   'max_completion_tokens': config.max_output, 'stream': True,
                   'stream_options': {'include_usage': True}}
        if 'gpt-oss' in config.model:
            payload.update(reasoning_effort='low', include_reasoning=False)
    elif config.provider == 'gemini':
        url = 'https://generativelanguage.googleapis.com/v1beta/models/' + quote(config.model, safe='-._') + ':streamGenerateContent?alt=sse'
        headers = {'x-goog-api-key': config.key}
        payload = {'contents': [{'parts': [{'text': prompt}]}],
                   'generationConfig': {'maxOutputTokens': config.max_output}}
    else:
        url = os.environ.get('OLLAMA_HOST', 'http://localhost:11434').rstrip('/') + '/api/chat'
        payload = {'model': config.model, 'messages': [{'role': 'user', 'content': prompt}],
                   'stream': True, 'options': {'temperature': 0.3, 'num_predict': config.max_output}}

    completion = Completion()
    started = monotonic()
    finished = False
    try:
        # No SDK retries: every request must first reserve its own allowance.
        with httpx.Client(timeout=config.timeout, follow_redirects=False) as client:
            with client.stream('POST', url, headers=headers, json=payload) as response:
                if response.status_code >= 300:
                    code = response.status_code
                    raise ProviderError(f'http_{code}', retryable=code >= 500,
                                        rejected=code in (400, 401, 403, 404, 422, 429))
                for line in response.iter_lines():
                    if monotonic() - started > config.timeout:
                        raise ProviderError('deadline_exceeded', retryable=True)
                    if len(line) > 1_000_000:
                        raise ProviderError('oversized_response')
                    if not line or line.startswith(':'):
                        continue
                    if config.provider != 'ollama':
                        if not line.startswith('data:'):
                            continue
                        line = line[5:].strip()
                        if line == '[DONE]':
                            break
                    data = json.loads(line)
                    if data.get('error'):
                        raise ProviderError('stream_error')
                    text = ''
                    if config.provider == 'groq':
                        for choice in data.get('choices', []):
                            text += choice.get('delta', {}).get('content') or ''
                            if choice.get('finish_reason'):
                                completion.finish_reason = choice['finish_reason']
                                finished = True
                        usage = data.get('usage') or (data.get('x_groq') or {}).get('usage')
                        if usage:
                            completion.input_tokens = token_count(usage.get('prompt_tokens'))
                            completion.output_tokens = token_count(usage.get('completion_tokens'))
                            completion.reasoning_tokens = token_count((usage.get('completion_tokens_details') or {}).get('reasoning_tokens'))
                    elif config.provider == 'gemini':
                        for candidate in data.get('candidates', []):
                            text += ''.join(part.get('text', '') for part in candidate.get('content', {}).get('parts', []) if not part.get('thought'))
                            if candidate.get('finishReason'):
                                completion.finish_reason = candidate['finishReason']
                                finished = True
                        usage = data.get('usageMetadata')
                        if usage:
                            completion.input_tokens = token_count(usage.get('promptTokenCount'))
                            visible = token_count(usage.get('candidatesTokenCount'))
                            thinking = token_count(usage.get('thoughtsTokenCount', 0))
                            completion.reasoning_tokens = thinking
                            completion.output_tokens = visible + thinking if visible is not None and thinking is not None else None
                    else:
                        text = data.get('message', {}).get('content') or ''
                        if data.get('done'):
                            finished = True
                            completion.finish_reason = data.get('done_reason', 'stop')
                            completion.input_tokens = token_count(data.get('prompt_eval_count'))
                            completion.output_tokens = token_count(data.get('eval_count'))
                    completion.text += text
                    if len(completion.text) > 100_000:
                        raise ProviderError('oversized_output')
                    if text and on_text:
                        on_text(text)
        if not finished:
            raise ProviderError('incomplete_stream', retryable=True)
        return completion
    except ProviderError:
        raise
    except httpx.TransportError:
        raise ProviderError('transport_error', retryable=True) from None
    except (ValueError, TypeError, AttributeError):
        raise ProviderError('invalid_response') from None
