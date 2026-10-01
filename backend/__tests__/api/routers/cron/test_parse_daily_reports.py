from unittest.mock import patch

import pytest
from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)

VALID_SECRET = "test-cron-secret-abc123"
ROUTER = "app.routers.cron.parse_daily_reports"


@pytest.mark.api
class TestParseDailyReportsRouter:
    def test_missing_auth_header_returns_401(self, monkeypatch):
        monkeypatch.setenv("CRON_SECRET", VALID_SECRET)
        response = client.get("/api/cron/parse-daily-reports")
        assert response.status_code == 401

    def test_wrong_secret_returns_401(self, monkeypatch):
        monkeypatch.setenv("CRON_SECRET", VALID_SECRET)
        response = client.get(
            "/api/cron/parse-daily-reports",
            headers={"Authorization": "Bearer wrong-secret"},
        )
        assert response.status_code == 401

    def test_missing_cron_secret_env_returns_500(self, monkeypatch):
        monkeypatch.delenv("CRON_SECRET", raising=False)
        response = client.get(
            "/api/cron/parse-daily-reports",
            headers={"Authorization": f"Bearer {VALID_SECRET}"},
        )
        assert response.status_code == 500

    def test_valid_secret_returns_summary(self, monkeypatch):
        monkeypatch.setenv("CRON_SECRET", VALID_SECRET)
        summary = {
            "processed": 2,
            "parsed": 1,
            "unsupported": 1,
            "failed": 0,
            "sheets_replaced": 1,
            "sheets_stale": 0,
            "sheets_without_header": 0,
            "entries_saved": 230,
        }
        with (
            patch(f"{ROUTER}.get_supabase_admin_client"),
            patch(f"{ROUTER}.parse_pending_daily_reports", return_value=summary),
        ):
            response = client.get(
                "/api/cron/parse-daily-reports",
                headers={"Authorization": f"Bearer {VALID_SECRET}"},
            )
        assert response.status_code == 200
        assert response.json() == summary

    def test_service_error_returns_502_with_fixed_message(self, monkeypatch):
        monkeypatch.setenv("CRON_SECRET", VALID_SECRET)
        with (
            patch(f"{ROUTER}.get_supabase_admin_client"),
            patch(
                f"{ROUTER}.parse_pending_daily_reports",
                side_effect=Exception("secret internal detail"),
            ),
        ):
            response = client.get(
                "/api/cron/parse-daily-reports",
                headers={"Authorization": f"Bearer {VALID_SECRET}"},
            )
        assert response.status_code == 502
        assert response.json() == {"detail": "parse-daily-reports failed"}
