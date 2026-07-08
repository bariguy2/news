"""Failure-isolated full-text article extraction."""

import logging

import trafilatura


logger = logging.getLogger(__name__)

MIN_EXTRACTED_TEXT_CHARS = 200


def extract_full_text(url: str) -> tuple[str | None, bool]:
    """Download and extract useful article text from ``url``.

    A false result tells the pipeline to use the stored RSS excerpt instead.
    Network, parsing, and extraction failures are contained at this boundary.
    """
    try:
        downloaded = trafilatura.fetch_url(url)
        if not downloaded:
            logger.warning("Could not download article text from %s", url)
            return None, False

        extracted = trafilatura.extract(
            downloaded,
            include_comments=False,
            favor_recall=True,
        )
        if not extracted:
            logger.warning("Could not extract article text from %s", url)
            return None, False

        text = extracted.strip()
        if len(text) < MIN_EXTRACTED_TEXT_CHARS:
            logger.warning(
                "Extracted article text from %s was too short (%d characters)",
                url,
                len(text),
            )
            return None, False

        return text, True
    except Exception:
        logger.exception("Article extraction failed for %s", url)
        return None, False
