# __tests__/unit/test_dependencies.py
from unittest.mock import MagicMock

import pytest
from app.dependencies import get_current_tenant_id
from fastapi import HTTPException
from postgrest.exceptions import APIError


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
