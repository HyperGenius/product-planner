from unittest.mock import patch

import pytest
from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)

VALID_SECRET = "test-cron-secret-abc123"
ROUTER = "app.routers.cron.compute_daily_report_progress"
PATH = "/api/cron/compute-daily-report-progress"


@pytest.mark.api
class TestComputeDailyReportProgressRouter:
    def test_missing_auth_header_returns_401(self, monkeypatch):
        monkeypatch.setenv("CRON_SECRET", VALID_SECRET)
        response = client.get(PATH)
        assert response.status_code == 401

    def test_wrong_secret_returns_401(self, monkeypatch):
        monkeypatch.setenv("CRON_SECRET", VALID_SECRET)
        response = client.get(PATH, headers={"Authorization": "Bearer wrong-secret"})
        assert response.status_code == 401

    def test_valid_secret_returns_summary(self, monkeypatch):
        monkeypatch.setenv("CRON_SECRET", VALID_SECRET)
        summary = {
            "tenants": 2,
            "replaced": 2,
            "stale": 0,
            "failed": 0,
            "progress": 40,
            "unallocated": 3,
            "unmatched_entries": 12,
        }
        with (
            patch(f"{ROUTER}.get_supabase_admin_client"),
            patch(f"{ROUTER}.recompute_all_tenants", return_value=summary),
        ):
            response = client.get(
                PATH, headers={"Authorization": f"Bearer {VALID_SECRET}"}
            )
        assert response.status_code == 200
        assert response.json() == summary

    def test_service_error_returns_502_with_fixed_message(self, monkeypatch):
        monkeypatch.setenv("CRON_SECRET", VALID_SECRET)
        with (
            patch(f"{ROUTER}.get_supabase_admin_client"),
            patch(
                f"{ROUTER}.recompute_all_tenants",
                side_effect=Exception("secret internal detail"),
            ),
        ):
            response = client.get(
                PATH, headers={"Authorization": f"Bearer {VALID_SECRET}"}
            )
        assert response.status_code == 502
        assert response.json() == {"detail": "compute-daily-report-progress failed"}

    def test_tenant_failure_returns_502_and_alerts(self, monkeypatch):
        """テナント単位の失敗は HTTP 200 で握りつぶさず 502 にして通知する（Issue #636）"""
        monkeypatch.setenv("CRON_SECRET", VALID_SECRET)
        summary = {"tenants": 3, "replaced": 2, "stale": 0, "failed": 1}
        with (
            patch(f"{ROUTER}.get_supabase_admin_client"),
            patch(f"{ROUTER}.recompute_all_tenants", return_value=summary),
            patch(f"{ROUTER}.alert_cron_failure") as alert_failure,
            patch(f"{ROUTER}.alert_cron_success") as alert_success,
        ):
            response = client.get(
                PATH, headers={"Authorization": f"Bearer {VALID_SECRET}"}
            )
        assert response.status_code == 502
        assert response.json() == {"detail": "compute-daily-report-progress failed"}
        alert_failure.assert_called_once_with("compute-daily-report-progress", 1)
        alert_success.assert_not_called()

    def test_success_reports_recovery(self, monkeypatch):
        monkeypatch.setenv("CRON_SECRET", VALID_SECRET)
        with (
            patch(f"{ROUTER}.get_supabase_admin_client"),
            patch(f"{ROUTER}.recompute_all_tenants", return_value={"failed": 0}),
            patch(f"{ROUTER}.alert_cron_failure") as alert_failure,
            patch(f"{ROUTER}.alert_cron_success") as alert_success,
        ):
            response = client.get(
                PATH, headers={"Authorization": f"Bearer {VALID_SECRET}"}
            )
        assert response.status_code == 200
        alert_success.assert_called_once_with("compute-daily-report-progress")
        alert_failure.assert_not_called()
