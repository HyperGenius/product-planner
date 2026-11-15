# __tests__/api/routers/master/test_untracked_process_names_router.py
from unittest.mock import MagicMock

import pytest
from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_supabase_client,
)
from app.main import app
from app.routers.master import untracked_process_names as router_module
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

client = TestClient(app)

_TENANT_ID = "11111111-1111-1111-1111-111111111111"
_ROW = {"id": 1, "process_name": "検査", "created_at": "2026-11-15T00:00:00+00:00"}


@pytest.mark.api
class TestUntrackedProcessNamesRouter:
    """日報で追わない工程 API（Issue #681）"""

    @pytest.fixture
    def table(self):
        return MagicMock()

    @pytest.fixture(autouse=True)
    def override_dependency(self, table):
        mock_client = MagicMock()
        mock_client.table.side_effect = lambda name: (
            table if name == "untracked_process_names" else MagicMock()
        )
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

    def test_list(self, headers, table):
        select = table.select.return_value
        select.eq.return_value.order.return_value.execute.return_value.data = [_ROW]

        response = client.get("/untracked-process-names", headers=headers)

        assert response.status_code == 200
        assert [(r["id"], r["process_name"]) for r in response.json()] == [(1, "検査")]
        select.eq.assert_called_once_with("tenant_id", _TENANT_ID)

    @pytest.mark.parametrize("role", ["order_handler", "iso_officer"])
    def test_write_forbidden_for_other_roles(self, headers, set_role, role):
        set_role(role)

        post = client.post(
            "/untracked-process-names", json={"process_name": "検査"}, headers=headers
        )
        delete = client.delete("/untracked-process-names/1", headers=headers)

        assert post.status_code == 403
        assert delete.status_code == 403

    @pytest.mark.parametrize("role", ["president", "platform_admin"])
    def test_create_strips_name(self, headers, table, set_role, role):
        set_role(role)
        table.insert.return_value.execute.return_value.data = [_ROW]

        response = client.post(
            "/untracked-process-names",
            json={"process_name": "　検査 "},
            headers=headers,
        )

        assert response.status_code == 201
        table.insert.assert_called_once_with(
            {
                "tenant_id": _TENANT_ID,
                "process_name": "検査",
                "created_by": "test-user-id",
            }
        )

    def test_create_rejects_blank_name(self, headers, set_role):
        set_role("president")

        response = client.post(
            "/untracked-process-names", json={"process_name": "　"}, headers=headers
        )

        assert response.status_code == 422

    def test_create_duplicate_is_409(self, headers, table, set_role):
        set_role("president")
        table.insert.return_value.execute.side_effect = APIError(
            {
                "code": "23505",
                "message": "untracked_process_names_tenant_id_process_name_key",
            }
        )

        response = client.post(
            "/untracked-process-names", json={"process_name": "検査"}, headers=headers
        )

        assert response.status_code == 409
        assert response.json()["detail"]["error"] == "duplicate_untracked_process"
        # 生の制約名をレスポンスに載せない
        assert "untracked_process_names_tenant_id" not in response.text

    def test_delete(self, headers, table, set_role):
        set_role("president")
        delete = table.delete.return_value
        delete.eq.return_value.eq.return_value.execute.return_value.data = [_ROW]

        response = client.delete("/untracked-process-names/1", headers=headers)

        assert response.status_code == 204
        delete.eq.assert_called_once_with("tenant_id", _TENANT_ID)
        delete.eq.return_value.eq.assert_called_once_with("id", 1)

    def test_delete_unknown_is_404(self, headers, table, set_role):
        set_role("president")
        delete = table.delete.return_value
        delete.eq.return_value.eq.return_value.execute.return_value.data = []

        assert (
            client.delete("/untracked-process-names/9", headers=headers).status_code
            == 404
        )
