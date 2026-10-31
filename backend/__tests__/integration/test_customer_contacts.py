"""
Integration テスト: 顧客の担当者 customer_contacts と Gmail 取り込みの顧客突合 (Issue #608)

(tenant_id, email) の UNIQUE・小文字の CHECK・顧客削除での CASCADE は DB の挙動なので
unit tier のモックでは検証できない。

実行:
  supabase start
  cd backend && pytest __tests__/integration/test_customer_contacts.py -v --run-integration
"""

from typing import Any, cast

import app.repositories.supa_infra  # noqa: F401  既存の循環 import を避けるため先に読む
import pytest
from app.services.customer_matching_service import resolve_or_create_customer
from postgrest.exceptions import APIError


@pytest.fixture()
def contacts_fixture(admin_db):
    tenant = (
        admin_db.table("tenants")
        .insert({"name": "integration test tenant (customer_contacts)"})
        .execute()
    )
    tenant_id = cast(list[dict[str, Any]], tenant.data)[0]["id"]
    customers = (
        admin_db.table("customers")
        .insert(
            [
                {"tenant_id": tenant_id, "name": "integration test customer A"},
                {"tenant_id": tenant_id, "name": "integration test customer B"},
            ]
        )
        .execute()
    )
    ids = [c["id"] for c in cast(list[dict[str, Any]], customers.data)]

    yield {"tenant_id": tenant_id, "customer_a": ids[0], "customer_b": ids[1]}

    # 下書き顧客が増えうるので、テナント単位で消す（contacts は顧客の CASCADE で消える）
    admin_db.table("customers").delete().eq("tenant_id", tenant_id).execute()
    admin_db.table("tenants").delete().eq("id", tenant_id).execute()


def _add(admin_db, f, customer_key: str, email: str):
    return (
        admin_db.table("customer_contacts")
        .insert(
            {
                "tenant_id": f["tenant_id"],
                "customer_id": f[customer_key],
                "email": email,
            }
        )
        .execute()
    )


@pytest.mark.integration
class TestCustomerContacts:
    def test_unique_per_tenant_and_email(self, admin_db, contacts_fixture):
        _add(admin_db, contacts_fixture, "customer_a", "taro@example.com")

        with pytest.raises(APIError) as exc:
            _add(admin_db, contacts_fixture, "customer_b", "taro@example.com")
        assert exc.value.code == "23505"

    def test_email_must_be_lowercase_and_trimmed(self, admin_db, contacts_fixture):
        for bad in ("Taro@Example.com", " taro@example.com", ""):
            with pytest.raises(APIError) as exc:
                _add(admin_db, contacts_fixture, "customer_a", bad)
            assert exc.value.code == "23514"

    def test_contacts_are_deleted_with_customer(self, admin_db, contacts_fixture):
        f = contacts_fixture
        _add(admin_db, f, "customer_a", "taro@example.com")

        admin_db.table("customers").delete().eq("id", f["customer_a"]).execute()

        rows = (
            admin_db.table("customer_contacts")
            .select("id")
            .eq("tenant_id", f["tenant_id"])
            .execute()
        )
        assert rows.data == []

    def test_multiple_addresses_of_one_customer_resolve_to_same_customer(
        self, admin_db, contacts_fixture
    ):
        f = contacts_fixture
        _add(admin_db, f, "customer_a", "taro@example.com")
        _add(admin_db, f, "customer_a", "hanako@example.com")

        via_taro = resolve_or_create_customer(
            admin_db, f["tenant_id"], "", real_from_email="Taro@Example.com"
        )
        via_hanako = resolve_or_create_customer(
            admin_db, f["tenant_id"], "", real_from_email="hanako@example.com"
        )
        via_both = resolve_or_create_customer(
            admin_db,
            f["tenant_id"],
            "From: taro@example.com\nFrom: hanako@example.com\n",
        )

        assert via_taro == (f["customer_a"], False)
        assert via_hanako == (f["customer_a"], False)
        assert via_both == (f["customer_a"], False)

    def test_unknown_address_creates_draft_customer_with_contact(
        self, admin_db, contacts_fixture
    ):
        f = contacts_fixture

        first_id, created = resolve_or_create_customer(
            admin_db, f["tenant_id"], "", real_from_email="new@example.com"
        )
        second_id, created_again = resolve_or_create_customer(
            admin_db, f["tenant_id"], "", real_from_email="new@example.com"
        )

        assert created is True
        assert (second_id, created_again) == (first_id, False)
