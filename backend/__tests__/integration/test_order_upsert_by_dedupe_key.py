"""
Integration テスト: 既存orderのupsert処理 (Issue #252, Issue #267で customer_certainty 分離)

`upsert_order_by_dedupe_key` RPC は、顧客側の確度 (`customer_certainty`:
confirmed/forecast/forecast_tentative) と ProductPlanner側のワークフロー
ステータス (`status`: draft/confirmed/completed/canceled) を分離して扱う。
INSERT時は常に status='draft' で作成し、既存行が confirmed/completed/canceled、
または手動下書き (status='draft' AND source_type='manual') の場合は自動更新
から保護する。それ以外 (メール/PDF起票の確認待ちdraft) は customer_certainty
の優先順位で upsert 判定を行う。
このロジックはClaude API・Gmail APIの出力に依存しない決定的なSQLロジックのため、
e2e (実PDF・実Claude API) ではなく integration tier (実Supabaseのみ) で検証する。
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
    certainty: str,
    customer_order_no: str | None = None,
) -> dict[str, Any]:
    params: dict[str, Any] = {
        "p_tenant_id": tenant_id,
        "p_customer_id": customer_id,
        "p_product_id": product_id,
        "p_quantity": quantity,
        "p_deadline_date": deadline_date,
        "p_customer_certainty": certainty,
        "p_source_type": "email",
        "p_source_raw": "integration-test upsert_order_by_dedupe_key",
        "p_extracted_product_name": "integration test product",
    }
    if customer_order_no is not None:
        params["p_customer_order_no"] = customer_order_no
    result = admin_db.rpc("upsert_order_by_dedupe_key", params).execute()
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
    def test_inserts_new_order_as_draft_with_customer_certainty(
        self, admin_db, dedupe_fixture
    ):
        result = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            certainty="forecast",
        )

        assert result["action"] == "inserted"

        order = (
            admin_db.table("orders")
            .select("status, customer_certainty, quantity")
            .eq("id", result["order_id"])
            .single()
            .execute()
            .data
        )
        # INSERT時は顧客側の確度に関わらず常に status='draft' で作成される
        assert order["status"] == "draft"
        assert order["customer_certainty"] == "forecast"
        assert order["quantity"] == 10

    def test_certainty_forecast_is_upgraded_to_confirmed_without_changing_status(
        self, admin_db, dedupe_fixture
    ):
        first = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            certainty="forecast",
        )

        second = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            certainty="confirmed",
        )

        assert second["action"] == "updated"
        assert second["order_id"] == first["order_id"]

        order = (
            admin_db.table("orders")
            .select("status, customer_certainty")
            .eq("id", first["order_id"])
            .single()
            .execute()
            .data
        )
        # customer_certainty は昇格するが、status はユーザーの確定操作なしに
        # 変化してはならない
        assert order["status"] == "draft"
        assert order["customer_certainty"] == "confirmed"

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
            certainty="forecast",
        )

        second = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=25,
            deadline_date=_FUTURE_DEADLINE,
            certainty="forecast",
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
        assert order["status"] == "draft"
        assert order["quantity"] == 25

    def test_confirmed_existing_rejects_any_update(self, admin_db, dedupe_fixture):
        """ユーザーが /orders/{id}/confirm で確定させた注文 (status='confirmed') は
        PDF自動処理から完全に保護され、certainty='confirmed' の再取込でも上書きされない。"""
        first = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            certainty="confirmed",
        )
        # confirm_order 相当の操作をシミュレート
        admin_db.table("orders").update(
            {"status": "confirmed", "confirmed_at": datetime.now(UTC).isoformat()}
        ).eq("id", first["order_id"]).execute()

        second = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=999,
            deadline_date=_FUTURE_DEADLINE,
            certainty="confirmed",
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
            certainty="confirmed",
        )
        admin_db.table("orders").update({"status": "completed"}).eq(
            "id", first["order_id"]
        ).execute()

        second = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=999,
            deadline_date=_FUTURE_DEADLINE,
            certainty="confirmed",
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
            certainty="forecast",
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
            certainty="confirmed",
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

    def test_manual_draft_existing_always_conflicts(self, admin_db, dedupe_fixture):
        """手動起票 (source_type='manual') の下書きは、メール/PDF自動処理からの
        上書きを一切許さない。"""
        manual_order = (
            admin_db.table("orders")
            .insert(
                {
                    "tenant_id": dedupe_fixture["tenant_id"],
                    "customer_id": dedupe_fixture["customer_id"],
                    "product_id": dedupe_fixture["product_id"],
                    "quantity": 10,
                    "deadline_date": _FUTURE_DEADLINE,
                    "status": "draft",
                    "source_type": "manual",
                }
            )
            .execute()
        )
        manual_order_id = cast(list[dict[str, Any]], manual_order.data)[0]["id"]

        second = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=999,
            deadline_date=_FUTURE_DEADLINE,
            certainty="confirmed",
        )

        assert second["action"] == "skipped_draft_conflict"
        assert second["order_id"] == manual_order_id

        order = (
            admin_db.table("orders")
            .select("status, quantity, customer_certainty")
            .eq("id", manual_order_id)
            .single()
            .execute()
            .data
        )
        assert order["status"] == "draft"
        assert order["quantity"] == 10
        assert order["customer_certainty"] is None

    def test_email_draft_without_certainty_is_upgraded(self, admin_db, dedupe_fixture):
        """本文のみのメール起票 (gmail_service.py 経由) は customer_certainty=NULL の
        draft注文として作成される。これに対する後続のPDF取込は、NULLを最も低い
        優先度として扱い、正しく確度・数量を更新できる。"""
        email_order = (
            admin_db.table("orders")
            .insert(
                {
                    "tenant_id": dedupe_fixture["tenant_id"],
                    "customer_id": dedupe_fixture["customer_id"],
                    "product_id": dedupe_fixture["product_id"],
                    "quantity": 10,
                    "deadline_date": _FUTURE_DEADLINE,
                    "status": "draft",
                    "source_type": "email",
                }
            )
            .execute()
        )
        email_order_id = cast(list[dict[str, Any]], email_order.data)[0]["id"]

        second = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=999,
            deadline_date=_FUTURE_DEADLINE,
            certainty="forecast_tentative",
        )

        assert second["action"] == "updated"
        assert second["order_id"] == email_order_id

        order = (
            admin_db.table("orders")
            .select("status, quantity, customer_certainty")
            .eq("id", email_order_id)
            .single()
            .execute()
            .data
        )
        assert order["status"] == "draft"
        assert order["quantity"] == 999
        assert order["customer_certainty"] == "forecast_tentative"

    def test_exact_duplicate_is_skipped_without_change(self, admin_db, dedupe_fixture):
        first = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            certainty="forecast",
        )

        second = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            certainty="forecast",
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
            certainty="forecast",
        )
        second = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE_2,
            certainty="forecast",
        )

        assert second["action"] == "inserted"
        assert second["order_id"] != first["order_id"]


def _upsert_unmatched(
    admin_db,
    tenant_id: str,
    customer_id: int,
    quantity: int,
    deadline_date: str | None,
    extracted_product_name: str | None,
    certainty: str = "forecast",
) -> dict[str, Any]:
    """product_id=NULL（製品未マッチ）の明細を upsert する（Issue #296）。"""
    result = admin_db.rpc(
        "upsert_order_by_dedupe_key",
        {
            "p_tenant_id": tenant_id,
            "p_customer_id": customer_id,
            "p_product_id": None,
            "p_quantity": quantity,
            "p_deadline_date": deadline_date,
            "p_customer_certainty": certainty,
            "p_source_type": "email",
            "p_source_raw": "integration-test upsert_order_by_dedupe_key (unmatched)",
            "p_extracted_product_name": extracted_product_name,
        },
    ).execute()
    rows = cast(list[dict[str, Any]], result.data or [])
    assert len(rows) == 1
    return rows[0]


@pytest.mark.integration
class TestUpsertOrderByDedupeKeyUnmatchedProduct:
    """
    product_id=NULL（製品未マッチ）の明細に対する重複排除 (Issue #296)。
    extracted_product_name を鍵にした部分UNIQUE制約
    (orders_dedupe_key_unmatched_product) 経由の重複判定を検証する。
    """

    def test_same_extracted_name_and_deadline_is_deduped(
        self, admin_db, dedupe_fixture
    ):
        first = _upsert_unmatched(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            extracted_product_name="謎の製品X",
            certainty="forecast",
        )
        second = _upsert_unmatched(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            extracted_product_name="謎の製品X",
            certainty="forecast",
        )

        assert first["action"] == "inserted"
        assert second["action"] == "skipped_no_change"
        assert second["order_id"] == first["order_id"]

    def test_leading_trailing_whitespace_is_trimmed_before_dedupe(
        self, admin_db, dedupe_fixture
    ):
        """extracted_product_name はTRIM()のみ正規化する（全角/半角統一等は対象外）。"""
        first = _upsert_unmatched(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            extracted_product_name="謎の製品Y",
            certainty="forecast",
        )
        second = _upsert_unmatched(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            extracted_product_name="  謎の製品Y  ",
            certainty="forecast",
        )

        assert second["action"] == "skipped_no_change"
        assert second["order_id"] == first["order_id"]

    def test_different_extracted_name_creates_separate_order(
        self, admin_db, dedupe_fixture
    ):
        first = _upsert_unmatched(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            extracted_product_name="謎の製品A",
        )
        second = _upsert_unmatched(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            extracted_product_name="謎の製品B",
        )

        assert second["action"] == "inserted"
        assert second["order_id"] != first["order_id"]

    def test_missing_extracted_name_always_inserts_without_dedupe(
        self, admin_db, dedupe_fixture
    ):
        """extracted_product_nameがNULLの場合は重複判定できないため、
        常に新規行として挿入される（取りこぼしを許容する）。"""
        first = _upsert_unmatched(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            extracted_product_name=None,
        )
        second = _upsert_unmatched(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            extracted_product_name=None,
        )

        assert first["action"] == "inserted"
        assert second["action"] == "inserted"
        assert second["order_id"] != first["order_id"]

    def test_certainty_upgrade_reuses_existing_priority_hierarchy(
        self, admin_db, dedupe_fixture
    ):
        """product_id=NULLでも、certainty優先度による格上げ（forecast_tentative→
        confirmed）が既存の判定ロジックと同様に働くこと。"""
        first = _upsert_unmatched(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            extracted_product_name="謎の製品Z",
            certainty="forecast_tentative",
        )
        second = _upsert_unmatched(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            quantity=20,
            deadline_date=_FUTURE_DEADLINE,
            extracted_product_name="謎の製品Z",
            certainty="confirmed",
        )

        assert second["action"] == "updated"
        assert second["order_id"] == first["order_id"]

        order = (
            admin_db.table("orders")
            .select("customer_certainty, quantity")
            .eq("id", first["order_id"])
            .single()
            .execute()
            .data
        )
        assert order["customer_certainty"] == "confirmed"
        assert order["quantity"] == 20


@pytest.mark.integration
class TestMarkSupersededOrders:
    """
    _mark_superseded_orders はPDFパースサービス内のPython関数だが、実DBに対する
    UPDATEクエリチェーン (.eq/.neq/.gt/.in_/.is_) が意図通りかは
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
            certainty="forecast",
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
        """status='confirmed'（ユーザー確定済み）の注文は、customer_certainty の値に
        関わらずsupersedeされない。"""
        from app.services.pdf_order_parsing_service import _mark_superseded_orders

        order_row = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            certainty="forecast",
        )
        admin_db.table("orders").update(
            {"status": "confirmed", "confirmed_at": datetime.now(UTC).isoformat()}
        ).eq("id", order_row["order_id"]).execute()

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
            .eq("id", order_row["order_id"])
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
            certainty="forecast",
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


@pytest.mark.integration
class TestUpsertCustomerOrderNo:
    """Issue #366: p_customer_order_no は保存のみ行い、dedupe キー・優先順位判定には
    影響しないこと。"""

    def test_customer_order_no_is_stored_on_insert(self, admin_db, dedupe_fixture):
        result = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            certainty="forecast",
            customer_order_no="C1868",
        )
        assert result["action"] == "inserted"

        order = (
            admin_db.table("orders")
            .select("customer_order_no")
            .eq("id", result["order_id"])
            .single()
            .execute()
            .data
        )
        assert order["customer_order_no"] == "C1868"

    def test_customer_order_no_does_not_affect_dedupe_or_priority(
        self, admin_db, dedupe_fixture
    ):
        first = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            certainty="forecast",
            customer_order_no="AAA",
        )

        # 同一 dedupe キーで customer_order_no だけ違う値 → 新規行にはならず
        # 既存行の更新（数量昇格）になり、customer_order_no は新しい値で補完される
        second = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=20,
            deadline_date=_FUTURE_DEADLINE,
            certainty="forecast",
            customer_order_no="BBB",
        )

        assert second["action"] == "updated"
        assert second["order_id"] == first["order_id"]

        order = (
            admin_db.table("orders")
            .select("quantity, customer_order_no")
            .eq("id", first["order_id"])
            .single()
            .execute()
            .data
        )
        assert order["quantity"] == 20
        assert order["customer_order_no"] == "BBB"

    def test_existing_customer_order_no_is_kept_when_new_value_is_null(
        self, admin_db, dedupe_fixture
    ):
        first = _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=10,
            deadline_date=_FUTURE_DEADLINE,
            certainty="forecast",
            customer_order_no="KEEP-ME",
        )

        _upsert(
            admin_db,
            dedupe_fixture["tenant_id"],
            dedupe_fixture["customer_id"],
            dedupe_fixture["product_id"],
            quantity=30,
            deadline_date=_FUTURE_DEADLINE,
            certainty="forecast",
        )

        order = (
            admin_db.table("orders")
            .select("customer_order_no")
            .eq("id", first["order_id"])
            .single()
            .execute()
            .data
        )
        assert order["customer_order_no"] == "KEEP-ME"
