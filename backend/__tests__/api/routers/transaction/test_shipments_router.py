# __tests__/api/routers/transaction/test_shipments_router.py
"""弥生の売上明細の名寄せ・送品の突合 API (Issue #667)。DB はモック。値はすべて架空。"""

from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_supabase_client,
)
from app.main import app
from app.services.shipment_matcher import (
    CustomerInfo,
    OrderInfo,
    ProductInfo,
    ShipmentSnapshot,
)
from fastapi.testclient import TestClient

client = TestClient(app)

TENANT = "11111111-1111-1111-1111-111111111111"
USER = "55555555-5555-5555-5555-555555555555"
SERVICE = "app.services.shipment_matching_service"
ROUTER = "app.routers.transaction.shipments"


def _entry(**values: Any) -> dict[str, Any]:
    entry = {
        "id": 1,
        "sales_date": "2026-10-10",
        "slip_no": "10001",
        "customer_code": "001",
        "customer_name": "架空工業株式会社",
        "product_code": "X1",
        "product_name": "品A 図番123456",
        "quantity": 60,
        "unit": "個",
        "note": "10/20納期分",
    }
    entry.update(values)
    return entry


def _snapshot() -> ShipmentSnapshot:
    from datetime import date

    return ShipmentSnapshot(
        customers=[CustomerInfo(id=1, name="架空工業")],
        products=[ProductInfo(id=101, name="品A", code="123456")],
        orders=[
            OrderInfo(
                id=1001,
                customer_id=1,
                product_id=101,
                quantity=100,
                status="in_progress",
                deadline_date=date(2026, 10, 20),
            )
        ],
    )


@pytest.mark.api
class TestShipmentsRouter:
    @pytest.fixture
    def db(self):
        mock = MagicMock()
        app.dependency_overrides[get_current_tenant_id] = lambda: TENANT
        app.dependency_overrides[get_current_user_id] = lambda: USER
        app.dependency_overrides[get_supabase_client] = lambda: mock
        yield mock
        app.dependency_overrides = {}

    @pytest.fixture
    def role(self):
        with patch(
            f"{ROUTER}.get_current_user_role", return_value="order_handler"
        ) as m:
            yield m

    @pytest.fixture
    def data(self):
        entries = [
            _entry(id=1, quantity=60),
            _entry(id=2, sales_date="2026-10-15", quantity=40),
        ]
        with (
            patch(f"{SERVICE}.load_snapshot", return_value=_snapshot()),
            patch(f"{SERVICE}.fetch_entries", return_value=entries),
        ):
            yield entries

    def test_order_matches_sum_partial_shipments(self, db, data):
        response = client.get("/shipments/order-matches?order_id=1001")

        assert response.status_code == 200
        body = response.json()
        assert body["latest_sales_date"] == "2026-10-15"
        [item] = body["items"]
        assert item["order_id"] == 1001
        assert item["shipped_qty"] == 100
        assert item["is_fully_shipped"] is True
        assert item["last_sales_date"] == "2026-10-15"
        assert [e["method"] for e in item["entries"]] == ["deadline", "deadline"]

    def test_order_matches_filters_by_order_id(self, db, data):
        response = client.get("/shipments/order-matches?order_id=999")

        assert response.json()["items"] == []

    def test_order_matches_never_updates_orders(self, db, data):
        client.get("/shipments/order-matches")

        db.table.return_value.update.assert_not_called()

    def test_unmatched_entries(self, db):
        entries = [
            _entry(id=1),  # 受注 1001 に当たる → 出さない
            _entry(id=2, sales_date="2026-10-12", note="12/1納期分", quantity=30),
            _entry(id=3, sales_date="2026-10-14", product_code="Z9", product_name="?"),
            # 期間外（最新の売上日 10/14 から 60 日より前）
            _entry(id=4, sales_date="2026-07-01", note="12/1納期分"),
        ]
        with (
            patch(f"{SERVICE}.load_snapshot", return_value=_snapshot()),
            patch(f"{SERVICE}.fetch_entries", return_value=entries),
        ):
            response = client.get("/shipments/unmatched-entries")

        assert response.status_code == 200
        body = response.json()
        assert body["latest_sales_date"] == "2026-10-14"
        assert body["since"] == "2026-08-16"
        assert body["counts"] == {
            "unmatched_customer": 0,
            "unmatched_product": 1,
            "no_order": 1,
            "ambiguous": 0,
        }
        assert body["truncated"] is False
        product, no_order = body["items"]
        assert (product["status"], product["product_code"]) == (
            "unmatched_product",
            "Z9",
        )
        assert product["customer_ids"] == [1]
        assert no_order["status"] == "no_order"
        assert no_order["entry_count"] == 1
        assert no_order["total_qty"] == 30
        assert no_order["product_ids"] == [101]
        assert no_order["note_deadlines"] == ["2026-12-01"]
        db.table.return_value.update.assert_not_called()
        db.table.return_value.insert.assert_not_called()

    def test_unmatched_entries_limit_per_status(self, db):
        entries = [
            _entry(id=i, product_code=f"P{i}", note="12/1納期分") for i in range(3)
        ]
        with (
            patch(f"{SERVICE}.load_snapshot", return_value=_snapshot()),
            patch(f"{SERVICE}.fetch_entries", return_value=entries),
        ):
            response = client.get("/shipments/unmatched-entries?limit=2&days=7")

        body = response.json()
        assert body["counts"]["no_order"] == 3
        assert body["truncated"] is True
        assert len(body["items"]) == 2

    def test_unmatched_entries_without_entries(self, db):
        with (
            patch(f"{SERVICE}.load_snapshot", return_value=_snapshot()),
            patch(f"{SERVICE}.fetch_entries", return_value=[]),
        ):
            response = client.get("/shipments/unmatched-entries")

        body = response.json()
        assert (body["latest_sales_date"], body["since"], body["items"]) == (
            None,
            None,
            [],
        )

    @pytest.mark.parametrize("query", ["days=0", "days=400", "limit=0", "limit=5000"])
    def test_unmatched_entries_rejects_out_of_range(self, db, query):
        response = client.get(f"/shipments/unmatched-entries?{query}")

        assert response.status_code == 422

    def test_customer_items(self, db, data):
        with patch(f"{SERVICE}._select_all", return_value=[]):
            response = client.get("/shipments/customers")

        assert response.status_code == 200
        [item] = response.json()
        assert item["code_key"] == "001"
        assert item["auto_customer_id"] == 1
        assert item["entry_count"] == 2

    def test_product_items(self, db, data):
        with patch(f"{SERVICE}._select_all", return_value=[]):
            response = client.get("/shipments/products")

        [item] = response.json()
        assert item["auto_product_id"] == 101
        assert item["auto_method"] == "drawing_no"
        assert item["link"] is None

    def test_create_customer_link_normalizes_code(self, db, role):
        db.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
            {"id": 2}
        ]
        db.table.return_value.insert.return_value.execute.return_value.data = [
            {"id": "link-1", "customer_code": "AB01", "customer_id": 2}
        ]

        response = client.post(
            "/shipments/customer-links",
            json={"customer_code": " ａｂ01 ", "customer_id": 2},
        )

        assert response.status_code == 201
        row = db.table.return_value.insert.call_args.args[0]
        assert row == {
            "tenant_id": TENANT,
            "customer_code": "AB01",
            "customer_id": 2,
            "created_by": USER,
        }

    def test_customer_link_requires_existing_customer(self, db, role):
        db.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = []

        response = client.post(
            "/shipments/customer-links", json={"customer_code": "001", "customer_id": 9}
        )

        assert response.status_code == 422
        db.table.return_value.insert.assert_not_called()

    def test_editor_role_is_required(self, db):
        with patch(f"{ROUTER}.get_current_user_role", return_value="iso_officer"):
            response = client.post(
                "/shipments/ignored", json={"kind": "customer", "customer_code": "001"}
            )

        assert response.status_code == 403

    def test_upsert_product_link_updates_existing(self, db, role):
        select = db.table.return_value.select.return_value
        select.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
            {"id": 101}
        ]
        select.eq.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
            {"id": "link-1"}
        ]
        db.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
            {"id": "link-1", "product_id": 101}
        ]

        response = client.put(
            "/shipments/product-links",
            json={"customer_code": "001", "product_code": "x1", "product_id": 101},
        )

        assert response.status_code == 200
        update = db.table.return_value.update.call_args.args[0]
        assert update["product_id"] == 101
        db.table.return_value.insert.assert_not_called()

    def test_ignored_product_requires_product_code(self, db, role):
        response = client.post(
            "/shipments/ignored", json={"kind": "product", "customer_code": "001"}
        )

        assert response.status_code == 422

    def test_create_ignored_product(self, db, role):
        db.table.return_value.insert.return_value.execute.return_value.data = [
            {"id": "ig-1"}
        ]

        response = client.post(
            "/shipments/ignored",
            json={"kind": "product", "customer_code": "001", "product_code": "souryou"},
        )

        assert response.status_code == 201
        row = db.table.return_value.insert.call_args.args[0]
        assert row["product_code"] == "SOURYOU"
        assert row["kind"] == "product"

    def test_delete_missing_row_is_404(self, db, role):
        db.table.return_value.delete.return_value.eq.return_value.eq.return_value.execute.return_value.data = []

        response = client.delete("/shipments/customer-links/xyz")

        assert response.status_code == 404


@pytest.mark.api
class TestShipmentOrderReviews:
    """弥生で送品済みなのに日報の進捗が追いついていない受注 (Issue #683)。"""

    @pytest.fixture
    def db(self):
        mock = MagicMock()
        app.dependency_overrides[get_current_tenant_id] = lambda: TENANT
        app.dependency_overrides[get_supabase_client] = lambda: mock
        yield mock
        app.dependency_overrides = {}

    def _get(self, *, routings, progress, unallocated=()):
        entries = [_entry(id=1, quantity=60), _entry(id=2, quantity=40)]
        with (
            patch(f"{SERVICE}.load_snapshot", return_value=_snapshot()),
            patch(f"{SERVICE}.fetch_entries", return_value=entries),
            patch(f"{SERVICE}.load_routings", return_value=list(routings)),
            patch(f"{SERVICE}.load_untracked_process_names", return_value=frozenset()),
            patch(f"{SERVICE}.fetch_progress_good_qty", return_value=progress),
            patch(
                f"{SERVICE}.fetch_review_unallocated", return_value=list(unallocated)
            ),
            patch(
                f"{SERVICE}.fetch_last_computed_at",
                return_value="2026-10-21T00:00:00+00:00",
            ),
        ):
            return client.get("/shipments/order-reviews")

    def test_review_disappears_after_master_fixed_and_recomputed(self, db):
        from app.services.daily_report_allocator import RoutingRef
        from app.services.shipment_review import ReviewUnallocated

        # 工程が無い製品 → 工程なし
        response = self._get(routings=[], progress={})
        assert response.status_code == 200
        body = response.json()
        assert body["computed_at"] == "2026-10-21T00:00:00+00:00"
        assert body["counts"] == {
            "no_routing": 1,
            "process_mismatch": 0,
            "customer_or_stock": 0,
            "missing_report": 0,
        }
        [item] = body["items"]
        assert item == {
            "order_id": 1001,
            "product_id": 101,
            "cause": "no_routing",
            "shipped_qty": 100,
            "last_sales_date": "2026-10-10",
            "final_process_name": None,
            "final_good_qty": 0,
            "unallocated_qty": 0,
            "process_names": [],
        }

        # 工程を登録したが、日報の工程名が合わず未割当に残っている → 工程名が日報と合わない
        routings = [
            RoutingRef(id=11, product_id=101, sequence_order=1, process_name="プレス")
        ]
        unallocated = [
            ReviewUnallocated(
                product_id=101,
                process_name="ﾌﾟﾚｽ加工",
                reason="no_routing_process",
                work_date=None,
                qty=100,
            )
        ]
        [item] = self._get(
            routings=routings, progress={}, unallocated=unallocated
        ).json()["items"]
        assert item["cause"] == "process_mismatch"
        assert item["process_names"] == ["ﾌﾟﾚｽ加工"]
        assert item["final_process_name"] == "プレス"

        # 名寄せを直して再計算した → 最後の工程の良品数が送品数に届き、要確認から消える
        body = self._get(routings=routings, progress={(1001, 11): 100}).json()
        assert body["items"] == []
        assert sum(body["counts"].values()) == 0

    def test_never_updates_orders(self, db):
        self._get(routings=[], progress={})

        db.table.return_value.update.assert_not_called()
