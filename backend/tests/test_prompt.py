import unittest

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


if __name__ == "__main__":
    unittest.main()
