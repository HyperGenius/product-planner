"""重複製品の統合 API のテスト (Issue #515)。

サービス層（product_merge_service）はモジュール属性を差し替える。計算は unit、RPC は integration で確認する。
"""

import uuid
from decimal import Decimal
from unittest.mock import MagicMock

import pytest
from app.dependencies import get_current_user_id, get_supabase_client
from app.main import app
from app.models.master.product_merge_schemas import (
    ProductMergeBlocker,
    ProductMergeCandidatesResponse,
    ProductMergeCounts,
    ProductMergePreview,
)
from app.services import product_merge_service
from fastapi.testclient import TestClient

client = TestClient(app)

COUNTS = ProductMergeCounts(
    orders_reassigned=2,
    schedules_reassigned=4,
    aliases_reassigned=1,
    alias_history_reassigned=1,
    orders_deleted=0,
    routings_deleted=3,
    products_deleted=1,
)


def _preview(blockers=None) -> ProductMergePreview:
    return ProductMergePreview(
        keep_product_id=1,
        merge_product_ids=[2],
        counts=COUNTS,
        deleted_orders=[],
        blockers=blockers or [],
    )


def _set_role(mock_client: MagicMock, role: str) -> None:
    mock_client.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value.data = {
        "role": role
    }


@pytest.mark.api
class TestProductMergeRouter:
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
            "find_merge_candidates": MagicMock(
                return_value=ProductMergeCandidatesResponse(
                    diameter="14.5",
                    length="20",
                    material="SUS100",
                    candidates=[],
                    default_keep_product_id=None,
                )
            ),
            "load_merge_preview": MagicMock(return_value=_preview()),
            "execute_merge": MagicMock(return_value=COUNTS),
        }
        for name, mock in mocks.items():
            monkeypatch.setattr(product_merge_service, name, mock)
        return mocks

    # --- GET /products/merge-candidates ---

    def test_candidates_route_resolves_before_product_id(
        self, headers, service, mock_client
    ):
        response = client.get(
            "/products/merge-candidates",
            params={"diameter": "14.50", "length": "20", "material": "(SUS100)"},
            headers=headers,
        )

        assert response.status_code == 200
        assert response.json()["diameter"] == "14.5"
        service["find_merge_candidates"].assert_called_once_with(
            mock_client,
            headers["x-tenant-id"],
            Decimal("14.50"),
            Decimal("20"),
            "(SUS100)",
        )

    @pytest.mark.parametrize(
        "params",
        [
            {"length": "20"},
            {"diameter": "0", "length": "20"},
            {"diameter": "abc", "length": "20"},
        ],
    )
    def test_candidates_validates_query(self, headers, service, params):
        response = client.get(
            "/products/merge-candidates", params=params, headers=headers
        )

        assert response.status_code == 422
        service["find_merge_candidates"].assert_not_called()

    @pytest.mark.parametrize("role", ["order_handler", "iso_officer"])
    @pytest.mark.parametrize(
        ("method", "path", "body"),
        [
            ("get", "/products/merge-candidates?diameter=10&length=20", None),
            (
                "post",
                "/products/merge/preview",
                {"keep_product_id": 1, "merge_product_ids": [2]},
            ),
            (
                "post",
                "/products/merge",
                {"keep_product_id": 1, "merge_product_ids": [2]},
            ),
        ],
    )
    def test_forbidden_for_non_president(
        self, headers, service, mock_client, role, method, path, body
    ):
        _set_role(mock_client, role)

        response = client.request(method, path, json=body, headers=headers)

        assert response.status_code == 403
        for mock in service.values():
            mock.assert_not_called()

    def test_allowed_for_platform_admin(self, headers, service, mock_client):
        _set_role(mock_client, "platform_admin")

        response = client.post(
            "/products/merge/preview",
            json={"keep_product_id": 1, "merge_product_ids": [2]},
            headers=headers,
        )

        assert response.status_code == 200

    # --- POST /products/merge/preview ---

    def test_preview_returns_counts_and_blockers(self, headers, service, mock_client):
        service["load_merge_preview"].return_value = _preview(
            [
                ProductMergeBlocker(
                    reason="routing_mismatch",
                    product_id=2,
                    product_name="10φ×20L",
                    order_id=101,
                    sequence_order=3,
                )
            ]
        )

        response = client.post(
            "/products/merge/preview",
            json={"keep_product_id": 1, "merge_product_ids": [2, 2]},
            headers=headers,
        )

        assert response.status_code == 200
        body = response.json()
        assert body["counts"]["schedules_reassigned"] == 4
        assert body["blockers"][0]["reason"] == "routing_mismatch"
        service["load_merge_preview"].assert_called_once_with(
            mock_client, headers["x-tenant-id"], 1, [2]
        )

    @pytest.mark.parametrize(
        "body",
        [
            {"keep_product_id": 1, "merge_product_ids": []},
            {"keep_product_id": 1, "merge_product_ids": [1, 2]},
        ],
    )
    def test_preview_validates_ids(self, headers, service, body):
        response = client.post("/products/merge/preview", json=body, headers=headers)

        assert response.status_code == 422
        service["load_merge_preview"].assert_not_called()

    def test_preview_not_found(self, headers, service):
        service[
            "load_merge_preview"
        ].side_effect = product_merge_service.MergeProductNotFoundError

        response = client.post(
            "/products/merge/preview",
            json={"keep_product_id": 1, "merge_product_ids": [2]},
            headers=headers,
        )

        assert response.status_code == 404

    # --- POST /products/merge ---

    def test_merge_executes(self, headers, service, mock_client):
        response = client.post(
            "/products/merge",
            json={"keep_product_id": 1, "merge_product_ids": [2]},
            headers=headers,
        )

        assert response.status_code == 200
        assert response.json() == COUNTS.model_dump()
        service["execute_merge"].assert_called_once_with(
            mock_client, headers["x-tenant-id"], _preview()
        )

    def test_merge_blocked_returns_409(self, headers, service):
        service["load_merge_preview"].return_value = _preview(
            [
                ProductMergeBlocker(
                    reason="order_conflict",
                    product_id=2,
                    product_name="10φ×20L",
                    order_id=101,
                    order_status="in_progress",
                    conflicting_order_id=100,
                )
            ]
        )

        response = client.post(
            "/products/merge",
            json={"keep_product_id": 1, "merge_product_ids": [2]},
            headers=headers,
        )

        assert response.status_code == 409
        detail = response.json()["detail"]
        assert detail["error"] == "merge_blocked"
        assert detail["blockers"][0]["conflicting_order_id"] == 100
        service["execute_merge"].assert_not_called()

    @pytest.mark.parametrize(
        ("error", "status_code"),
        [
            (product_merge_service.MergeConflictError, 409),
            (product_merge_service.MergeForbiddenError, 403),
            (product_merge_service.MergeProductNotFoundError, 404),
        ],
    )
    def test_merge_maps_rpc_errors(self, headers, service, error, status_code):
        service["execute_merge"].side_effect = error

        response = client.post(
            "/products/merge",
            json={"keep_product_id": 1, "merge_product_ids": [2]},
            headers=headers,
        )

        assert response.status_code == status_code
        if status_code == 409:
            assert response.json()["detail"]["error"] == "merge_conflict"
