"""
Integration テスト: 顧客不明の注文を既存の顧客へ紐づける RPC (Issue #609)

注文・ステージング行・担当者を1トランザクションで更新し、別の顧客に登録済みのアドレスは
上書きしないことは、実際の Postgres (RLS・UNIQUE・トリガー込み) でしか検証できない。

実行:
  supabase start
  cd backend && pytest __tests__/integration/test_link_customer_to_unknown_orders.py -v --run-integration
"""

from typing import Any, cast

import app.repositories.supa_infra  # noqa: F401  既存の循環 import を避けるため先に読む
import pytest
from app.services.customer_link_service import (
    LinkContactConflictError,
    LinkOrderDuplicateError,
    LinkOrderNotUnknownError,
    get_link_context,
    link_customer,
)
from app.services.customer_matching_service import resolve_customer

SENDER = "new-contact@example.com"


def _rows(res) -> list[dict[str, Any]]:
    return cast(list[dict[str, Any]], res.data)


def _insert(admin_db, table: str, values: dict[str, Any] | list[dict[str, Any]]):
    return _rows(admin_db.table(table).insert(values).execute())


@pytest.fixture()
def seeded(admin_db, auth_user_id):
    tenant_id = _insert(
        admin_db, "tenants", {"name": "integration test link customer"}
    )[0]["id"]
    _insert(
        admin_db,
        "organization_members",
        {"user_id": auth_user_id, "tenant_id": tenant_id, "role": "order_handler"},
    )
    customer_a, customer_b = (
        c["id"]
        for c in _insert(
            admin_db,
            "customers",
            [
                {"tenant_id": tenant_id, "name": "顧客A社"},
                {"tenant_id": tenant_id, "name": "顧客B社"},
            ],
        )
    )
    _insert(
        admin_db,
        "customer_contacts",
        {"tenant_id": tenant_id, "customer_id": customer_a, "email": "old@example.com"},
    )
    product_ids = [
        p["id"]
        for p in _insert(
            admin_db,
            "products",
            [
                {"tenant_id": tenant_id, "name": "ピン", "code": None},
                {"tenant_id": tenant_id, "name": "ボルト", "code": None},
            ],
        )
    ]

    def make_order(sender: str | None, product_id: int, status: str = "draft"):
        attachment = _insert(
            admin_db,
            "order_attachments",
            {
                "tenant_id": tenant_id,
                "order_id": None,
                "customer_id": None,
                "sender_email": sender,
                "gmail_message_id": f"msg-{product_id}-{sender}-{status}",
                "storage_path": "",
                "original_filename": "",
                "parse_status": "success",
            },
        )[0]["id"]
        order_id = _insert(
            admin_db,
            "orders",
            {
                "tenant_id": tenant_id,
                "customer_id": None,
                "product_id": product_id,
                "quantity": 10,
                "status": status,
                "deadline_date": "2026-12-01",
                "source_attachment_id": attachment,
            },
        )[0]["id"]
        return order_id, attachment

    yield {
        "tenant_id": tenant_id,
        "customer_a": customer_a,
        "customer_b": customer_b,
        "products": product_ids,
        "make_order": make_order,
    }

    # orders.source_attachment_id が order_attachments を参照するので、注文を先に消す
    admin_db.table("orders").delete().eq("tenant_id", tenant_id).execute()
    admin_db.table("order_attachments").delete().eq("tenant_id", tenant_id).execute()
    admin_db.table("products").delete().eq("tenant_id", tenant_id).execute()
    admin_db.table("customers").delete().eq("tenant_id", tenant_id).execute()
    admin_db.table("organization_members").delete().eq("tenant_id", tenant_id).execute()
    admin_db.table("tenants").delete().eq("id", tenant_id).execute()


def _order(admin_db, order_id: int) -> dict[str, Any]:
    return _rows(admin_db.table("orders").select("*").eq("id", order_id).execute())[0]


def _attachment(admin_db, attachment_id: str) -> dict[str, Any]:
    return _rows(
        admin_db.table("order_attachments")
        .select("*")
        .eq("id", attachment_id)
        .execute()
    )[0]


def _contacts(admin_db, tenant_id: str, email: str) -> list[dict[str, Any]]:
    return _rows(
        admin_db.table("customer_contacts")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("email", email)
        .execute()
    )


@pytest.mark.integration
class TestLinkCustomerToUnknownOrders:
    def test_links_order_registers_contact_and_resolves_next_mail(
        self, admin_db, real_supabase_client, seeded
    ):
        f = seeded
        order_id, attachment = f["make_order"](SENDER, f["products"][0])

        result = link_customer(
            real_supabase_client, f["tenant_id"], order_id, f["customer_a"], True, False
        )

        assert result["contact_registered"] is True
        assert result["linked_order_ids"] == [order_id]
        assert _order(admin_db, order_id)["customer_id"] == f["customer_a"]
        # トリガー（Issue #315）でステージング行の customer_id も揃う
        assert _attachment(admin_db, attachment)["customer_id"] == f["customer_a"]
        contacts = _contacts(admin_db, f["tenant_id"], SENDER)
        assert [c["customer_id"] for c in contacts] == [f["customer_a"]]
        # 紐づけ後の同じアドレスのメールは自動で同じ顧客に解決される
        assert (
            resolve_customer(
                admin_db, f["tenant_id"], "", real_from_email=SENDER.upper()
            )
            == f["customer_a"]
        )

    def test_does_not_register_contact_when_unchecked(
        self, admin_db, real_supabase_client, seeded
    ):
        f = seeded
        order_id, _ = f["make_order"](SENDER, f["products"][0])

        result = link_customer(
            real_supabase_client,
            f["tenant_id"],
            order_id,
            f["customer_a"],
            False,
            False,
        )

        assert result["contact_registered"] is False
        assert _contacts(admin_db, f["tenant_id"], SENDER) == []

    def test_contact_of_another_customer_is_not_overwritten(
        self, admin_db, real_supabase_client, seeded
    ):
        f = seeded
        _insert(
            admin_db,
            "customer_contacts",
            {
                "tenant_id": f["tenant_id"],
                "customer_id": f["customer_b"],
                "email": SENDER,
            },
        )
        order_id, _ = f["make_order"](SENDER, f["products"][0])

        with pytest.raises(LinkContactConflictError):
            link_customer(
                real_supabase_client,
                f["tenant_id"],
                order_id,
                f["customer_a"],
                True,
                False,
            )

        # 失敗したら注文も担当者も変わらない（同一トランザクション）
        assert _order(admin_db, order_id)["customer_id"] is None
        contacts = _contacts(admin_db, f["tenant_id"], SENDER)
        assert [c["customer_id"] for c in contacts] == [f["customer_b"]]

    def test_same_sender_orders_and_staging_rows_are_linked_together(
        self, admin_db, real_supabase_client, seeded
    ):
        f = seeded
        order_id, _ = f["make_order"](SENDER, f["products"][0])
        sibling_id, sibling_att = f["make_order"](SENDER, f["products"][1])
        other_id, _ = f["make_order"]("other@example.com", f["products"][1])
        pending_att = _insert(
            admin_db,
            "order_attachments",
            {
                "tenant_id": f["tenant_id"],
                "order_id": None,
                "customer_id": None,
                "sender_email": SENDER,
                "gmail_message_id": "msg-pending",
                "storage_path": "",
                "original_filename": "",
                "parse_status": "pending",
            },
        )[0]["id"]

        context = get_link_context(
            real_supabase_client, f["tenant_id"], _order(admin_db, order_id)
        )
        assert context["sender_email"] == SENDER
        assert context["same_sender_order_count"] == 1

        result = link_customer(
            real_supabase_client, f["tenant_id"], order_id, f["customer_a"], True, True
        )

        assert sorted(result["linked_order_ids"]) == sorted([order_id, sibling_id])
        assert result["linked_staging_count"] == 1
        assert _order(admin_db, sibling_id)["customer_id"] == f["customer_a"]
        assert _attachment(admin_db, sibling_att)["customer_id"] == f["customer_a"]
        assert _attachment(admin_db, pending_att)["customer_id"] == f["customer_a"]
        assert _order(admin_db, other_id)["customer_id"] is None

    def test_same_sender_sibling_that_would_duplicate_is_skipped(
        self, admin_db, real_supabase_client, seeded
    ):
        f = seeded
        order_id, _ = f["make_order"](SENDER, f["products"][0])
        sibling_id, _ = f["make_order"](SENDER, f["products"][1])
        # 顧客Aには同じ製品・納期の注文が既にある → sibling を紐づけると orders_dedupe_key に当たる
        _insert(
            admin_db,
            "orders",
            {
                "tenant_id": f["tenant_id"],
                "customer_id": f["customer_a"],
                "product_id": f["products"][1],
                "quantity": 5,
                "status": "draft",
                "deadline_date": "2026-12-01",
            },
        )

        result = link_customer(
            real_supabase_client, f["tenant_id"], order_id, f["customer_a"], True, True
        )

        assert result["linked_order_ids"] == [order_id]
        assert result["skipped_order_ids"] == [sibling_id]
        assert _order(admin_db, sibling_id)["customer_id"] is None

    def test_duplicate_of_the_requested_order_fails_everything(
        self, admin_db, real_supabase_client, seeded
    ):
        f = seeded
        order_id, _ = f["make_order"](SENDER, f["products"][0])
        _insert(
            admin_db,
            "orders",
            {
                "tenant_id": f["tenant_id"],
                "customer_id": f["customer_a"],
                "product_id": f["products"][0],
                "quantity": 5,
                "status": "draft",
                "deadline_date": "2026-12-01",
            },
        )

        with pytest.raises(LinkOrderDuplicateError):
            link_customer(
                real_supabase_client,
                f["tenant_id"],
                order_id,
                f["customer_a"],
                True,
                False,
            )

        assert _contacts(admin_db, f["tenant_id"], SENDER) == []

    def test_order_with_customer_is_rejected(
        self, admin_db, real_supabase_client, seeded
    ):
        f = seeded
        order_id, _ = f["make_order"](SENDER, f["products"][0])
        admin_db.table("orders").update({"customer_id": f["customer_b"]}).eq(
            "id", order_id
        ).execute()

        with pytest.raises(LinkOrderNotUnknownError):
            link_customer(
                real_supabase_client,
                f["tenant_id"],
                order_id,
                f["customer_a"],
                True,
                False,
            )

    def test_domain_candidates_are_listed_but_not_auto_resolved(
        self, admin_db, real_supabase_client, seeded
    ):
        f = seeded
        # old@example.com が顧客Aの担当者。同じドメインの別アドレスは候補に出るが、自動では確定しない
        order_id, _ = f["make_order"](SENDER, f["products"][0])

        context = get_link_context(
            real_supabase_client, f["tenant_id"], _order(admin_db, order_id)
        )

        assert context["candidate_customer_ids"] == [f["customer_a"]]
        assert context["contact_owner_customer_id"] is None
        assert resolve_customer(admin_db, f["tenant_id"], "", SENDER) is None
