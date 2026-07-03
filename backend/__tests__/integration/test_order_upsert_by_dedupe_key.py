"""
Integration テスト: 既存orderのupsert処理 (Issue #252)

`upsert_order_by_dedupe_key` RPC のステータス優先順位判定・数量更新・
draft/canceledの上書き除外は Claude API・Gmail APIの出力に依存しない
決定的なSQLロジックのため、e2e (実PDF・実Claude API) ではなく
integration tier (実Supabaseのみ) で検証する。
詳細な方針は __tests__/e2e/CLAUDE.md, __tests__/integration/CLAUDE.md を参照。

実行:
  supabase start
  cd backend && pytest __tests__/integration/test_order_upsert_by_dedupe_key.py -v --run-integration
"""

from datetime import UTC, datetime, timedelta
from typing import Any, cast

import pytest

_FUTURE_DEADLINE = (datetime.now(UTC).date() + timedelta(days=60)).isoformat()
_FUTURE_DEADLINE_2 = (datetime.now(UTC).date() + timedelta(days=90)).isoformat()


def _upsert(
    admin_db,
    tenant_id: str,
    customer_id: int,
    product_id: int,
    quantity: int,
    deadline_date: str,
    status: str,
) -> dict[str, Any]:
    result = admin_db.rpc(
        "upsert_order_by_dedupe_key",
        {
            "p_tenant_id": tenant_id,
            "p_customer_id": customer_id,
            "p_product_id": product_id,
            "p_quantity": quantity,
            "p_deadline_date": deadline_date,
            "p_status": status,
            "p_source_type": "email",
            "p_source_raw": "integration-test upsert_order_by_dedupe_key",
            "p_extracted_product_name": "integration test product",
        },
    ).execute()
    rows = cast(list[dict[str, Any]], result.data or [])
    assert len(rows) == 1
    return rows[0]


@pytest.fixture()
def dedupe_fixture(admin_db):
    """
    このテスト専用の tenant / customer / product を作成し、
    テスト後に orders → customers/products/tenants の順で削除する。
    """
    tenant = (
        admin_db.table("tenants")
        .insert({"name": "E2E upsert_order_by_dedupe_key test tenant"})
        .execute()
    )
    tenant_id = cast(list[dict[str, Any]], tenant.data)[0]["id"]

    customer = (
        admin_db.table("customers")
        .insert({"tenant_id": tenant_id, "name": "integration test customer"})
        .execute()
    )
    customer_id = cast(list[dict[str, Any]], customer.data)[0]["id"]

    product = (
        admin_db.table("products")
        .insert({"tenant_id": tenant_id, "name": "integration test product"})
        .execute()
    )
    product_id = cast(list[dict[str, Any]], product.data)[0]["id"]

    yield {
        "tenant_id": tenant_id,
        "customer_id": customer_id,
        "product_id": product_id,
    }

    admin_db.table("orders").delete().eq("tenant_id", tenant_id).execute()
    admin_db.table("products").delete().eq("id", product_id).execute()
    admin_db.table("customers").delete().eq("id", customer_id).execute()
    admin_db.table("tenants").delete().eq("id", tenant_id).execute()


@pytest.mark.integration
class TestUpsertOrderByDedupeKey:
    def test_inserts_new_order_when_no_existing_match(self, admin_db, dedupe_fixture):
        result = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            status="forecast",
        )

        assert result["action"] == "inserted"

        order = (
            admin_db.table("orders")
            .select("status, quantity")
            .eq("id", result["order_id"])
            .single()
            .execute()
            .data
        )
        assert order["status"] == "forecast"
        assert order["quantity"] == 10

    def test_forecast_is_upgraded_to_confirmed(self, admin_db, dedupe_fixture):
        first = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            status="forecast",
        )

        second = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            status="confirmed",
        )

        assert second["action"] == "updated"
        assert second["order_id"] == first["order_id"]

        order = (
            admin_db.table("orders")
            .select("status")
            .eq("id", first["order_id"])
            .single()
            .execute()
            .data
        )
        assert order["status"] == "confirmed"

    def test_quantity_only_change_updates_existing_order(
        self, admin_db, dedupe_fixture
    ):
        first = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            status="forecast",
        )

        second = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=25,
            deadline_date=_FUTURE_DEADLINE,
            status="forecast",
        )

        assert second["action"] == "updated"

        order = (
            admin_db.table("orders")
            .select("status, quantity")
            .eq("id", first["order_id"])
            .single()
            .execute()
            .data
        )
        assert order["status"] == "forecast"
        assert order["quantity"] == 25

    def test_confirmed_existing_rejects_forecast_downgrade(
        self, admin_db, dedupe_fixture
    ):
        first = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            status="confirmed",
        )

        second = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=999,
            deadline_date=_FUTURE_DEADLINE,
            status="forecast",
        )

        assert second["action"] == "skipped_downgrade"
        assert second["order_id"] == first["order_id"]

        order = (
            admin_db.table("orders")
            .select("status, quantity")
            .eq("id", first["order_id"])
            .single()
            .execute()
            .data
        )
        assert order["status"] == "confirmed"
        assert order["quantity"] == 10

    def test_completed_existing_rejects_same_priority_quantity_change(
        self, admin_db, dedupe_fixture
    ):
        first = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            status="completed",
        )

        # completed 同士でも数量差分だけでは上書きしない
        second = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=999,
            deadline_date=_FUTURE_DEADLINE,
            status="completed",
        )

        assert second["action"] == "skipped_downgrade"

        order = (
            admin_db.table("orders")
            .select("status, quantity")
            .eq("id", first["order_id"])
            .single()
            .execute()
            .data
        )
        assert order["status"] == "completed"
        assert order["quantity"] == 10

    def test_canceled_existing_rejects_any_update(self, admin_db, dedupe_fixture):
        first = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            status="forecast",
        )
        admin_db.table("orders").update({"status": "canceled"}).eq(
            "id", first["order_id"]
        ).execute()

        second = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=999,
            deadline_date=_FUTURE_DEADLINE,
            status="confirmed",
        )

        assert second["action"] == "skipped_downgrade"

        order = (
            admin_db.table("orders")
            .select("status, quantity")
            .eq("id", first["order_id"])
            .single()
            .execute()
            .data
        )
        assert order["status"] == "canceled"
        assert order["quantity"] == 10

    def test_draft_existing_always_conflicts(self, admin_db, dedupe_fixture):
        first = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            status="forecast",
        )
        admin_db.table("orders").update({"status": "draft"}).eq(
            "id", first["order_id"]
        ).execute()

        # draft は昇格方向 (forecast -> confirmed) の更新でも常にコンフリクト扱い
        second = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=999,
            deadline_date=_FUTURE_DEADLINE,
            status="confirmed",
        )

        assert second["action"] == "skipped_draft_conflict"

        order = (
            admin_db.table("orders")
            .select("status, quantity")
            .eq("id", first["order_id"])
            .single()
            .execute()
            .data
        )
        assert order["status"] == "draft"
        assert order["quantity"] == 10

    def test_exact_duplicate_is_skipped_without_change(self, admin_db, dedupe_fixture):
        first = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            status="forecast",
        )

        second = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            status="forecast",
        )

        assert second["action"] == "skipped_no_change"
        assert second["order_id"] == first["order_id"]

    def test_different_deadline_date_creates_separate_order(
        self, admin_db, dedupe_fixture
    ):
        """deadline_dateがdedupeキーの一部であるため、日付が異なれば別レコード扱い。"""
        first = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            status="forecast",
        )
        second = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE_2,
            status="forecast",
        )

        assert second["action"] == "inserted"
        assert second["order_id"] != first["order_id"]


@pytest.mark.integration
class TestMarkSupersededOrders:
    """
    _mark_superseded_orders はPDFパースサービス内のPython関数だが、実DBに対する
    UPDATEクエリチェーンの組み合わせ (.eq/.neq/.gt/.in_/.is_) が意図通りかは
    実DBでの検証が必要なため integration tier に置く。
    """

    def test_older_future_forecast_is_superseded_when_deadline_moves(
        self, admin_db, dedupe_fixture
    ):
        from app.services.pdf_order_parsing_service import _mark_superseded_orders

        old = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            status="forecast",
        )

        _mark_superseded_orders(
            admin_db,
            dedupe_fixture["tenant_id"],
            {"customer_id": dedupe_fixture["customer_id"]},
            dedupe_fixture["product_id"],
            _FUTURE_DEADLINE_2,
        )

        order = (
            admin_db.table("orders")
            .select("superseded_at")
            .eq("id", old["order_id"])
            .single()
            .execute()
            .data
        )
        assert order["superseded_at"] is not None

    def test_confirmed_order_is_not_superseded(self, admin_db, dedupe_fixture):
        from app.services.pdf_order_parsing_service import _mark_superseded_orders

        confirmed = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            status="confirmed",
        )

        _mark_superseded_orders(
            admin_db,
            dedupe_fixture["tenant_id"],
            {"customer_id": dedupe_fixture["customer_id"]},
            dedupe_fixture["product_id"],
            _FUTURE_DEADLINE_2,
        )

        order = (
            admin_db.table("orders")
            .select("superseded_at")
            .eq("id", confirmed["order_id"])
            .single()
            .execute()
            .data
        )
        assert order["superseded_at"] is None

    def test_superseded_order_is_excluded_from_order_repo_get_all(
        self, admin_db, dedupe_fixture
    ):
        from app.repositories.supa_infra.transaction.order_repo import (
            OrderRepository,
        )
        from app.services.pdf_order_parsing_service import _mark_superseded_orders

        old = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            status="forecast",
        )
        _mark_superseded_orders(
            admin_db,
            dedupe_fixture["tenant_id"],
            {"customer_id": dedupe_fixture["customer_id"]},
            dedupe_fixture["product_id"],
            _FUTURE_DEADLINE_2,
        )

        orders = OrderRepository(admin_db).get_all()
        assert not any(o["id"] == old["order_id"] for o in orders)
