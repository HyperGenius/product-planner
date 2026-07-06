from unittest.mock import patch

import pytest
from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)

VALID_SECRET = "test-cron-secret-abc123"


@pytest.mark.api
class TestGmailPollRouter:
    def test_missing_auth_header_returns_401(self, monkeypatch):
        monkeypatch.setenv("CRON_SECRET", VALID_SECRET)
        response = client.get("/api/cron/gmail-poll")
        assert response.status_code == 401

    def test_wrong_secret_returns_401(self, monkeypatch):
        monkeypatch.setenv("CRON_SECRET", VALID_SECRET)
        response = client.get(
            "/api/cron/gmail-poll",
            headers={"Authorization": "Bearer wrong-secret"},
        )
        assert response.status_code == 401

    def test_valid_secret_returns_processed_count(self, monkeypatch):
        monkeypatch.setenv("CRON_SECRET", VALID_SECRET)
        with (
            patch("app.routers.cron.gmail_poll.get_supabase_admin_client"),
            patch(
                "app.routers.cron.gmail_poll.poll_unread_emails",
                return_value={"processed": 3},
            ),
        ):
            response = client.get(
                "/api/cron/gmail-poll",
                headers={"Authorization": f"Bearer {VALID_SECRET}"},
            )
        assert response.status_code == 200
        assert response.json() == {"processed": 3}

    def test_missing_cron_secret_env_returns_500(self, monkeypatch):
        monkeypatch.delenv("CRON_SECRET", raising=False)
        response = client.get(
            "/api/cron/gmail-poll",
            headers={"Authorization": f"Bearer {VALID_SECRET}"},
        )
        assert response.status_code == 500

    def test_gmail_service_value_error_returns_500(self, monkeypatch):
        monkeypatch.setenv("CRON_SECRET", VALID_SECRET)
        with (
            patch("app.routers.cron.gmail_poll.get_supabase_admin_client"),
            patch(
                "app.routers.cron.gmail_poll.poll_unread_emails",
                side_effect=ValueError("Missing env vars"),
            ),
        ):
            response = client.get(
                "/api/cron/gmail-poll",
                headers={"Authorization": f"Bearer {VALID_SECRET}"},
            )
        assert response.status_code == 500

    def test_gmail_api_error_returns_502(self, monkeypatch):
        monkeypatch.setenv("CRON_SECRET", VALID_SECRET)
        with (
            patch("app.routers.cron.gmail_poll.get_supabase_admin_client"),
            patch(
                "app.routers.cron.gmail_poll.poll_unread_emails",
                side_effect=Exception("Gmail rate limit"),
            ),
        ):
            response = client.get(
                "/api/cron/gmail-poll",
                headers={"Authorization": f"Bearer {VALID_SECRET}"},
            )
        assert response.status_code == 502
