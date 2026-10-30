"""
Integration テスト: 注文書の再送で重複起票しない (Issue #599)

`_process_line_item()` を実 Supabase に対して呼び、次の2つを確かめる。

- 品名に埋もれた品番での製品照合（`orders` → `products(code)` の埋め込み・`.not_.is_()`）で
  製品が決まり、既存の dedupe キーで承認後の受注と突き合わさる
- 顧客注文番号での再送の判定（ステータスの絞り込み）で、起票せずに既存の受注へ添付する

Claude API には依存しない（抽出済みの明細を直接渡す）。

実行:
  supabase start
  cd backend && pytest __tests__/integration/test_pdf_order_resend.py -v --run-integration
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from unittest.mock import patch

import pytest
from app.services.pdf_order_parsing_service import _process_line_item

_DEADLINE = (datetime.now(UTC).date() + timedelta(days=30)).isoformat()
_NEXT_DEADLINE = (datetime.now(UTC).date() + timedelta(days=60)).isoformat()
# 画像PDFから読むと、品番が単独の項目に入らず品名に埋もれる
_EMBEDDED_NAME = "TEST01ﾌｨﾙﾀｰ QX5501A φ10.0×10L"


def _rows(result: Any) -> list[dict[str, Any]]:
    return cast(list[dict[str, Any]], result.data or [])


@pytest.fixture()
def resend_fixture(admin_db):
    tenant_id = _rows(
        admin_db.table("tenants")
        .insert({"name": f"integration resend test {uuid.uuid4()}"})
        .execute()
    )[0]["id"]
    customer_id = _rows(
        admin_db.table("customers")
        .insert({"tenant_id": tenant_id, "name": "integration resend customer"})
        .execute()
    )[0]["id"]
    product_id = _rows(
        admin_db.table("products")
        .insert(
            {"tenant_id": tenant_id, "name": "φ10.0 X10L テスト", "code": "QX5501A"}
        )
        .execute()
    )[0]["id"]

    def staging(name: str) -> dict[str, Any]:
        return _rows(
            admin_db.table("order_attachments")
            .insert(
                {
                    "tenant_id": tenant_id,
                    "customer_id": customer_id,
                    "order_id": None,
                    "storage_path": f"{tenant_id}/inbox/{name}/order.pdf",
                    "original_filename": "order.pdf",
                    "content_type": "application/pdf",
                    "size_bytes": 1234,
                    "parse_status": "pending",
                    "source_raw": "integration resend",
                }
            )
            .execute()
        )[0]

    def order(**values: Any) -> int:
        row = {
            "tenant_id": tenant_id,
            "customer_id": customer_id,
            "product_id": product_id,
            "quantity": 2000,
            "deadline_date": _DEADLINE,
            "status": "in_progress",
            "customer_certainty": "confirmed",
            "source_type": "email",
            **values,
        }
        return int(_rows(admin_db.table("orders").insert(row).execute())[0]["id"])

    with patch(
        "app.services.pdf_order_parsing_service.auto_simulate_intake_order",
        return_value=True,
    ):
        yield {
            "tenant_id": tenant_id,
            "customer_id": customer_id,
            "product_id": product_id,
            "staging": staging,
            "order": order,
        }

    admin_db.table("notifications").delete().eq("tenant_id", tenant_id).execute()
    admin_db.table("order_parse_log").delete().eq("tenant_id", tenant_id).execute()
    admin_db.table("orders").delete().eq("tenant_id", tenant_id).execute()
    admin_db.table("order_attachments").delete().eq("tenant_id", tenant_id).execute()
    admin_db.table("products").delete().eq("id", product_id).execute()
    admin_db.table("customers").delete().eq("id", customer_id).execute()
    admin_db.table("tenants").delete().eq("id", tenant_id).execute()


def _orders(admin_db, tenant_id: str) -> list[dict[str, Any]]:
    return _rows(
        admin_db.table("orders")
        .select("id, product_id, deadline_date, status")
        .eq("tenant_id", tenant_id)
        .order("id")
        .execute()
    )


def _reasons(admin_db, attachment_id: str) -> list[str]:
    return [
        r["reason"]
        for r in _rows(
            admin_db.table("order_parse_log")
            .select("reason")
            .eq("order_attachment_id", attachment_id)
            .execute()
        )
    ]


@pytest.mark.integration
class TestPdfOrderResend:
    def test_embedded_code_matches_existing_order_without_order_no(
        self, admin_db, resend_fixture
    ):
        """注文番号の無い（#366 より前の）承認後の受注に、品番が品名に埋もれた
        同じ注文書が届いても、重複した下書きを起票しない。"""
        f = resend_fixture
        existing_id = f["order"](customer_order_no=None)
        staging = f["staging"]("embedded")
        line = {
            "product_name_raw": _EMBEDDED_NAME,
            "product_number_raw": None,
            "quantity": 2000,
            "delivery_date": _DEADLINE,
            "certainty": "confirmed",
        }

        created = _process_line_item(
            admin_db, staging, line, document_order_no="PO-EMB-1"
        )

        assert created is False
        assert [o["id"] for o in _orders(admin_db, f["tenant_id"])] == [existing_id]
        assert "no_product_match" not in _reasons(admin_db, staging["id"])

    def test_resent_document_is_attached_to_existing_order(
        self, admin_db, resend_fixture
    ):
        """注文番号が一致する承認後の受注があれば、製品が照合できない明細でも
        起票せず、届いたPDFを既存の受注に添付する。"""
        f = resend_fixture
        existing_id = f["order"](customer_order_no="PO-RES-1", status="confirmed")
        staging = f["staging"]("resent")
        line = {
            "product_name_raw": "照合できない品名",
            "product_number_raw": None,
            "quantity": 2000,
            "delivery_date": _DEADLINE,
            "certainty": "confirmed",
        }

        created = _process_line_item(
            admin_db, staging, line, document_order_no="PO-RES-1"
        )

        assert created is False
        assert [o["id"] for o in _orders(admin_db, f["tenant_id"])] == [existing_id]
        assert _reasons(admin_db, staging["id"]) == ["resent_document"]
        attachments = _rows(
            admin_db.table("order_attachments")
            .select("storage_path")
            .eq("order_id", existing_id)
            .execute()
        )
        assert [a["storage_path"] for a in attachments] == [staging["storage_path"]]

    def test_draft_with_same_order_no_is_left_to_rpc(self, admin_db, resend_fixture):
        """既存の受注が下書きなら再送扱いにせず、RPC の数量更新に任せる。"""
        f = resend_fixture
        draft_id = f["order"](customer_order_no="PO-DRAFT-1", status="draft")
        staging = f["staging"]("draft")
        line = {
            "product_name_raw": None,
            "product_number_raw": "QX5501A",
            "quantity": 2500,
            "delivery_date": _DEADLINE,
            "certainty": "confirmed",
        }

        created = _process_line_item(
            admin_db, staging, line, document_order_no="PO-DRAFT-1"
        )

        assert created is True
        quantity = (
            admin_db.table("orders")
            .select("quantity")
            .eq("id", draft_id)
            .single()
            .execute()
            .data["quantity"]
        )
        assert quantity == 2500
        assert "resent_document" not in _reasons(admin_db, staging["id"])

    def test_next_order_with_different_deadline_is_created(
        self, admin_db, resend_fixture
    ):
        """同じ製品・同じ数量でも、希望納期と注文番号が違う別の注文書は起票する。"""
        f = resend_fixture
        existing_id = f["order"](customer_order_no="PO-NEXT-1")
        staging = f["staging"]("next")
        line = {
            "product_name_raw": _EMBEDDED_NAME,
            "product_number_raw": None,
            "quantity": 2000,
            "delivery_date": _NEXT_DEADLINE,
            "certainty": "confirmed",
        }

        created = _process_line_item(
            admin_db, staging, line, document_order_no="PO-NEXT-2"
        )

        assert created is True
        orders = _orders(admin_db, f["tenant_id"])
        assert [o["id"] for o in orders][0] == existing_id
        assert len(orders) == 2
        assert orders[1]["product_id"] == f["product_id"]
        assert orders[1]["deadline_date"] == _NEXT_DEADLINE
