"""日報の実績による受注の進捗 API のテスト (Issue #490)。"""

from unittest.mock import MagicMock, patch

import pytest
from app.dependencies import get_current_tenant_id, get_supabase_client
from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)

DAILY_REPORTS_ROUTER = "app.routers.daily_reports.progress"
ORDERS_ROUTER = "app.routers.transaction.orders.progress"
TENANT = "tenant-1"
COMPUTED_AT = "2026-10-01T03:00:00+00:00"

PROGRESS_ROW = {
    "order_id": 1000001,
    "process_routing_id": 100001,
    "sequence_order": 1,
    "process_name": "プレス",
    "good_qty": 100,
    "first_actual_date": "2026-09-10",
    "last_actual_date": "2026-09-12",
    "status": "completed",
    "completed_by": "quantity",
    "computed_at": COMPUTED_AT,
}
PROGRESS_RESPONSE = {k: v for k, v in PROGRESS_ROW.items() if k != "computed_at"}


@pytest.mark.api
class TestDailyReportProgressRouter:
    @pytest.fixture
    def mock_client(self):
        return MagicMock()

    @pytest.fixture(autouse=True)
    def override_dependency(self, mock_client):
        app.dependency_overrides[get_current_tenant_id] = lambda: TENANT
        app.dependency_overrides[get_supabase_client] = lambda: mock_client
        yield
        app.dependency_overrides = {}

    def test_order_progress_list(self, mock_client):
        with (
            patch(
                f"{DAILY_REPORTS_ROUTER}.fetch_order_progress",
                return_value=[PROGRESS_ROW],
            ) as fetch,
            patch(
                f"{DAILY_REPORTS_ROUTER}.fetch_last_computed_at",
                return_value=COMPUTED_AT,
            ),
        ):
            response = client.get(
                "/daily-reports/order-progress?order_id=1000001&order_id=1000002"
            )

        assert response.status_code == 200
        assert response.json() == {
            "computed_at": "2026-10-01T03:00:00Z",
            "items": [PROGRESS_RESPONSE],
        }
        fetch.assert_called_once_with(mock_client, TENANT, [1000001, 1000002])

    def test_order_progress_list_without_filter_returns_all(self, mock_client):
        with (
            patch(
                f"{DAILY_REPORTS_ROUTER}.fetch_order_progress", return_value=[]
            ) as fetch,
            patch(f"{DAILY_REPORTS_ROUTER}.fetch_last_computed_at", return_value=None),
        ):
            response = client.get("/daily-reports/order-progress")

        assert response.status_code == 200
        assert response.json() == {"computed_at": None, "items": []}
        fetch.assert_called_once_with(mock_client, TENANT, None)

    def test_order_progress_list_rejects_too_many_order_ids(self):
        query = "&".join(f"order_id={i}" for i in range(501))
        response = client.get(f"/daily-reports/order-progress?{query}")
        assert response.status_code == 422

    def test_unallocated_actuals(self, mock_client):
        item = {
            "id": 1,
            "entry_id": 10,
            "product_id": 100,
            "customer_id": None,
            "process_name": "プレス",
            "work_date": "2026-09-01",
            "qty": 30,
            "reason": "before_order_date",
            "computed_at": COMPUTED_AT,
            "sheet_name": "2609製造",
            "row_no": 5,
            "customer_raw": None,
            "product_raw": "ピン",
            "process_raw": "プレス",
        }
        with patch(
            f"{DAILY_REPORTS_ROUTER}.fetch_unallocated_actuals", return_value=[item]
        ) as fetch:
            response = client.get("/daily-reports/unallocated-actuals")

        assert response.status_code == 200
        assert response.json() == [
            {k: v for k, v in item.items() if k != "computed_at"}
        ]
        fetch.assert_called_once_with(mock_client, TENANT)

    # --- GET /orders/{order_id}/progress -----------------------------------

    def _order_exists(self, mock_client, exists: bool):
        query = mock_client.table.return_value.select.return_value
        query.eq.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
            data=[{"id": 1000001}] if exists else []
        )
        return query

    def test_single_order_progress(self, mock_client):
        query = self._order_exists(mock_client, True)
        with (
            patch(
                f"{ORDERS_ROUTER}.fetch_order_progress", return_value=[PROGRESS_ROW]
            ) as fetch,
            patch(f"{ORDERS_ROUTER}.fetch_last_computed_at", return_value=COMPUTED_AT),
        ):
            response = client.get("/orders/1000001/progress")

        assert response.status_code == 200
        assert response.json() == {
            "order_id": 1000001,
            "computed_at": "2026-10-01T03:00:00Z",
            "processes": [PROGRESS_RESPONSE],
        }
        mock_client.table.assert_called_with("orders")
        query.eq.assert_called_once_with("tenant_id", TENANT)
        query.eq.return_value.eq.assert_called_once_with("id", 1000001)
        fetch.assert_called_once_with(mock_client, TENANT, [1000001])

    def test_single_order_progress_returns_404_for_unknown_order(self, mock_client):
        self._order_exists(mock_client, False)
        with patch(f"{ORDERS_ROUTER}.fetch_order_progress") as fetch:
            response = client.get("/orders/999/progress")

        assert response.status_code == 404
        fetch.assert_not_called()
