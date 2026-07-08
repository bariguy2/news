"""Prompt construction for two-part article summaries."""

FACTS_MARKER = "===FACTS==="
IMPACT_MARKER = "===IMPACT==="
MAX_INPUT_CHARS = 6_000

RETRY_REMINDER = (
    "REMINDER: Your response must contain both literal section markers exactly "
    "as shown, with non-empty text in each section. Return no text outside those "
    "two sections."
)


def build_summary_prompt(article_text: str, *, retry: bool = False) -> str:
    """Build the constrained prompt, truncating article input for local inference."""
    truncated_text = article_text.strip()[:MAX_INPUT_CHARS]
    prompt = f"""Summarize the article text below using only information it contains.

Respond in exactly this format:
{FACTS_MARKER}
Write 3-5 neutral, evidence-focused sentences covering who, what, key numbers,
and credible evidence. Do not add unsupported claims.

{IMPACT_MARKER}
Write one opinionated paragraph explaining the event's broader significance and
why it matters. Ground the opinion in the facts above.

ARTICLE TEXT:
{truncated_text}
--- END ARTICLE TEXT ---"""

    if retry:
        return f"{prompt}\n\n{RETRY_REMINDER}"
    return prompt
