"""顧客の統合 API のテスト (Issue #610)。

サービス層（customer_merge_service）はモジュール属性を差し替える。計算は unit、RPC は integration で確認する。
"""

import uuid
from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest
from app.dependencies import get_current_user_id, get_supabase_client
from app.main import app
from app.models.master.customer_merge_schemas import (
    CustomerMergeBlocker,
    CustomerMergeCounts,
    CustomerMergeLogEntry,
    CustomerMergePreview,
    CustomerMergeTarget,
)
from app.services import customer_merge_service
from fastapi.testclient import TestClient

client = TestClient(app)

COUNTS = CustomerMergeCounts(
    orders_reassigned=2,
    attachments_reassigned=3,
    aliases_reassigned=1,
    aliases_dropped=0,
    alias_history_reassigned=1,
    customer_aliases_reassigned=0,
    unallocated_actuals_reassigned=0,
    prompt_history_reassigned=0,
    contacts_reassigned=1,
    customers_deleted=1,
)
BODY = {"keep_customer_id": 1, "merge_customer_ids": [2]}


def _preview(blockers=None) -> CustomerMergePreview:
    return CustomerMergePreview(
        keep_customer_id=1,
        merge_customer_ids=[2],
        merge_customers=[CustomerMergeTarget(id=2, name="顧客A社 担当X")],
        counts=COUNTS,
        blockers=blockers or [],
    )


def _set_role(mock_client: MagicMock, role: str) -> None:
    mock_client.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value.data = {
        "role": role
    }


@pytest.mark.api
class TestCustomerMergeRouter:
    @pytest.fixture
    def mock_client(self):
        mock = MagicMock()
        _set_role(mock, "president")
        return mock

    @pytest.fixture
    def headers(self):
        return {"x-tenant-id": str(uuid.uuid4())}

    @pytest.fixture(autouse=True)
    def override_dependency(self, mock_client):
        app.dependency_overrides[get_current_user_id] = lambda: "test-user-id"
        app.dependency_overrides[get_supabase_client] = lambda: mock_client
        yield
        app.dependency_overrides = {}

    @pytest.fixture
    def service(self, monkeypatch):
        mocks = {
            "load_merge_preview": MagicMock(return_value=_preview()),
            "execute_merge": MagicMock(return_value=COUNTS),
            "list_merge_log": MagicMock(
                return_value=[
                    CustomerMergeLogEntry(
                        id=1,
                        keep_customer_id=1,
                        keep_customer_name="顧客A社",
                        merged_customers=[
                            CustomerMergeTarget(id=2, name="顧客A社 担当X")
                        ],
                        counts=COUNTS,
                        merged_by=None,
                        merged_at=datetime(2026, 11, 2, tzinfo=UTC),
                    )
                ]
            ),
        }
        for name, mock in mocks.items():
            monkeypatch.setattr(customer_merge_service, name, mock)
        return mocks

    def test_preview(self, service, headers):
        res = client.post("/customers/merge/preview", json=BODY, headers=headers)
        assert res.status_code == 200
        assert res.json()["counts"]["orders_reassigned"] == 2
        service["load_merge_preview"].assert_called_once()

    def test_merge_executes(self, service, headers):
        res = client.post("/customers/merge", json=BODY, headers=headers)
        assert res.status_code == 200
        assert res.json()["customers_deleted"] == 1
        service["execute_merge"].assert_called_once()

    def test_merge_blocked_returns_409_without_executing(self, service, headers):
        service["load_merge_preview"].return_value = _preview(
            [
                CustomerMergeBlocker(
                    reason="order_conflict",
                    customer_id=2,
                    customer_name="顧客A社 担当X",
                    order_id=9,
                    order_status="draft",
                    conflicting_order_id=3,
                )
            ]
        )
        res = client.post("/customers/merge", json=BODY, headers=headers)
        assert res.status_code == 409
        assert res.json()["detail"]["error"] == "merge_blocked"
        service["execute_merge"].assert_not_called()

    def test_merge_conflict_hides_db_error(self, service, headers):
        service[
            "execute_merge"
        ].side_effect = customer_merge_service.MergeConflictError()
        res = client.post("/customers/merge", json=BODY, headers=headers)
        assert res.status_code == 409
        assert res.json()["detail"]["error"] == "merge_conflict"

    def test_customer_not_found(self, service, headers):
        service[
            "load_merge_preview"
        ].side_effect = customer_merge_service.MergeCustomerNotFoundError()
        res = client.post("/customers/merge/preview", json=BODY, headers=headers)
        assert res.status_code == 404

    @pytest.mark.parametrize("role", ["order_handler", "iso_officer"])
    def test_forbidden_roles(self, service, mock_client, headers, role):
        _set_role(mock_client, role)
        for path in ("/customers/merge", "/customers/merge/preview"):
            assert client.post(path, json=BODY, headers=headers).status_code == 403
        assert client.get("/customers/merge-log", headers=headers).status_code == 403
        service["execute_merge"].assert_not_called()

    def test_platform_admin_allowed(self, service, mock_client, headers):
        _set_role(mock_client, "platform_admin")
        assert (
            client.post("/customers/merge", json=BODY, headers=headers).status_code
            == 200
        )

    def test_keep_in_merge_ids_is_rejected(self, service, headers):
        res = client.post(
            "/customers/merge",
            json={"keep_customer_id": 1, "merge_customer_ids": [1, 2]},
            headers=headers,
        )
        assert res.status_code == 422

    def test_merge_log_route_is_not_shadowed_by_customer_id(self, service, headers):
        res = client.get("/customers/merge-log", headers=headers)
        assert res.status_code == 200
        assert res.json()[0]["keep_customer_name"] == "顧客A社"
