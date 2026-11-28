"""日報の工程の名寄せ（製品単位）の API のテスト (Issue #708)。"""

from datetime import date
from unittest.mock import MagicMock, patch

import pytest
from app.dependencies import get_current_tenant_id, get_supabase_client
from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)

ROUTER = "app.routers.daily_reports.product_processes"
TENANT = "tenant-1"


@pytest.mark.api
class TestDailyReportProductProcessRouter:
    @pytest.fixture
    def mock_client(self):
        return MagicMock()

    @pytest.fixture(autouse=True)
    def override_dependency(self, mock_client):
        app.dependency_overrides[get_current_tenant_id] = lambda: TENANT
        app.dependency_overrides[get_supabase_client] = lambda: mock_client
        yield
        app.dependency_overrides = {}

    def test_list(self, mock_client):
        rows = [
            {
                "product_id": 10,
                "product_name": "ピン",
                "product_code": "P-1",
                "has_routings": False,
                "mismatch_count": 2,
                "entry_count": 7,
            }
        ]
        with patch(
            f"{ROUTER}.list_mismatched_product_processes", return_value=rows
        ) as service:
            response = client.get("/daily-reports/product-processes")

        assert response.status_code == 200
        assert response.json() == rows
        service.assert_called_once_with(mock_client, TENANT, None)

    def test_list_with_period(self, mock_client):
        with (
            patch(f"{ROUTER}.list_mismatched_product_processes", return_value=[]) as s,
            patch(f"{ROUTER}.period_start", return_value=date(2026, 9, 1)) as start,
        ):
            response = client.get("/daily-reports/product-processes?months=3")

        assert response.status_code == 200
        assert start.call_args.args[1] == 3
        s.assert_called_once_with(mock_client, TENANT, date(2026, 9, 1))

    def test_list_rejects_out_of_range_months(self):
        assert (
            client.get("/daily-reports/product-processes?months=0").status_code == 422
        )

    def test_detail(self, mock_client):
        comparison = {
            "product_id": 10,
            "product_name": "ピン",
            "product_code": None,
            "has_routings": True,
            "mismatch_count": 1,
            "routings": [
                {
                    "routing_id": 1,
                    "sequence_order": 1,
                    "process_name": "プレス",
                    "untracked": False,
                    "raws": [
                        {
                            "raw_text": "ﾌﾟﾚｽ",
                            "entry_count": 3,
                            "last_work_date": "2026-11-20",
                        }
                    ],
                }
            ],
            "off_routing": [],
            "unmatched": [
                {
                    "raw_text": "バレル",
                    "entry_count": 2,
                    "last_work_date": None,
                    "other_product_count": 3,
                }
            ],
        }
        with patch(
            f"{ROUTER}.get_product_process_comparison", return_value=comparison
        ) as service:
            response = client.get("/daily-reports/product-processes/10")

        assert response.status_code == 200
        assert response.json() == comparison
        service.assert_called_once_with(mock_client, TENANT, 10, None)

    def test_detail_not_found(self):
        with patch(f"{ROUTER}.get_product_process_comparison", return_value=None):
            response = client.get("/daily-reports/product-processes/99")
        assert response.status_code == 404
