import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.config import MODEL_NAME
from app.summarize.ollama_client import parse_summary, summarize_text
from app.summarize.prompt import FACTS_MARKER, IMPACT_MARKER, RETRY_REMINDER


def chat_response(content: str) -> SimpleNamespace:
    return SimpleNamespace(message=SimpleNamespace(content=content))


class SummaryParsingTests(unittest.TestCase):
    def test_parses_and_trims_both_sections(self) -> None:
        output = f"""Intro ignored
        {FACTS_MARKER}
        Neutral facts.

        {IMPACT_MARKER}
        Broader impact.
        """

        self.assertEqual(
            ("Neutral facts.", "Broader impact."),
            parse_summary(output),
        )

    def test_rejects_missing_markers_or_empty_sections(self) -> None:
        malformed_outputs = (
            None,
            "",
            "No markers",
            f"{FACTS_MARKER} Facts only",
            f"{IMPACT_MARKER} Impact only",
            f"{FACTS_MARKER} {IMPACT_MARKER} Impact only",
            f"{FACTS_MARKER} Facts only {IMPACT_MARKER}",
        )

        for output in malformed_outputs:
            with self.subTest(output=output):
                self.assertIsNone(parse_summary(output))


class OllamaClientTests(unittest.TestCase):
    @patch("app.summarize.ollama_client.ollama.chat")
    def test_calls_configured_model_and_returns_parsed_summary(self, chat_mock) -> None:
        chat_mock.return_value = chat_response(
            f"{FACTS_MARKER}\nFacts.\n{IMPACT_MARKER}\nImpact."
        )

        result = summarize_text("Article body")

        self.assertEqual(("Facts.", "Impact."), result)
        chat_mock.assert_called_once()
        kwargs = chat_mock.call_args.kwargs
        self.assertEqual(MODEL_NAME, kwargs["model"])
        self.assertEqual({"temperature": 0.3}, kwargs["options"])
        self.assertEqual("user", kwargs["messages"][0]["role"])
        self.assertIn("Article body", kwargs["messages"][0]["content"])

    @patch("app.summarize.ollama_client.ollama.chat")
    def test_retries_malformed_output_once_with_reminder(self, chat_mock) -> None:
        chat_mock.side_effect = (
            chat_response("Malformed"),
            chat_response(f"{FACTS_MARKER} Facts. {IMPACT_MARKER} Impact."),
        )

        with self.assertLogs("app.summarize.ollama_client", level="WARNING"):
            result = summarize_text("Article body")

        self.assertEqual(("Facts.", "Impact."), result)
        self.assertEqual(2, chat_mock.call_count)
        first_prompt = chat_mock.call_args_list[0].kwargs["messages"][0]["content"]
        second_prompt = chat_mock.call_args_list[1].kwargs["messages"][0]["content"]
        self.assertNotIn(RETRY_REMINDER, first_prompt)
        self.assertTrue(second_prompt.endswith(RETRY_REMINDER))

    @patch("app.summarize.ollama_client.ollama.chat")
    def test_returns_none_after_two_malformed_outputs(self, chat_mock) -> None:
        chat_mock.return_value = chat_response("Malformed")

        with self.assertLogs("app.summarize.ollama_client", level="WARNING") as logs:
            result = summarize_text("Article body")

        self.assertIsNone(result)
        self.assertEqual(2, chat_mock.call_count)
        self.assertTrue(any("after retry" in line for line in logs.output))

    @patch("app.summarize.ollama_client.ollama.chat")
    def test_contains_model_failure(self, chat_mock) -> None:
        chat_mock.side_effect = ConnectionError("Ollama unavailable")

        with self.assertLogs("app.summarize.ollama_client", level="ERROR") as logs:
            result = summarize_text("Article body")

        self.assertIsNone(result)
        self.assertEqual(1, chat_mock.call_count)
        self.assertTrue(any("Ollama unavailable" in line for line in logs.output))

    @patch("app.summarize.ollama_client.ollama.chat")
    def test_rejects_empty_input_without_calling_model(self, chat_mock) -> None:
        with self.assertLogs("app.summarize.ollama_client", level="WARNING"):
            result = summarize_text("   ")

        self.assertIsNone(result)
        chat_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
