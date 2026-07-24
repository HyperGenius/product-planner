"""
Integration テスト: orders.customer_id 変更時の order_attachments 同期トリガー (Issue #315)

注文の顧客を変更しても order_attachments.customer_id が追従せず、メール取込で
自動作成された「不明な顧客」への参照が残り続けて削除できない問題を解消するため、
orders.customer_id の UPDATE と同一トランザクションで実行される DB トリガー
(sync_order_attachments_customer_id, supabase/migrations/
20260724000000_sync_order_attachments_customer_id_trigger.sql) を追加した。

トリガーは実際の UPDATE 文が発行するイベントに依存する決定的なDB挙動のため、
unit tier のモックでは検証できず integration tier (実Supabaseのみ) で検証する。
詳細な方針は __tests__/integration/CLAUDE.md を参照。

実行:
  supabase start
  cd backend && pytest __tests__/integration/test_sync_order_attachments_customer_id_trigger.py -v --run-integration
"""

from datetime import UTC, datetime, timedelta
from typing import Any, cast

import pytest

_FUTURE_DEADLINE = (datetime.now(UTC).date() + timedelta(days=60)).isoformat()
_FUTURE_DEADLINE_2 = (datetime.now(UTC).date() + timedelta(days=90)).isoformat()


@pytest.fixture()
def sync_trigger_fixture(admin_db):
    """このテスト専用の tenant / customer 2件 / product を作成し、
    テスト後に order_attachments → orders → customers/products/tenants の
    順で削除する。"""
    tenant = (
        admin_db.table("tenants")
        .insert({"name": "integration test tenant (order_attachments sync)"})
        .execute()
    )
    tenant_id = cast(list[dict[str, Any]], tenant.data)[0]["id"]

    old_customer = (
        admin_db.table("customers")
        .insert(
            {
                "tenant_id": tenant_id,
                "name": "不明な顧客 (integration test)",
                "status": "draft",
            }
        )
        .execute()
    )
    old_customer_id = cast(list[dict[str, Any]], old_customer.data)[0]["id"]

    new_customer = (
        admin_db.table("customers")
        .insert({"tenant_id": tenant_id, "name": "integration test customer"})
        .execute()
    )
    new_customer_id = cast(list[dict[str, Any]], new_customer.data)[0]["id"]

    product = (
        admin_db.table("products")
        .insert({"tenant_id": tenant_id, "name": "integration test product"})
        .execute()
    )
    product_id = cast(list[dict[str, Any]], product.data)[0]["id"]

    yield {
        "tenant_id": tenant_id,
        "old_customer_id": old_customer_id,
        "new_customer_id": new_customer_id,
        "product_id": product_id,
    }

    admin_db.table("order_attachments").delete().eq("tenant_id", tenant_id).execute()
    admin_db.table("orders").delete().eq("tenant_id", tenant_id).execute()
    admin_db.table("products").delete().eq("id", product_id).execute()
    admin_db.table("customers").delete().eq("id", old_customer_id).execute()
    admin_db.table("customers").delete().eq("id", new_customer_id).execute()
    admin_db.table("tenants").delete().eq("id", tenant_id).execute()


@pytest.mark.integration
class TestSyncOrderAttachmentsCustomerIdTrigger:
    def test_direct_attachment_row_is_synced_on_customer_change(
        self, admin_db, sync_trigger_fixture
    ):
        """order_id が設定済みの実添付行は、注文の顧客変更に合わせて同期される"""
        f = sync_trigger_fixture
        order = (
            admin_db.table("orders")
            .insert(
                {
                    "tenant_id": f["tenant_id"],
                    "customer_id": f["old_customer_id"],
                    "product_id": f["product_id"],
                    "quantity": 10,
                    "deadline_date": _FUTURE_DEADLINE,
                    "status": "draft",
                }
            )
            .execute()
        )
        order_id = cast(list[dict[str, Any]], order.data)[0]["id"]

        attachment = (
            admin_db.table("order_attachments")
            .insert(
                {
                    "order_id": order_id,
                    "tenant_id": f["tenant_id"],
                    "customer_id": f["old_customer_id"],
                    "storage_path": "",
                    "original_filename": "test.pdf",
                    "parse_status": "success",
                }
            )
            .execute()
        )
        attachment_id = cast(list[dict[str, Any]], attachment.data)[0]["id"]

        admin_db.table("orders").update({"customer_id": f["new_customer_id"]}).eq(
            "id", order_id
        ).execute()

        synced = (
            admin_db.table("order_attachments")
            .select("customer_id")
            .eq("id", attachment_id)
            .single()
            .execute()
            .data
        )
        assert synced["customer_id"] == f["new_customer_id"]

    def test_staging_row_is_synced_when_single_order_changes(
        self, admin_db, sync_trigger_fixture
    ):
        """1ソース:1受注の場合、ステージング行 (order_id IS NULL) も同期される"""
        f = sync_trigger_fixture
        staging = (
            admin_db.table("order_attachments")
            .insert(
                {
                    "order_id": None,
                    "tenant_id": f["tenant_id"],
                    "customer_id": f["old_customer_id"],
                    "storage_path": "",
                    "original_filename": "",
                    "parse_status": "success",
                }
            )
            .execute()
        )
        staging_id = cast(list[dict[str, Any]], staging.data)[0]["id"]

        order = (
            admin_db.table("orders")
            .insert(
                {
                    "tenant_id": f["tenant_id"],
                    "customer_id": f["old_customer_id"],
                    "product_id": f["product_id"],
                    "quantity": 10,
                    "deadline_date": _FUTURE_DEADLINE,
                    "status": "draft",
                    "source_attachment_id": staging_id,
                }
            )
            .execute()
        )
        order_id = cast(list[dict[str, Any]], order.data)[0]["id"]

        admin_db.table("orders").update({"customer_id": f["new_customer_id"]}).eq(
            "id", order_id
        ).execute()

        synced = (
            admin_db.table("order_attachments")
            .select("customer_id")
            .eq("id", staging_id)
            .single()
            .execute()
            .data
        )
        assert synced["customer_id"] == f["new_customer_id"]

    def test_staging_row_is_not_synced_when_sibling_orders_disagree(
        self, admin_db, sync_trigger_fixture
    ):
        """1ソース:N受注で、他の注文がまだ違う顧客の場合はステージング行を
        更新しない（どちらに合わせるべきか判断できないため）"""
        f = sync_trigger_fixture
        staging = (
            admin_db.table("order_attachments")
            .insert(
                {
                    "order_id": None,
                    "tenant_id": f["tenant_id"],
                    "customer_id": f["old_customer_id"],
                    "storage_path": "",
                    "original_filename": "",
                    "parse_status": "success",
                }
            )
            .execute()
        )
        staging_id = cast(list[dict[str, Any]], staging.data)[0]["id"]

        order_a = (
            admin_db.table("orders")
            .insert(
                {
                    "tenant_id": f["tenant_id"],
                    "customer_id": f["old_customer_id"],
                    "product_id": f["product_id"],
                    "quantity": 10,
                    "deadline_date": _FUTURE_DEADLINE,
                    "status": "draft",
                    "source_attachment_id": staging_id,
                }
            )
            .execute()
        )
        order_a_id = cast(list[dict[str, Any]], order_a.data)[0]["id"]

        admin_db.table("orders").insert(
            {
                "tenant_id": f["tenant_id"],
                "customer_id": f["old_customer_id"],
                "product_id": f["product_id"],
                "quantity": 20,
                "deadline_date": _FUTURE_DEADLINE_2,
                "status": "draft",
                "source_attachment_id": staging_id,
            }
        ).execute()

        admin_db.table("orders").update({"customer_id": f["new_customer_id"]}).eq(
            "id", order_a_id
        ).execute()

        synced = (
            admin_db.table("order_attachments")
            .select("customer_id")
            .eq("id", staging_id)
            .single()
            .execute()
            .data
        )
        assert synced["customer_id"] == f["old_customer_id"]
