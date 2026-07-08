import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app


class AdminRouteTests(unittest.TestCase):
    def test_refresh_queues_pipeline_and_returns_started(self) -> None:
        scheduler = MagicMock()
        with (
            patch("app.main.init_db"),
            patch("app.main.create_scheduler", return_value=scheduler),
            patch("app.routes.admin.run_pipeline") as run_pipeline_mock,
            TestClient(app) as client,
        ):
            response = client.post("/api/refresh")

        self.assertEqual(200, response.status_code)
        self.assertEqual({"status": "started"}, response.json())
        run_pipeline_mock.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
