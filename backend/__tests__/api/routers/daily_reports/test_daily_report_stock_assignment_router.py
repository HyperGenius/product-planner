"""日報の作り置きを受注へ手で引き当てる API のテスト (Issue #624)。"""

from collections import defaultdict
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_supabase_client,
)
from app.main import app
from app.routers.daily_reports.stock_assignments import summarize_candidates
from app.utils.calendar import JST
from fastapi.testclient import TestClient

client = TestClient(app)

ROUTER = "app.routers.daily_reports.stock_assignments"
ROLE = "app.routers.daily_reports.name_matching.get_current_user_role"
TENANT = "tenant-1"
USER = "user-1"
COMPUTED_AT = "2026-11-02T03:00:00Z"
ASSIGNMENT_ID = "6f1c4c52-1d2e-4f8e-9d55-0a4f3c2b1a90"
PROCESS_NAMES = ["プレス", "カシメ", "クグシ", "検査"]

ORDER = {
    "id": 1,
    "product_id": 100,
    "quantity": 5000,
    "status": "in_progress",
    "order_type": "production",
}

ASSIGNMENT_ROW = {
    "id": ASSIGNMENT_ID,
    "order_id": 1,
    "process_name": "クグシ",
    "qty": 5000,
    "assigned_on": "2026-11-02",
    "note": None,
    "updated_by": USER,
    "updated_at": "2026-11-02T01:00:00+00:00",
}


def _tables(mock_client: MagicMock) -> defaultdict[str, MagicMock]:
    tables: defaultdict[str, MagicMock] = defaultdict(MagicMock)
    mock_client.table.side_effect = lambda name: tables[name]
    return tables


SOURCE = {
    "entry_id": 11,
    "work_date": "2026-10-20",
    "product_raw": "ボルトM6 (作り置き)",
    "customer_raw": "A社",
    "equipment_raw": "50t 3号機",
    "qty": 3000,
}


@pytest.mark.api
class TestDailyReportStockAssignmentRouter:
    @pytest.fixture
    def mock_client(self):
        return MagicMock()

    @pytest.fixture
    def role(self):
        return {"value": "order_handler"}

    @pytest.fixture(autouse=True)
    def override_dependency(self, mock_client, role):
        app.dependency_overrides[get_current_tenant_id] = lambda: TENANT
        app.dependency_overrides[get_current_user_id] = lambda: USER
        app.dependency_overrides[get_supabase_client] = lambda: mock_client
        with (
            patch(ROLE, side_effect=lambda *_: role["value"]),
            patch(f"{ROUTER}._process_names", return_value=PROCESS_NAMES),
        ):
            yield
        app.dependency_overrides = {}

    # --- 参照 -----------------------------------------------------------------

    def test_get_returns_processes_estimates_and_assignments(self, mock_client):
        tables = _tables(mock_client)
        tables[
            "daily_report_stock_estimates"
        ].select.return_value.eq.return_value.eq.return_value.execute.return_value = (
            MagicMock(
                data=[
                    {
                        "process_name": "クグシ",
                        "next_process_name": None,
                        "qty": 8222,
                        "last_movement_date": "2026-10-14",
                    },
                    {
                        "process_name": "カシメ",
                        "next_process_name": "クグシ",
                        "qty": 28,
                        "last_movement_date": "2026-10-13",
                    },
                ]
            )
        )
        with (
            patch(f"{ROUTER}._load_order", return_value=ORDER),
            patch(f"{ROUTER}._load_assignments", return_value=[ASSIGNMENT_ROW]),
            patch(f"{ROUTER}._load_sources", return_value={"クグシ": [SOURCE]}),
            patch(
                f"{ROUTER}._load_candidates",
                return_value=(
                    {"カシメ": [SOURCE]},
                    {"カシメ": {"count": 45, "qty": 9000}},
                ),
            ),
            patch(
                f"{ROUTER}._load_product",
                return_value={"name": "ボルトM6", "code": "B-06"},
            ),
            patch(f"{ROUTER}.fetch_last_computed_at", return_value=COMPUTED_AT),
        ):
            response = client.get("/daily-reports/orders/1/stock-assignments")

        assert response.status_code == 200
        body = response.json()
        assert body["assignable"] is True
        # 引き当て先（マスタ）と引き当て元（日報の表記）が見分けられる
        assert body["product_name"] == "ボルトM6"
        assert (
            body["assignments"][0]["sources"][0]["product_raw"] == "ボルトM6 (作り置き)"
        )
        assert body["candidates"]["カシメ"][0]["entry_id"] == 11
        assert body["candidate_totals"] == {"カシメ": {"count": 45, "qty": 9000}}
        assert body["process_names"] == PROCESS_NAMES
        # 工程ルートの順
        assert [e["process_name"] for e in body["stock_estimates"]] == [
            "カシメ",
            "クグシ",
        ]
        assert body["assignments"][0]["id"] == ASSIGNMENT_ID
        assert body["computed_at"].startswith("2026-11-02T03:00:00")

    @pytest.mark.parametrize(
        "order",
        [
            {**ORDER, "status": "draft"},
            {**ORDER, "status": "shipped"},
            {**ORDER, "order_type": "repair", "product_id": None, "quantity": None},
        ],
    )
    def test_get_marks_non_candidate_order_as_not_assignable(self, order):
        with (
            patch(f"{ROUTER}._load_order", return_value=order),
            patch(f"{ROUTER}._load_assignments", return_value=[]),
            patch(f"{ROUTER}._load_candidates", return_value=({}, {})),
            patch(f"{ROUTER}._load_product", return_value={}),
            patch(f"{ROUTER}.fetch_last_computed_at", return_value=None),
        ):
            response = client.get("/daily-reports/orders/1/stock-assignments")

        assert response.status_code == 200
        assert response.json()["assignable"] is False

    def test_get_unknown_order_is_404(self, mock_client):
        tables = _tables(mock_client)
        tables[
            "orders"
        ].select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
            data=[]
        )

        response = client.get("/daily-reports/orders/999/stock-assignments")

        assert response.status_code == 404

    def test_load_candidates_totals_cover_rows_beyond_the_listed_ones(
        self, mock_client
    ):
        # クグシは31件（明細は30件に打ち切るが合計は31件分）、カシメは1件
        rows = [
            {
                "id": 100 - i,
                "entry_id": 100 - i,
                "process_name": "クグシ",
                "work_date": "2026-10-20",
                "qty": 10,
            }
            for i in range(31)
        ] + [
            {
                "id": 1,
                "entry_id": 1,
                "customer_id": 5,
                "process_name": "カシメ",
                "work_date": "2026-10-01",
                "qty": 7,
            }
        ]
        with (
            patch(f"{ROUTER}._load_order", return_value=ORDER),
            patch(f"{ROUTER}.fetch_all_rows", return_value=rows),
            patch(f"{ROUTER}._load_entries", return_value={}),
            patch(f"{ROUTER}._load_assignments", return_value=[]),
            patch(f"{ROUTER}._load_product", return_value={}),
            patch(f"{ROUTER}.fetch_last_computed_at", return_value=COMPUTED_AT),
        ):
            response = client.get("/daily-reports/orders/1/stock-assignments")

        assert response.status_code == 200
        body = response.json()
        assert len(body["candidates"]["クグシ"]) == 30
        # 日報の顧客先を照合した顧客（受注の顧客との違いを画面で注意する。Issue #673）
        assert body["candidates"]["カシメ"][0]["customer_id"] == 5
        assert body["candidates"]["クグシ"][0]["customer_id"] is None
        assert body["candidate_totals"] == {
            "クグシ": {"count": 31, "qty": 310},
            "カシメ": {"count": 1, "qty": 7},
        }

    def test_get_without_product_returns_empty_totals(self):
        with (
            patch(
                f"{ROUTER}._load_order",
                return_value={**ORDER, "product_id": None},
            ),
            patch(f"{ROUTER}._load_assignments", return_value=[]),
            patch(f"{ROUTER}.fetch_last_computed_at", return_value=None),
        ):
            response = client.get("/daily-reports/orders/1/stock-assignments")

        assert response.status_code == 200
        assert response.json()["candidate_totals"] == {}

    # --- 登録 -----------------------------------------------------------------

    def test_put_upserts_with_today_as_assigned_on(self, mock_client):
        tables = _tables(mock_client)
        upsert = tables["daily_report_stock_assignments"].upsert
        upsert.return_value.execute.return_value = MagicMock(data=[ASSIGNMENT_ROW])

        with patch(f"{ROUTER}._load_order", return_value=ORDER):
            response = client.put(
                "/daily-reports/orders/1/stock-assignments",
                json={"process_name": " クグシ ", "qty": 5000, "note": " "},
            )

        assert response.status_code == 200
        assert response.json()["process_name"] == "クグシ"
        row = upsert.call_args.args[0]
        assert row["tenant_id"] == TENANT
        assert row["order_id"] == 1
        assert row["process_name"] == "クグシ"
        assert row["qty"] == 5000
        assert row["note"] is None
        assert row["updated_by"] == USER
        assert row["assigned_on"] == datetime.now(JST).date().isoformat()
        assert upsert.call_args.kwargs["on_conflict"] == "order_id,process_name"

    @pytest.mark.parametrize(
        ("order", "payload", "message"),
        [
            (
                {**ORDER, "status": "draft"},
                {"process_name": "クグシ", "qty": 10},
                "確定済み・生産中",
            ),
            (ORDER, {"process_name": "研磨", "qty": 10}, "研磨"),
            (ORDER, {"process_name": "クグシ", "qty": 5001}, "5000"),
        ],
    )
    def test_put_rejects_invalid_requests(self, mock_client, order, payload, message):
        tables = _tables(mock_client)

        with patch(f"{ROUTER}._load_order", return_value=order):
            response = client.put(
                "/daily-reports/orders/1/stock-assignments", json=payload
            )

        assert response.status_code == 422
        assert message in response.json()["detail"]
        tables["daily_report_stock_assignments"].upsert.assert_not_called()

    @pytest.mark.parametrize(
        "payload",
        [{"process_name": "クグシ", "qty": 0}, {"process_name": " ", "qty": 10}],
    )
    def test_put_validates_payload(self, payload):
        with patch(f"{ROUTER}._load_order", return_value=ORDER):
            response = client.put(
                "/daily-reports/orders/1/stock-assignments", json=payload
            )

        assert response.status_code == 422

    def test_put_requires_editor_role(self, mock_client, role):
        role["value"] = "iso_officer"
        tables = _tables(mock_client)

        response = client.put(
            "/daily-reports/orders/1/stock-assignments",
            json={"process_name": "クグシ", "qty": 10},
        )

        assert response.status_code == 403
        tables["daily_report_stock_assignments"].upsert.assert_not_called()

    # --- 取り消し -------------------------------------------------------------

    def test_delete(self, mock_client):
        tables = _tables(mock_client)
        delete = tables["daily_report_stock_assignments"].delete
        chain = delete.return_value.eq.return_value.eq.return_value.eq.return_value
        chain.execute.return_value = MagicMock(data=[ASSIGNMENT_ROW])

        response = client.delete(
            f"/daily-reports/orders/1/stock-assignments/{ASSIGNMENT_ID}"
        )

        assert response.status_code == 200
        eq_calls = [
            delete.return_value.eq.call_args,
            delete.return_value.eq.return_value.eq.call_args,
            delete.return_value.eq.return_value.eq.return_value.eq.call_args,
        ]
        assert [c.args for c in eq_calls] == [
            ("tenant_id", TENANT),
            ("order_id", 1),
            ("id", ASSIGNMENT_ID),
        ]

    def test_delete_missing_is_404(self, mock_client):
        tables = _tables(mock_client)
        delete = tables["daily_report_stock_assignments"].delete
        chain = delete.return_value.eq.return_value.eq.return_value.eq.return_value
        chain.execute.return_value = MagicMock(data=[])

        response = client.delete(
            f"/daily-reports/orders/1/stock-assignments/{ASSIGNMENT_ID}"
        )

        assert response.status_code == 404

    def test_delete_rejects_non_uuid_id(self):
        response = client.delete("/daily-reports/orders/1/stock-assignments/abc")

        assert response.status_code == 422

    def test_delete_requires_editor_role(self, mock_client, role):
        role["value"] = "iso_officer"
        tables = _tables(mock_client)

        response = client.delete(
            f"/daily-reports/orders/1/stock-assignments/{ASSIGNMENT_ID}"
        )

        assert response.status_code == 403
        tables["daily_report_stock_assignments"].delete.assert_not_called()


@pytest.mark.api
class TestSummarizeCandidates:
    def test_keeps_first_rows_per_process_and_totals_all_rows(self):
        rows = [
            {"process_name": "クグシ", "qty": 5, "entry_id": i} for i in range(32)
        ] + [{"process_name": "検査", "qty": 3, "entry_id": 99}]

        kept, totals = summarize_candidates(rows)

        assert [r["entry_id"] for r in kept if r["process_name"] == "クグシ"] == list(
            range(30)
        )
        assert [r["entry_id"] for r in kept if r["process_name"] == "検査"] == [99]
        assert totals == {
            "クグシ": {"count": 32, "qty": 160},
            "検査": {"count": 1, "qty": 3},
        }

    def test_empty(self):
        assert summarize_candidates([]) == ([], {})
