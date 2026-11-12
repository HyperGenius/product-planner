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
