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
        """GET /: president / platform_admin 以外は403"""
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
        """POST /: president / platform_admin 以外は403"""
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

    @pytest.mark.parametrize("role", ["order_handler", "iso_officer", "president"])
    def test_create_member_allowed_for_president_with_each_role(
        self, headers, mock_client, mock_admin_client, role
    ):
        """POST /: president は order_handler / iso_officer / president のいずれのロールでも招待できる（Issue #328）"""
        _set_role(mock_client, "president")
        mock_admin_client.auth.admin.create_user.return_value.user.id = "new-user-id"

        response = client.post(
            "/tenant/members",
            json={
                "email": "new@example.com",
                "password": "password123",
                "full_name": "New User",
                "role": role,
            },
            headers=headers,
        )

        assert response.status_code == 201
        assert response.json()["role"] == role
        # email_confirm: True によりメール確認なしで即座にログイン可能な招待フローを踏襲していることを確認
        (create_user_payload,), _ = mock_admin_client.auth.admin.create_user.call_args
        assert create_user_payload["email_confirm"] is True

    def test_delete_member_forbidden_for_order_handler(self, headers, mock_client):
        """DELETE /{user_id}: president / platform_admin 以外は403"""
        _set_role(mock_client, "order_handler")

        response = client.delete("/tenant/members/other-user-id", headers=headers)

        assert response.status_code == 403

    def test_list_members_allowed_for_platform_admin(
        self, headers, mock_client, mock_admin_client
    ):
        """GET /: platform_admin もメンバー一覧を取得できる"""
        _set_role(mock_client, "platform_admin")
        mock_admin_client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []

        response = client.get("/tenant/members", headers=headers)

        assert response.status_code == 200
        assert response.json() == []

    def test_create_member_allowed_for_platform_admin(
        self, headers, mock_client, mock_admin_client
    ):
        """POST /: platform_admin もメンバーを追加できる"""
        _set_role(mock_client, "platform_admin")
        mock_admin_client.auth.admin.create_user.return_value.user.id = "new-user-id"

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

        assert response.status_code == 201

    def test_update_member_self_demotion_blocked_for_platform_admin(
        self, headers, mock_client
    ):
        """PATCH /{user_id}: platform_admin が自分自身のロールを変更しようとすると400"""
        _set_role(mock_client, "platform_admin")

        response = client.patch(
            "/tenant/members/test-user-id",
            json={"role": "order_handler"},
            headers=headers,
        )

        assert response.status_code == 400

    def test_delete_member_forbidden_when_last_platform_admin(
        self, headers, mock_client
    ):
        """DELETE /{user_id}: テナントに platform_admin が1人しかいない場合は削除できない"""
        _set_role(mock_client, "platform_admin")
        mock_client.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.count = 1

        response = client.delete("/tenant/members/other-user-id", headers=headers)

        assert response.status_code == 400

    def test_get_my_membership_allowed_for_order_handler(self, headers, mock_client):
        """GET /me: order_handler など非管理ロールでも自分自身の情報は取得できる（一覧とは異なりロール制限なし）"""
        mock_client.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value.data = {
            "user_id": "test-user-id",
            "role": "order_handler",
        }
        mock_client.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "full_name": "受注担当 太郎",
            "email": "handler@example.com",
        }

        response = client.get("/tenant/members/me", headers=headers)

        assert response.status_code == 200
        result = response.json()
        assert result["user_id"] == "test-user-id"
        assert result["role"] == "order_handler"
        assert result["email"] == "handler@example.com"
        assert result["full_name"] == "受注担当 太郎"

    def test_get_my_membership_not_found(self, headers, mock_client):
        """GET /me: 対象テナントのメンバーでない場合は404"""
        mock_client.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value.data = None

        response = client.get("/tenant/members/me", headers=headers)

        assert response.status_code == 404
