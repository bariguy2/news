import unittest
from unittest.mock import patch

from app.ingest.extract import MIN_EXTRACTED_TEXT_CHARS, extract_full_text


class ArticleExtractionTests(unittest.TestCase):
    @patch("app.ingest.extract.trafilatura.extract")
    @patch("app.ingest.extract.trafilatura.fetch_url")
    def test_returns_trimmed_full_text_when_extraction_is_long_enough(
        self, fetch_url_mock, extract_mock
    ) -> None:
        extracted = "x" * MIN_EXTRACTED_TEXT_CHARS
        fetch_url_mock.return_value = "<html>downloaded</html>"
        extract_mock.return_value = f"  {extracted}\n"

        text, extraction_ok = extract_full_text("https://example.com/story")

        self.assertEqual(extracted, text)
        self.assertTrue(extraction_ok)
        fetch_url_mock.assert_called_once_with("https://example.com/story")
        extract_mock.assert_called_once_with(
            "<html>downloaded</html>",
            include_comments=False,
            favor_recall=True,
        )

    @patch("app.ingest.extract.trafilatura.extract")
    @patch("app.ingest.extract.trafilatura.fetch_url")
    def test_missing_download_signals_excerpt_fallback(
        self, fetch_url_mock, extract_mock
    ) -> None:
        fetch_url_mock.return_value = None

        with self.assertLogs("app.ingest.extract", level="WARNING"):
            result = extract_full_text("https://example.com/story")

        self.assertEqual((None, False), result)
        extract_mock.assert_not_called()

    @patch("app.ingest.extract.trafilatura.extract")
    @patch("app.ingest.extract.trafilatura.fetch_url", return_value="downloaded")
    def test_missing_or_short_extraction_signals_excerpt_fallback(
        self, _fetch_url_mock, extract_mock
    ) -> None:
        for extracted in (None, "x" * (MIN_EXTRACTED_TEXT_CHARS - 1)):
            with self.subTest(extracted=extracted):
                extract_mock.return_value = extracted
                with self.assertLogs("app.ingest.extract", level="WARNING"):
                    result = extract_full_text("https://example.com/story")
                self.assertEqual((None, False), result)

    @patch("app.ingest.extract.trafilatura.fetch_url")
    def test_network_exception_is_contained_and_signals_fallback(
        self, fetch_url_mock
    ) -> None:
        fetch_url_mock.side_effect = TimeoutError("request timed out")

        with self.assertLogs("app.ingest.extract", level="ERROR") as logs:
            result = extract_full_text("https://example.com/story")

        self.assertEqual((None, False), result)
        self.assertTrue(any("request timed out" in line for line in logs.output))

    @patch("app.ingest.extract.trafilatura.extract")
    @patch("app.ingest.extract.trafilatura.fetch_url", return_value="downloaded")
    def test_extractor_exception_is_contained_and_signals_fallback(
        self, _fetch_url_mock, extract_mock
    ) -> None:
        extract_mock.side_effect = ValueError("malformed document")

        with self.assertLogs("app.ingest.extract", level="ERROR") as logs:
            result = extract_full_text("https://example.com/story")

        self.assertEqual((None, False), result)
        self.assertTrue(any("malformed document" in line for line in logs.output))


if __name__ == "__main__":
    unittest.main()
