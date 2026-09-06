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

    def test_delete_member_also_deletes_member_pins(
        self, headers, mock_client, mock_admin_client
    ):
        """DELETE /{user_id}: メンバー削除時にmember_pinsも削除される（Copilotレビュー指摘）

        削除しないと、テナントから外れた後もPINハッシュが残り続け、共有端末の
        PINログイン候補一覧に表示されたりPINログインが通ってしまう。
        """
        _set_role(mock_client, "president")
        # 対象ユーザーの role も president 扱いになる（single()チェーンを共有するため）ので、
        # 「最後の president を削除できない」ガードに掛からないよう人数を2人以上にしておく
        mock_client.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.count = 2

        response = client.delete("/tenant/members/other-user-id", headers=headers)

        assert response.status_code == 204
        deleted_tables = [
            call.args[0] for call in mock_admin_client.table.call_args_list
        ]
        assert "organization_members" in deleted_tables
        assert "member_pins" in deleted_tables

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
        """GET /me: 対象テナントのメンバーでない場合は403（get_current_tenant_idのテナント所属検証で拒否される）"""
        mock_client.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value.data = None

        response = client.get("/tenant/members/me", headers=headers)

        assert response.status_code == 403

    def test_set_my_pin_success(self, headers, mock_client, mock_admin_client):
        """PATCH /me/pin: 自分自身のPINを設定できる（ロール制限なし）"""
        _set_role(mock_client, "order_handler")

        response = client.patch(
            "/tenant/members/me/pin", json={"pin": "1234"}, headers=headers
        )

        assert response.status_code == 204
        (upsert_payload,), _ = mock_admin_client.table.return_value.upsert.call_args
        assert upsert_payload["user_id"] == "test-user-id"
        assert upsert_payload["pin_hash"] != "1234"

    def test_set_my_pin_rejects_non_digit(self, headers, mock_client):
        """PATCH /me/pin: 4桁の数字以外は422"""
        _set_role(mock_client, "order_handler")

        response = client.patch(
            "/tenant/members/me/pin", json={"pin": "abcd"}, headers=headers
        )

        assert response.status_code == 422

    def test_reset_member_pin_forbidden_for_order_handler(self, headers, mock_client):
        """POST /{user_id}/pin/reset: president / platform_admin 以外は403"""
        _set_role(mock_client, "order_handler")

        response = client.post(
            "/tenant/members/other-user-id/pin/reset", headers=headers
        )

        assert response.status_code == 403

    def test_reset_member_pin_allowed_for_president(
        self, headers, mock_client, mock_admin_client
    ):
        """POST /{user_id}/pin/reset: president は他メンバーのPINを削除できる"""
        _set_role(mock_client, "president")

        response = client.post(
            "/tenant/members/other-user-id/pin/reset", headers=headers
        )

        assert response.status_code == 204
        mock_admin_client.table.return_value.delete.return_value.eq.return_value.eq.return_value.execute.assert_called_once()

    # --- 削除済みメール(auth.usersに残存)での再作成 (Issue #386-A) ---

    @staticmethod
    def _stub_already_registered(mock_admin_client, *, profile_id, memberships):
        """create_user は 'already registered' で失敗し、
        profiles には profile_id、organization_members には memberships が返る状態にする。"""
        mock_admin_client.auth.admin.create_user.side_effect = Exception(
            "A user with this email address has already been registered"
        )
        prof_data = [{"id": profile_id}] if profile_id is not None else []
        # profiles.select("id").eq(...).limit(1).execute()
        mock_admin_client.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = prof_data
        # organization_members.select("tenant_id").eq("user_id", ...).execute()
        mock_admin_client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = memberships

    def test_create_member_relinks_orphaned_auth_user(
        self, headers, mock_client, mock_admin_client
    ):
        """POST /: 削除済みメンバー(どのテナントにも未所属の孤児auth user)は再紐付けで201になる"""
        _set_role(mock_client, "president")
        self._stub_already_registered(
            mock_admin_client, profile_id="orphan-user-id", memberships=[]
        )

        response = client.post(
            "/tenant/members",
            json={
                "email": "deleted@example.com",
                "password": "newpassword123",
                "full_name": "復活 太郎",
                "role": "order_handler",
            },
            headers=headers,
        )

        assert response.status_code == 201
        assert response.json()["user_id"] == "orphan-user-id"
        # 指定パスワードで再設定されること
        (uid, attrs), _ = mock_admin_client.auth.admin.update_user_by_id.call_args
        assert uid == "orphan-user-id"
        assert attrs["password"] == "newpassword123"
        # このテナントへ再紐付けされること
        insert_tables = [c.args[0] for c in mock_admin_client.table.call_args_list]
        assert "organization_members" in insert_tables

    def test_create_member_conflict_when_email_used_in_another_tenant(
        self, headers, mock_client, mock_admin_client
    ):
        """POST /: 別テナントで使用中のメールは409のまま（誤って再紐付けしない）"""
        _set_role(mock_client, "president")
        self._stub_already_registered(
            mock_admin_client,
            profile_id="other-tenant-user-id",
            memberships=[{"tenant_id": "some-other-tenant-id"}],
        )

        response = client.post(
            "/tenant/members",
            json={
                "email": "taken@example.com",
                "password": "newpassword123",
                "full_name": "別 テナント",
                "role": "order_handler",
            },
            headers=headers,
        )

        assert response.status_code == 409
        assert "別のテナント" in response.json()["detail"]
        mock_admin_client.auth.admin.update_user_by_id.assert_not_called()

    def test_create_member_conflict_when_already_in_this_tenant(
        self, headers, mock_client, mock_admin_client
    ):
        """POST /: 既にこのテナントに所属しているメールは409"""
        _set_role(mock_client, "president")
        self._stub_already_registered(
            mock_admin_client,
            profile_id="existing-user-id",
            memberships=[{"tenant_id": headers["x-tenant-id"]}],
        )

        response = client.post(
            "/tenant/members",
            json={
                "email": "member@example.com",
                "password": "newpassword123",
                "full_name": "既存 太郎",
                "role": "order_handler",
            },
            headers=headers,
        )

        assert response.status_code == 409
        assert "このテナント" in response.json()["detail"]

    def test_create_member_conflict_when_auth_user_not_locatable(
        self, headers, mock_client, mock_admin_client
    ):
        """POST /: auth user の id を特定できない場合は安全側に倒して汎用409"""
        _set_role(mock_client, "president")
        self._stub_already_registered(
            mock_admin_client, profile_id=None, memberships=[]
        )
        mock_admin_client.auth.admin.list_users.return_value = []

        response = client.post(
            "/tenant/members",
            json={
                "email": "ghost@example.com",
                "password": "newpassword123",
                "full_name": "ゴースト",
                "role": "order_handler",
            },
            headers=headers,
        )

        assert response.status_code == 409
        mock_admin_client.auth.admin.update_user_by_id.assert_not_called()
