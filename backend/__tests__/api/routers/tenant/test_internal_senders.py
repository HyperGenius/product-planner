# __tests__/api/routers/tenant/test_internal_senders.py
from unittest.mock import MagicMock

import pytest
from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_supabase_client,
)
from app.main import app
from app.routers.tenant import internal_senders as router_module
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

client = TestClient(app)

_TENANT_ID = "11111111-1111-1111-1111-111111111111"
_SENDER_ID = "22222222-2222-2222-2222-222222222222"
_ROW = {
    "id": _SENDER_ID,
    "email": "president@example.com",
    "created_at": "2026-10-11T00:00:00+00:00",
}


@pytest.mark.api
class TestInternalSendersRouter:
    """社内転送者の管理 API（Issue #521）"""

    @pytest.fixture
    def mock_client(self):
        return MagicMock()

    @pytest.fixture(autouse=True)
    def override_dependency(self, mock_client):
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

    @pytest.mark.parametrize("role", ["order_handler", "iso_officer"])
    def test_forbidden_for_non_admin_roles(self, headers, set_role, role):
        set_role(role)

        assert client.get("/tenant/internal-senders", headers=headers).status_code == (
            403
        )
        assert (
            client.post(
                "/tenant/internal-senders",
                json={"email": "president@example.com"},
                headers=headers,
            ).status_code
            == 403
        )
        assert (
            client.delete(
                f"/tenant/internal-senders/{_SENDER_ID}", headers=headers
            ).status_code
            == 403
        )

    def test_list_returns_rows_scoped_by_tenant(self, headers, set_role, mock_client):
        set_role("president")
        table = mock_client.table.return_value
        table.select.return_value.eq.return_value.order.return_value.execute.return_value.data = [
            _ROW
        ]

        response = client.get("/tenant/internal-senders", headers=headers)

        assert response.status_code == 200
        assert [row["email"] for row in response.json()] == ["president@example.com"]
        mock_client.table.assert_called_with("tenant_internal_senders")
        table.select.return_value.eq.assert_called_with("tenant_id", _TENANT_ID)

    def test_create_normalizes_email_to_lowercase(self, headers, set_role, mock_client):
        set_role("platform_admin")
        table = mock_client.table.return_value
        table.insert.return_value.execute.return_value.data = [_ROW]

        response = client.post(
            "/tenant/internal-senders",
            json={"email": "  President@Example.COM "},
            headers=headers,
        )

        assert response.status_code == 201
        assert table.insert.call_args.args[0] == {
            "tenant_id": _TENANT_ID,
            "email": "president@example.com",
            "created_by": "test-user-id",
        }

    def test_create_rejects_invalid_email(self, headers, set_role):
        set_role("president")

        response = client.post(
            "/tenant/internal-senders", json={"email": "not-an-email"}, headers=headers
        )

        assert response.status_code == 422

    def test_create_duplicate_returns_409(self, headers, set_role, mock_client):
        set_role("president")
        mock_client.table.return_value.insert.return_value.execute.side_effect = (
            APIError({"code": "23505", "message": "duplicate key value"})
        )

        response = client.post(
            "/tenant/internal-senders",
            json={"email": "president@example.com"},
            headers=headers,
        )

        assert response.status_code == 409
        assert response.json()["detail"] == {
            "error": "duplicate_internal_sender",
            "message": "このメールアドレスは既に登録されています",
        }

    def test_delete_scoped_by_tenant(self, headers, set_role, mock_client):
        set_role("president")
        delete = mock_client.table.return_value.delete.return_value
        delete.eq.return_value.eq.return_value.execute.return_value.data = [_ROW]

        response = client.delete(
            f"/tenant/internal-senders/{_SENDER_ID}", headers=headers
        )

        assert response.status_code == 204
        delete.eq.assert_called_with("tenant_id", _TENANT_ID)
        delete.eq.return_value.eq.assert_called_with("id", _SENDER_ID)

    def test_delete_missing_returns_404(self, headers, set_role, mock_client):
        set_role("president")
        delete = mock_client.table.return_value.delete.return_value
        delete.eq.return_value.eq.return_value.execute.return_value.data = []

        response = client.delete(
            f"/tenant/internal-senders/{_SENDER_ID}", headers=headers
        )

        assert response.status_code == 404
