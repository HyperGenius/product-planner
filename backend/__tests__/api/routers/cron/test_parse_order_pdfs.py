from unittest.mock import patch

import pytest
from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)

VALID_SECRET = "test-cron-secret-abc123"


@pytest.mark.api
class TestParseOrderPdfsRouter:
    def test_missing_auth_header_returns_401(self, monkeypatch):
        monkeypatch.setenv("CRON_SECRET", VALID_SECRET)
        response = client.get("/api/cron/parse-order-pdfs")
        assert response.status_code == 401

    def test_wrong_secret_returns_401(self, monkeypatch):
        monkeypatch.setenv("CRON_SECRET", VALID_SECRET)
        response = client.get(
            "/api/cron/parse-order-pdfs",
            headers={"Authorization": "Bearer wrong-secret"},
        )
        assert response.status_code == 401

    def test_valid_secret_returns_result(self, monkeypatch):
        monkeypatch.setenv("CRON_SECRET", VALID_SECRET)
        with (
            patch("app.routers.cron.parse_order_pdfs.get_supabase_admin_client"),
            patch(
                "app.routers.cron.parse_order_pdfs.parse_pending_order_pdfs",
                return_value={"processed": 2, "orders_created": 3, "errors": 0},
            ),
        ):
            response = client.get(
                "/api/cron/parse-order-pdfs",
                headers={"Authorization": f"Bearer {VALID_SECRET}"},
            )
        assert response.status_code == 200
        assert response.json() == {"processed": 2, "orders_created": 3, "errors": 0}

    def test_missing_cron_secret_env_returns_500(self, monkeypatch):
        monkeypatch.delenv("CRON_SECRET", raising=False)
        response = client.get(
            "/api/cron/parse-order-pdfs",
            headers={"Authorization": f"Bearer {VALID_SECRET}"},
        )
        assert response.status_code == 500

    def test_parsing_error_returns_502(self, monkeypatch):
        monkeypatch.setenv("CRON_SECRET", VALID_SECRET)
        with (
            patch("app.routers.cron.parse_order_pdfs.get_supabase_admin_client"),
            patch(
                "app.routers.cron.parse_order_pdfs.parse_pending_order_pdfs",
                side_effect=Exception("storage unavailable"),
            ),
        ):
            response = client.get(
                "/api/cron/parse-order-pdfs",
                headers={"Authorization": f"Bearer {VALID_SECRET}"},
            )
        assert response.status_code == 502
