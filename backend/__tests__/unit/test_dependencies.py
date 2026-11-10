# __tests__/unit/test_dependencies.py
from unittest.mock import MagicMock

import httpx
import pytest
from app import dependencies
from app.dependencies import (
    SUPABASE_HTTPX_TIMEOUT_SECONDS,
    get_current_tenant_id,
    get_shared_httpx_client,
    get_supabase_admin_client,
    get_supabase_client,
)
from fastapi import HTTPException
from postgrest.exceptions import APIError

_SUPABASE_URL = "http://supabase.test"


@pytest.fixture
def supabase_env(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", _SUPABASE_URL)
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key")


class TestSharedHttpxClient:
    """Supabase クライアントの httpx クライアントをプロセスで共有する（Issue #660）"""

    def test_user_and_admin_clients_share_one_httpx_client(self, supabase_env):
        """リクエストごとに作る Supabase クライアントが、同じ httpx クライアントを使う"""
        shared = get_shared_httpx_client()
        user_a = get_supabase_client(token="token-a")
        user_b = get_supabase_client(token="token-b")
        admin = get_supabase_admin_client()

        for client in (user_a, user_b, admin):
            assert client.postgrest.session is shared
            assert client.auth._http_client is shared
            assert client.storage.session is shared
            assert client.functions._client is shared

    def test_shared_client_does_not_hold_user_token(self, supabase_env):
        """ユーザーの JWT は Supabase クライアントのインスタンスが持ち、共有の httpx クライアントには載らない"""
        user_a = get_supabase_client(token="token-a")
        get_supabase_client(token="token-b")

        assert "authorization" not in get_shared_httpx_client().headers
        assert user_a.postgrest.headers["Authorization"] == "Bearer token-a"

    def test_each_request_carries_its_own_token(self, supabase_env, monkeypatch):
        """共有しても、送るリクエストにはそれぞれのユーザーの JWT が付く"""
        sent: list[str | None] = []

        def handler(request: httpx.Request) -> httpx.Response:
            sent.append(request.headers.get("authorization"))
            return httpx.Response(200, json=[])

        transport_client = httpx.Client(transport=httpx.MockTransport(handler))
        monkeypatch.setattr(
            dependencies, "get_shared_httpx_client", lambda: transport_client
        )
        user_a = get_supabase_client(token="token-a")
        user_b = get_supabase_client(token="token-b")

        user_a.table("orders").select("id").execute()
        user_b.table("orders").select("id").execute()
        user_a.rpc("some_rpc", {}).execute()

        assert sent == ["Bearer token-a", "Bearer token-b", "Bearer token-a"]

    def test_shared_client_does_not_keep_cookies(self):
        """応答の Cookie をユーザー間で共有しないよう保持しない"""
        shared = get_shared_httpx_client()
        response = httpx.Response(
            200,
            headers={"set-cookie": "session=abc; Path=/"},
            request=httpx.Request("GET", f"{_SUPABASE_URL}/rest/v1/orders"),
        )

        shared.cookies.extract_cookies(response)

        assert len(shared.cookies) == 0

    def test_timeout_matches_postgrest_default(self):
        """各サブクライアントは注入した httpx クライアントのタイムアウトを使う"""
        assert get_shared_httpx_client().timeout == httpx.Timeout(
            SUPABASE_HTTPX_TIMEOUT_SECONDS
        )


class TestGetCurrentTenantId:
    """get_current_tenant_id: x-tenant-id ヘッダーとJWTユーザーのテナント所属検証（Issue #343）"""

    def test_returns_tenant_id_when_user_is_member(self):
        """JWTユーザーがorganization_membersに所属していればテナントIDを返す"""
        mock_client = MagicMock()
        mock_client.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value.data = {
            "user_id": "user-1"
        }

        result = get_current_tenant_id(
            x_tenant_id="tenant-1", user_id="user-1", client=mock_client
        )

        assert result == "tenant-1"
        mock_client.table.assert_called_with("organization_members")

    def test_raises_403_when_user_is_not_member(self):
        """JWTユーザーが指定テナントのorganization_membersに存在しない場合は403"""
        mock_client = MagicMock()
        mock_client.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value.data = None

        with pytest.raises(HTTPException) as exc_info:
            get_current_tenant_id(
                x_tenant_id="other-tenant", user_id="user-1", client=mock_client
            )

        assert exc_info.value.status_code == 403

    @pytest.mark.parametrize("code", ["22P02", "PGRST116"])
    def test_raises_403_when_query_fails_with_expected_api_error(self, code):
        """不正なUUID形式（22P02）や0件時のsingle()エラー（PGRST116）は403として扱う"""
        mock_client = MagicMock()
        mock_client.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.side_effect = APIError(
            {"code": code, "message": "error"}
        )

        with pytest.raises(HTTPException) as exc_info:
            get_current_tenant_id(
                x_tenant_id="not-a-uuid", user_id="user-1", client=mock_client
            )

        assert exc_info.value.status_code == 403

    def test_reraises_unexpected_api_error(self):
        """想定外のAPIErrorはそのまま再送出され、FastAPI側で500になる"""
        mock_client = MagicMock()
        mock_client.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.side_effect = APIError(
            {"code": "500", "message": "unexpected"}
        )

        with pytest.raises(APIError):
            get_current_tenant_id(
                x_tenant_id="tenant-1", user_id="user-1", client=mock_client
            )
