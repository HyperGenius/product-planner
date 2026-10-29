"""日報からの作り置きの推定・指摘 API のテスト (Issue #591)。"""

from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest
from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_supabase_client,
)
from app.main import app
from app.utils.calendar import JST
from fastapi.testclient import TestClient

client = TestClient(app)

ROUTER = "app.routers.daily_reports.stock"
ROLE = "app.routers.daily_reports.name_matching.get_current_user_role"
TENANT = "tenant-1"
USER = "user-1"
COMPUTED_AT = "2026-10-29T03:00:00Z"
PRODUCTS = {100: {"id": 100, "name": "ピン", "code": "P-1"}}


def _tables(mock_client: MagicMock) -> dict[str, MagicMock]:
    tables: dict[str, MagicMock] = {}

    def table(name: str) -> MagicMock:
        return tables.setdefault(name, MagicMock())

    mock_client.table.side_effect = table
    return tables


def _product_exists(tables: dict[str, MagicMock], exists: bool) -> None:
    tables.setdefault(
        "products", MagicMock()
    ).select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[{"id": 100}] if exists else []
    )


def _process_exists(tables: dict[str, MagicMock], exists: bool) -> None:
    tables.setdefault(
        "process_routings", MagicMock()
    ).select.return_value.eq.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[{"id": 11}] if exists else []
    )


def _upserted(tables: dict[str, MagicMock], row: dict) -> MagicMock:
    upsert = tables.setdefault("daily_report_stock_feedback", MagicMock()).upsert
    upsert.return_value.execute.return_value = MagicMock(data=[row])
    return upsert


FEEDBACK_ROW = {
    "product_id": 100,
    "kind": "stock_process",
    "process_name": "プレス",
    "baseline_qty": 30,
    "baseline_date": "2026-10-20",
    "note": "棚に2箱",
    "updated_by": USER,
    "updated_at": "2026-10-29T01:00:00+00:00",
}


@pytest.mark.api
class TestDailyReportStockRouter:
    @pytest.fixture
    def mock_client(self):
        return MagicMock()

    @pytest.fixture(autouse=True)
    def override_dependency(self, mock_client):
        app.dependency_overrides[get_current_tenant_id] = lambda: TENANT
        app.dependency_overrides[get_current_user_id] = lambda: USER
        app.dependency_overrides[get_supabase_client] = lambda: mock_client
        with (
            patch(ROLE, return_value="order_handler"),
            patch(f"{ROUTER}._product_names", return_value=PRODUCTS),
        ):
            yield
        app.dependency_overrides = {}

    # --- 参照 -----------------------------------------------------------------

    def test_get_stock_estimates(self, mock_client):
        estimates = [
            {
                "product_id": 100,
                "process_name": "プレス",
                "next_process_name": "カシメ",
                "qty": 20,
                "last_movement_date": "2026-10-01",
            },
            {
                "product_id": 100,
                "process_name": "カシメ",
                "next_process_name": None,
                "qty": 50,
                "last_movement_date": "2026-10-02",
            },
        ]
        feedback = [
            {**FEEDBACK_ROW, "updated_at": "2026-10-01T00:00:00+00:00"},
            {
                **FEEDBACK_ROW,
                "product_id": 999,
                "kind": "not_stocked",
                "process_name": None,
                "baseline_qty": None,
                "baseline_date": None,
            },
        ]
        with (
            patch(f"{ROUTER}.fetch_all_rows", side_effect=[estimates, feedback]),
            patch(f"{ROUTER}.fetch_last_computed_at", return_value=COMPUTED_AT),
        ):
            response = client.get("/daily-reports/stock-estimates")

        assert response.status_code == 200
        body = response.json()
        assert body["computed_at"] == COMPUTED_AT
        # 推定数の多い順
        assert [(i["process_name"], i["qty"]) for i in body["items"]] == [
            ("カシメ", 50),
            ("プレス", 20),
        ]
        assert body["items"][0]["product_name"] == "ピン"
        # 指摘日時の新しい順。マスタに無い製品は名前が None
        assert [(f["product_id"], f["product_name"]) for f in body["feedback"]] == [
            (999, None),
            (100, "ピン"),
        ]

    # --- 指摘の登録 -----------------------------------------------------------

    def test_put_stock_process_with_baseline(self, mock_client):
        tables = _tables(mock_client)
        _product_exists(tables, True)
        _process_exists(tables, True)
        upsert = _upserted(tables, FEEDBACK_ROW)

        response = client.put(
            "/daily-reports/stock-feedback/100",
            json={
                "kind": "stock_process",
                "process_name": " プレス ",
                "baseline_qty": 30,
                "baseline_date": "2026-10-20",
                "note": " 棚に2箱 ",
            },
        )

        assert response.status_code == 200
        assert response.json()["product_name"] == "ピン"
        row = upsert.call_args.args[0]
        assert {k: v for k, v in row.items() if k != "updated_at"} == {
            "tenant_id": TENANT,
            "product_id": 100,
            "kind": "stock_process",
            "process_name": "プレス",
            "baseline_qty": 30,
            "baseline_date": "2026-10-20",
            "note": "棚に2箱",
            "updated_by": USER,
        }
        assert row["updated_at"]
        assert upsert.call_args.kwargs == {"on_conflict": "tenant_id,product_id"}

    def test_put_not_stocked_skips_process_check(self, mock_client):
        tables = _tables(mock_client)
        _product_exists(tables, True)
        upsert = _upserted(
            tables,
            {
                **FEEDBACK_ROW,
                "kind": "not_stocked",
                "process_name": None,
                "baseline_qty": None,
                "baseline_date": None,
            },
        )

        response = client.put(
            "/daily-reports/stock-feedback/100", json={"kind": "not_stocked"}
        )

        assert response.status_code == 200
        assert upsert.call_args.args[0]["process_name"] is None
        assert "process_routings" not in tables

    @pytest.mark.parametrize(
        "payload",
        [
            {"kind": "not_stocked", "process_name": "プレス"},
            {"kind": "not_stocked", "baseline_qty": 1, "baseline_date": "2026-10-01"},
            {"kind": "stock_process"},
            {"kind": "stock_process", "process_name": "  "},
            {"kind": "stock_process", "process_name": "プレス", "baseline_qty": 3},
            {
                "kind": "stock_process",
                "process_name": "プレス",
                "baseline_date": "2026-10-01",
            },
            {
                "kind": "stock_process",
                "process_name": "プレス",
                "baseline_qty": -1,
                "baseline_date": "2026-10-01",
            },
            {"kind": "in_stock"},
        ],
    )
    def test_put_rejects_invalid_payload(self, mock_client, payload):
        tables = _tables(mock_client)

        response = client.put("/daily-reports/stock-feedback/100", json=payload)

        assert response.status_code == 422
        assert "daily_report_stock_feedback" not in tables

    def test_put_rejects_future_baseline_date(self, mock_client):
        tables = _tables(mock_client)
        _product_exists(tables, True)
        _process_exists(tables, True)
        tomorrow = datetime.now(JST).date() + timedelta(days=1)

        response = client.put(
            "/daily-reports/stock-feedback/100",
            json={
                "kind": "stock_process",
                "process_name": "プレス",
                "baseline_qty": 3,
                "baseline_date": tomorrow.isoformat(),
            },
        )

        assert response.status_code == 422
        assert "daily_report_stock_feedback" not in tables

    def test_put_rejects_process_not_in_product_routing(self, mock_client):
        tables = _tables(mock_client)
        _product_exists(tables, True)
        _process_exists(tables, False)

        response = client.put(
            "/daily-reports/stock-feedback/100",
            json={"kind": "stock_process", "process_name": "溶接"},
        )

        assert response.status_code == 422
        assert "溶接" in response.json()["detail"]
        assert "daily_report_stock_feedback" not in tables

    def test_put_unknown_product_returns_404(self, mock_client):
        tables = _tables(mock_client)
        _product_exists(tables, False)

        response = client.put(
            "/daily-reports/stock-feedback/999", json={"kind": "not_stocked"}
        )

        assert response.status_code == 404
        assert "daily_report_stock_feedback" not in tables

    def test_put_requires_editor_role(self, mock_client):
        tables = _tables(mock_client)
        with patch(ROLE, return_value="iso_officer"):
            response = client.put(
                "/daily-reports/stock-feedback/100", json={"kind": "not_stocked"}
            )

        assert response.status_code == 403
        assert "daily_report_stock_feedback" not in tables

    # --- 指摘の取り消し -------------------------------------------------------

    def test_delete_stock_feedback(self, mock_client):
        tables = _tables(mock_client)
        delete = tables.setdefault("daily_report_stock_feedback", MagicMock()).delete
        delete.return_value.eq.return_value.eq.return_value.execute.return_value = (
            MagicMock(data=[FEEDBACK_ROW])
        )

        response = client.delete("/daily-reports/stock-feedback/100")

        assert response.status_code == 200
        delete.return_value.eq.assert_called_once_with("tenant_id", TENANT)
        delete.return_value.eq.return_value.eq.assert_called_once_with(
            "product_id", 100
        )

    def test_delete_missing_feedback_returns_404(self, mock_client):
        tables = _tables(mock_client)
        delete = tables.setdefault("daily_report_stock_feedback", MagicMock()).delete
        delete.return_value.eq.return_value.eq.return_value.execute.return_value = (
            MagicMock(data=[])
        )

        response = client.delete("/daily-reports/stock-feedback/100")

        assert response.status_code == 404

    def test_delete_requires_editor_role(self, mock_client):
        tables = _tables(mock_client)
        with patch(ROLE, return_value="iso_officer"):
            response = client.delete("/daily-reports/stock-feedback/100")

        assert response.status_code == 403
        assert "daily_report_stock_feedback" not in tables
