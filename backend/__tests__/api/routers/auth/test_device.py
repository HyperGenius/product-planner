# __tests__/api/routers/auth/test_device.py
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import bcrypt
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


def _set_trust(
    mock_admin_client: MagicMock,
    *,
    tenant_id: str = "tenant-1",
    expires_at: datetime | None = None,
    revoked_at: datetime | None = None,
    found: bool = True,
) -> None:
    """device_trust_registrations の検索チェーンのモックを設定する。"""
    if not found:
        data = None
    else:
        data = {
            "id": "trust-1",
            "tenant_id": tenant_id,
            "expires_at": (
                expires_at or datetime.now(UTC) + timedelta(days=1)
            ).isoformat(),
            "revoked_at": revoked_at.isoformat() if revoked_at else None,
        }
    mock_admin_client.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = data


@pytest.mark.api
class TestDeviceRouterAdminEndpoints:
    """/auth/device の管理系エンドポイント（要JWT・president/platform_admin限定）のテスト"""

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

    def test_register_device_forbidden_for_order_handler(self, headers, mock_client):
        _set_role(mock_client, "order_handler")

        response = client.post("/auth/device/register", headers=headers)

        assert response.status_code == 403

    def test_register_device_allowed_for_president(
        self, headers, mock_client, mock_admin_client
    ):
        _set_role(mock_client, "president")
        expires_at = (datetime.now(UTC) + timedelta(days=365)).isoformat()
        mock_admin_client.table.return_value.insert.return_value.execute.return_value.data = [
            {"expires_at": expires_at}
        ]

        response = client.post("/auth/device/register", headers=headers)

        assert response.status_code == 200
        assert "device_id" in response.json()

    def test_list_devices_forbidden_for_iso_officer(self, headers, mock_client):
        _set_role(mock_client, "iso_officer")

        response = client.get("/auth/device", headers=headers)

        assert response.status_code == 403

    def test_list_devices_allowed_for_platform_admin(
        self, headers, mock_client, mock_admin_client
    ):
        _set_role(mock_client, "platform_admin")
        mock_client.table.return_value.select.return_value.eq.return_value.order.return_value.execute.return_value.data = []

        response = client.get("/auth/device", headers=headers)

        assert response.status_code == 200
        assert response.json() == []

    def test_revoke_device_forbidden_for_order_handler(self, headers, mock_client):
        _set_role(mock_client, "order_handler")

        response = client.delete("/auth/device/some-device-id", headers=headers)

        assert response.status_code == 403

    def test_revoke_device_not_found(self, headers, mock_client, mock_admin_client):
        _set_role(mock_client, "president")
        mock_admin_client.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = []

        response = client.delete("/auth/device/unknown-device-id", headers=headers)

        assert response.status_code == 404

    def test_revoke_device_success(self, headers, mock_client, mock_admin_client):
        _set_role(mock_client, "president")
        mock_admin_client.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
            {"device_id": "some-device-id"}
        ]

        response = client.delete("/auth/device/some-device-id", headers=headers)

        assert response.status_code == 204


@pytest.mark.api
class TestDeviceRouterPublicEndpoints:
    """/auth/device/status, /auth/device/pin-login (認証不要) のテスト"""

    @pytest.fixture
    def mock_admin_client(self):
        return MagicMock()

    @pytest.fixture(autouse=True)
    def override_dependency(self, mock_admin_client):
        app.dependency_overrides[get_supabase_admin_client] = lambda: mock_admin_client
        yield
        app.dependency_overrides = {}

    def test_status_untrusted_device(self, mock_admin_client):
        _set_trust(mock_admin_client, found=False)

        response = client.get("/auth/device/status", params={"device_id": "unknown"})

        assert response.status_code == 200
        assert response.json() == {"trusted": False, "tenant_id": None, "members": []}

    def test_status_expired_trust(self, mock_admin_client):
        _set_trust(mock_admin_client, expires_at=datetime.now(UTC) - timedelta(days=1))

        response = client.get("/auth/device/status", params={"device_id": "expired"})

        assert response.json()["trusted"] is False

    def test_status_revoked_trust(self, mock_admin_client):
        _set_trust(mock_admin_client, revoked_at=datetime.now(UTC) - timedelta(days=1))

        response = client.get("/auth/device/status", params={"device_id": "revoked"})

        assert response.json()["trusted"] is False

    def test_status_trusted_with_members(self, mock_admin_client):
        _set_trust(mock_admin_client, tenant_id="tenant-1")
        mock_admin_client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"user_id": "user-1"}
        ]
        mock_admin_client.table.return_value.select.return_value.in_.return_value.execute.return_value.data = [
            {"id": "user-1", "full_name": "山田太郎"}
        ]

        response = client.get("/auth/device/status", params={"device_id": "trusted"})

        assert response.status_code == 200
        body = response.json()
        assert body["trusted"] is True
        assert body["tenant_id"] == "tenant-1"
        assert body["members"] == [{"user_id": "user-1", "full_name": "山田太郎"}]

    def test_pin_login_untrusted_device(self, mock_admin_client):
        _set_trust(mock_admin_client, found=False)

        response = client.post(
            "/auth/device/pin-login",
            json={"device_id": "unknown", "user_id": "user-1", "pin": "1234"},
        )

        assert response.status_code == 403

    def test_pin_login_no_pin_set(self, mock_admin_client):
        _set_trust(mock_admin_client)
        mock_admin_client.table.return_value.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = None

        response = client.post(
            "/auth/device/pin-login",
            json={"device_id": "trusted", "user_id": "user-1", "pin": "1234"},
        )

        assert response.status_code == 401

    def test_pin_login_locked(self, mock_admin_client):
        _set_trust(mock_admin_client)
        locked_until = (datetime.now(UTC) + timedelta(minutes=5)).isoformat()
        mock_admin_client.table.return_value.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "pin_hash": bcrypt.hashpw(b"1234", bcrypt.gensalt()).decode(),
            "failed_attempts": 5,
            "locked_until": locked_until,
        }

        response = client.post(
            "/auth/device/pin-login",
            json={"device_id": "trusted", "user_id": "user-1", "pin": "1234"},
        )

        assert response.status_code == 423

    def test_pin_login_wrong_pin(self, mock_admin_client):
        _set_trust(mock_admin_client)
        mock_admin_client.table.return_value.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "pin_hash": bcrypt.hashpw(b"1234", bcrypt.gensalt()).decode(),
            "failed_attempts": 0,
            "locked_until": None,
        }

        response = client.post(
            "/auth/device/pin-login",
            json={"device_id": "trusted", "user_id": "user-1", "pin": "0000"},
        )

        assert response.status_code == 401
        update_call = mock_admin_client.table.return_value.update.call_args
        assert update_call[0][0]["failed_attempts"] == 1

    def test_pin_login_success(self, mock_admin_client):
        _set_trust(mock_admin_client, tenant_id="tenant-1")
        mock_admin_client.table.return_value.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "pin_hash": bcrypt.hashpw(b"1234", bcrypt.gensalt()).decode(),
            "failed_attempts": 0,
            "locked_until": None,
        }
        mock_admin_client.auth.admin.get_user_by_id.return_value.user.email = (
            "user@example.com"
        )
        mock_admin_client.auth.admin.generate_link.return_value.properties.hashed_token = "hashed-token"
        mock_admin_client.auth.verify_otp.return_value.session.access_token = (
            "access-token"
        )
        mock_admin_client.auth.verify_otp.return_value.session.refresh_token = (
            "refresh-token"
        )

        response = client.post(
            "/auth/device/pin-login",
            json={"device_id": "trusted", "user_id": "user-1", "pin": "1234"},
        )

        assert response.status_code == 200
        body = response.json()
        assert body == {
            "access_token": "access-token",
            "refresh_token": "refresh-token",
        }
        (link_payload,), _ = mock_admin_client.auth.admin.generate_link.call_args
        assert link_payload == {"type": "magiclink", "email": "user@example.com"}
