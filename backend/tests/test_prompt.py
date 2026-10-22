import unittest
from itertools import product
from app.summarize.style import SummaryStyle

from app.summarize.prompt import (
    FACTS_MARKER,
    IMPACT_MARKER,
    MAX_INPUT_CHARS,
    RETRY_REMINDER,
    build_summary_prompt,
)


class SummaryPromptTests(unittest.TestCase):
    def test_prompt_contains_required_format_and_truncates_article(self) -> None:
        article = "a" * MAX_INPUT_CHARS + "TRUNCATED"

        prompt = build_summary_prompt(article)

        self.assertIn(FACTS_MARKER, prompt)
        self.assertIn(IMPACT_MARKER, prompt)
        self.assertIn("a" * MAX_INPUT_CHARS, prompt)
        self.assertNotIn("TRUNCATED", prompt)
        self.assertNotIn(RETRY_REMINDER, prompt)

    def test_retry_prompt_appends_literal_marker_reminder(self) -> None:
        prompt = build_summary_prompt("Article text", retry=True)

        self.assertTrue(prompt.endswith(RETRY_REMINDER))
        self.assertIn("both literal section markers", RETRY_REMINDER)

    def test_all_style_combinations_preserve_factual_constraints_and_markers(self) -> None:
        for tone, length, presentation in product(
            ['neutral', 'conversational', 'analytical'], ['brief', 'standard', 'detailed'],
            ['bullets', 'paragraphs', 'mixed'],
        ):
            with self.subTest(tone=tone, length=length, format=presentation):
                style = SummaryStyle(tone=tone, length=length, format=presentation)
                prompt = build_summary_prompt('Article evidence.', style=style, retry=True)
                self.assertIn('neutral, evidence-focused facts', prompt)
                self.assertIn('Do not add unsupported claims', prompt)
                self.assertIn(FACTS_MARKER, prompt)
                self.assertIn(IMPACT_MARKER, prompt)
                self.assertTrue(prompt.endswith(RETRY_REMINDER))
                self.assertIn({'brief': '60-100', 'standard': '120-180', 'detailed': '220-300'}[length], prompt)
                self.assertIn({'bullets': 'bullet points only', 'paragraphs': 'paragraphs only', 'mixed': 'Use a paragraph in IMPACT'}[presentation], prompt)
                self.assertIn({'neutral': 'matter-of-fact', 'conversational': 'approachable', 'analytical': 'analytical language'}[tone], prompt)


if __name__ == "__main__":
    unittest.main()
