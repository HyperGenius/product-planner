from unittest.mock import patch

import pytest
from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)

VALID_SECRET = "test-cron-secret-abc123"


@pytest.mark.api
class TestAdvanceOrderStatusRouter:
    def test_missing_auth_header_returns_401(self, monkeypatch):
        monkeypatch.setenv("CRON_SECRET", VALID_SECRET)
        response = client.get("/api/cron/advance-order-status")
        assert response.status_code == 401

    def test_wrong_secret_returns_401(self, monkeypatch):
        monkeypatch.setenv("CRON_SECRET", VALID_SECRET)
        response = client.get(
            "/api/cron/advance-order-status",
            headers={"Authorization": "Bearer wrong-secret"},
        )
        assert response.status_code == 401

    def test_valid_secret_returns_transition_summary(self, monkeypatch):
        monkeypatch.setenv("CRON_SECRET", VALID_SECRET)
        summary = {
            "to_in_progress": 2,
            "to_confirmed": 1,
            "in_progress_order_ids": [10, 11],
            "confirmed_order_ids": [12],
        }
        with (
            patch("app.routers.cron.advance_order_status.get_supabase_admin_client"),
            patch(
                "app.routers.cron.advance_order_status.advance_order_statuses",
                return_value=summary,
            ),
        ):
            response = client.get(
                "/api/cron/advance-order-status",
                headers={"Authorization": f"Bearer {VALID_SECRET}"},
            )
        assert response.status_code == 200
        assert response.json() == summary

    def test_missing_cron_secret_env_returns_500(self, monkeypatch):
        monkeypatch.delenv("CRON_SECRET", raising=False)
        response = client.get(
            "/api/cron/advance-order-status",
            headers={"Authorization": f"Bearer {VALID_SECRET}"},
        )
        assert response.status_code == 500

    def test_service_error_returns_502(self, monkeypatch):
        monkeypatch.setenv("CRON_SECRET", VALID_SECRET)
        with (
            patch("app.routers.cron.advance_order_status.get_supabase_admin_client"),
            patch(
                "app.routers.cron.advance_order_status.advance_order_statuses",
                side_effect=Exception("db down"),
            ),
        ):
            response = client.get(
                "/api/cron/advance-order-status",
                headers={"Authorization": f"Bearer {VALID_SECRET}"},
            )
        assert response.status_code == 502
