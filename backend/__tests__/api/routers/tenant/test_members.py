# __tests__/api/routers/tenant/test_members.py
from unittest.mock import MagicMock

import pytest
from app.dependencies import (
    get_current_user_id,
    get_supabase_admin_client,
    get_supabase_client,
)
from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)


def _set_role(mock_client: MagicMock, role: str | None) -> None:
    """organization_members からのロール取得チェーンのモックを設定する。"""
    data = {"role": role} if role is not None else None
    mock_client.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value.data = data


@pytest.mark.api
class TestMembersRouter:
    """tenant/members ルーターの権限境界のテスト"""

    @pytest.fixture
    def mock_client(self):
        return MagicMock()

    @pytest.fixture
    def mock_admin_client(self):
        return MagicMock()

    @pytest.fixture(autouse=True)
    def override_dependency(self, mock_client, mock_admin_client):
        app.dependency_overrides[get_current_user_id] = lambda: "test-user-id"
        app.dependency_overrides[get_supabase_client] = lambda: mock_client
        app.dependency_overrides[get_supabase_admin_client] = lambda: mock_admin_client
        yield
        app.dependency_overrides = {}

    def test_list_members_forbidden_for_order_handler(self, headers, mock_client):
        """GET /: president 以外は403"""
        _set_role(mock_client, "order_handler")

        response = client.get("/tenant/members", headers=headers)

        assert response.status_code == 403

    def test_list_members_forbidden_for_iso_officer(self, headers, mock_client):
        """GET /: iso_officer も閲覧・編集権限は無いため403"""
        _set_role(mock_client, "iso_officer")

        response = client.get("/tenant/members", headers=headers)

        assert response.status_code == 403

    def test_list_members_allowed_for_president(
        self, headers, mock_client, mock_admin_client
    ):
        """GET /: president は一覧を取得できる"""
        _set_role(mock_client, "president")
        mock_admin_client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []

        response = client.get("/tenant/members", headers=headers)

        assert response.status_code == 200
        assert response.json() == []

    def test_create_member_forbidden_for_order_handler(self, headers, mock_client):
        """POST /: president 以外は403"""
        _set_role(mock_client, "order_handler")

        response = client.post(
            "/tenant/members",
            json={
                "email": "new@example.com",
                "password": "password123",
                "full_name": "New User",
                "role": "order_handler",
            },
            headers=headers,
        )

        assert response.status_code == 403

    def test_delete_member_forbidden_for_order_handler(self, headers, mock_client):
        """DELETE /{user_id}: president 以外は403"""
        _set_role(mock_client, "order_handler")

        response = client.delete("/tenant/members/other-user-id", headers=headers)

        assert response.status_code == 403
