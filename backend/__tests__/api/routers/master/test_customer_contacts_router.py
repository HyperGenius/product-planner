# __tests__/api/routers/master/test_customer_contacts_router.py
from unittest.mock import MagicMock

import pytest
from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_supabase_client,
)
from app.main import app
from app.routers.master import customer_contacts as router_module
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

client = TestClient(app)

_TENANT_ID = "11111111-1111-1111-1111-111111111111"
_CONTACT_ID = "22222222-2222-2222-2222-222222222222"
_ROW = {
    "id": _CONTACT_ID,
    "customer_id": 1,
    "email": "buyer@example.com",
    "contact_name": "購買 太郎",
    "created_at": "2026-11-01T00:00:00+00:00",
}


def _unique_violation() -> APIError:
    return APIError({"code": "23505", "message": "customer_contacts_key"})


@pytest.mark.api
class TestCustomerContactsRouter:
    """顧客の担当者 API（Issue #611）"""

    @pytest.fixture
    def tables(self):
        """テーブル名ごとのモック。顧客は id=1 が存在する想定。"""
        return {"customers": MagicMock(), "customer_contacts": MagicMock()}

    @pytest.fixture(autouse=True)
    def override_dependency(self, tables):
        mock_client = MagicMock()
        mock_client.table.side_effect = lambda name: tables[name]
        # 顧客の存在確認（select().eq().eq().limit().execute()）
        tables[
            "customers"
        ].select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
            {"id": 1, "name": "テスト顧客A", "email": None}
        ]
        app.dependency_overrides[get_current_user_id] = lambda: "test-user-id"
        app.dependency_overrides[get_current_tenant_id] = lambda: _TENANT_ID
        app.dependency_overrides[get_supabase_client] = lambda: mock_client
        yield
        app.dependency_overrides = {}

    @pytest.fixture
    def set_role(self, monkeypatch):
        def _set(role: str) -> None:
            monkeypatch.setattr(
                router_module, "get_current_user_role", lambda *_args: role
            )

        return _set

    def test_list_contacts(self, headers, tables):
        tables[
            "customer_contacts"
        ].select.return_value.eq.return_value.eq.return_value.order.return_value.execute.return_value.data = [
            _ROW
        ]

        response = client.get("/customers/1/contacts", headers=headers)

        assert response.status_code == 200
        assert response.json()[0]["email"] == "buyer@example.com"
        assert response.json()[0]["contact_name"] == "購買 太郎"

    def test_list_returns_404_for_unknown_customer(self, headers, tables):
        tables[
            "customers"
        ].select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = []

        assert client.get("/customers/9/contacts", headers=headers).status_code == 404

    @pytest.mark.parametrize("role", ["iso_officer"])
    def test_write_forbidden_for_other_roles(self, headers, set_role, role):
        set_role(role)

        post = client.post(
            "/customers/1/contacts", json={"email": "a@example.com"}, headers=headers
        )
        delete = client.delete(f"/customers/1/contacts/{_CONTACT_ID}", headers=headers)

        assert post.status_code == 403
        assert delete.status_code == 403

    @pytest.mark.parametrize("role", ["order_handler", "president", "platform_admin"])
    def test_create_normalizes_email(self, headers, tables, set_role, role):
        set_role(role)
        insert = tables["customer_contacts"].insert
        insert.return_value.execute.return_value.data = [_ROW]

        response = client.post(
            "/customers/1/contacts",
            json={"email": " Buyer@Example.COM ", "contact_name": "  購買 太郎 "},
            headers=headers,
        )

        assert response.status_code == 201
        insert.assert_called_once_with(
            {
                "tenant_id": _TENANT_ID,
                "customer_id": 1,
                "email": "buyer@example.com",
                "contact_name": "購買 太郎",
            }
        )

    def test_create_without_contact_name_omits_column(self, headers, tables, set_role):
        set_role("president")
        insert = tables["customer_contacts"].insert
        insert.return_value.execute.return_value.data = [_ROW]

        client.post(
            "/customers/1/contacts",
            json={"email": "a@example.com", "contact_name": "  "},
            headers=headers,
        )

        assert "contact_name" not in insert.call_args.args[0]

    def test_create_rejects_invalid_email(self, headers, set_role):
        set_role("president")

        response = client.post(
            "/customers/1/contacts", json={"email": "not-an-email"}, headers=headers
        )

        assert response.status_code == 422

    def test_create_duplicate_names_the_owner_customer(self, headers, tables, set_role):
        set_role("president")
        contacts = tables["customer_contacts"]
        contacts.insert.return_value.execute.side_effect = _unique_violation()
        contacts.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
            {"customer_id": 2}
        ]
        # 顧客テーブルは存在確認と登録先の名前引きの両方で呼ばれる
        tables[
            "customers"
        ].select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.side_effect = [
            MagicMock(data=[{"id": 1, "name": "テスト顧客A", "email": None}]),
            MagicMock(data=[{"name": "テスト顧客B"}]),
        ]

        response = client.post(
            "/customers/1/contacts", json={"email": "a@example.com"}, headers=headers
        )

        assert response.status_code == 409
        detail = response.json()["detail"]
        assert detail["error"] == "duplicate_contact_email"
        assert "テスト顧客B" in detail["message"]
        assert detail["conflicting_customer"] == {"id": 2, "name": "テスト顧客B"}

    def test_delete_contact(self, headers, tables, set_role):
        set_role("order_handler")
        delete = tables["customer_contacts"].delete
        delete.return_value.eq.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
            _ROW
        ]

        response = client.delete(
            f"/customers/1/contacts/{_CONTACT_ID}", headers=headers
        )

        assert response.status_code == 204
        tables["customers"].update.assert_not_called()

    def test_delete_clears_customer_email_when_primary(self, headers, tables, set_role):
        set_role("order_handler")
        tables[
            "customers"
        ].select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
            {"id": 1, "name": "テスト顧客A", "email": "Buyer@Example.com"}
        ]
        tables[
            "customer_contacts"
        ].delete.return_value.eq.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
            _ROW
        ]

        response = client.delete(
            f"/customers/1/contacts/{_CONTACT_ID}", headers=headers
        )

        assert response.status_code == 204
        tables["customers"].update.assert_called_once_with({"email": None})

    def test_delete_returns_404_when_missing(self, headers, tables, set_role):
        set_role("order_handler")
        tables[
            "customer_contacts"
        ].delete.return_value.eq.return_value.eq.return_value.eq.return_value.execute.return_value.data = []

        response = client.delete(
            f"/customers/1/contacts/{_CONTACT_ID}", headers=headers
        )

        assert response.status_code == 404
