import unittest
from unittest.mock import patch
from app import summary_progress as progress


class ArticleProgressTests(unittest.TestCase):
    def test_estimates_are_monotonic_bounded_and_failures_never_complete(self):
        with patch.object(progress, '_articles', {}), patch.object(progress, 'monotonic', return_value=100):
            progress.start_batch([1, 2])
            self.assertEqual(0, progress.get_article_progress(1, 'pending')['percentage'])
            progress.update_article(1, 'extracting', 2)
            progress.update_article(1, 'summarizing', 45)
            progress.update_article(1, 'retrying', 10)
            self.assertEqual(45, progress.get_article_progress(1, 'pending')['percentage'])
            self.assertEqual(0, progress.get_article_progress(2, 'pending')['percentage'])
            progress.update_article(1, 'saving', 100)
            self.assertEqual(99, progress.get_article_progress(1, 'pending')['percentage'])
            progress.finish_article(1, False)
            self.assertEqual(99, progress.get_article_progress(1, 'failed')['percentage'])
            self.assertEqual(0, progress.get_article_progress(1, 'pending')['percentage'])
            self.assertEqual(100, progress.get_article_progress(1, 'done')['percentage'])
            progress.start_batch([1])
            self.assertEqual(0, progress.get_article_progress(1, 'pending')['percentage'])
            progress.interrupt_batch()
            self.assertEqual('interrupted', progress.get_article_progress(1, 'pending')['stage'])

    def test_elapsed_time_freezes_when_finished_and_restart_uses_database(self):
        with patch.object(progress, '_articles', {}):
            progress.start_batch([1])
            with patch.object(progress, 'monotonic', return_value=100):
                progress.update_article(1, 'extracting', 2)
            with patch.object(progress, 'monotonic', return_value=112):
                self.assertEqual(12, progress.get_article_progress(1, 'pending')['elapsed_seconds'])
                progress.finish_article(1, True)
            with patch.object(progress, 'monotonic', return_value=200):
                self.assertEqual(12, progress.get_article_progress(1, 'done')['elapsed_seconds'])
            with patch.object(progress, '_articles', {}):
                self.assertEqual(100, progress.get_article_progress(1, 'done')['percentage'])
                self.assertEqual(0, progress.get_article_progress(2, 'pending')['percentage'])
