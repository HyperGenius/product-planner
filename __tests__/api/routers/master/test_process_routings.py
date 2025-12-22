# __tests__/api/routers/master/test_process_routings.py
import pytest
import uuid
from unittest.mock import MagicMock
from fastapi.testclient import TestClient

# テスト対象のAPIインスタンス
from function_app import prod_planner_api
from dependencies import get_product_repo

# テストクライアントの作成
client = TestClient(prod_planner_api)


@pytest.mark.api
class TestProcessRoutingRouter:
    """process-routingsルーターのユニットテスト"""

    @pytest.fixture
    def mock_repo(self):
        """リポジトリのモックを作成するフィクスチャ"""
        mock = MagicMock()
        return mock

    @pytest.fixture(autouse=True)
    def override_dependency(self, mock_repo):
        """
        テスト実行中だけ get_product_repo を mock_repo に差し替える。
        """
        prod_planner_api.dependency_overrides[get_product_repo] = lambda: mock_repo
        yield
        prod_planner_api.dependency_overrides = {}

    def test_get_process_routings(self, mock_repo):
        """GET /: 製品ID指定で取得のテスト"""
        product_id = 1
        expected_data = [
            {"id": 1, "product_id": product_id, "process_name": "Process A"},
            {"id": 2, "product_id": product_id, "process_name": "Process B"},
        ]
        mock_repo.get_routings_by_product.return_value = expected_data

        response = client.get(f"/process-routings/?product_id={product_id}")

        assert response.status_code == 200
        assert response.json() == expected_data
        mock_repo.get_routings_by_product.assert_called_with(product_id)

    def test_get_process_routing_by_id(self, mock_repo):
        """GET /{id}: 1件取得のテスト"""
        routing_id = 1
        expected_data = {"id": routing_id, "process_name": "Process A"}
        mock_repo.get_routing_by_id.return_value = expected_data

        response = client.get(f"/process-routings/{routing_id}")

        assert response.status_code == 200
        assert response.json() == expected_data
        mock_repo.get_routing_by_id.assert_called_with(routing_id)

    def test_create_process_routing(self, headers, mock_repo):
        """POST /: 新規作成のテスト"""
        payload = {
            "product_id": 1,
            "sequence_order": 10,
            "process_name": "New Process",
            "equipment_group_id": 2,
            "setup_time_seconds": 300,
            "unit_time_seconds": 10.5,
        }
        created_data = {**payload, "id": 100}

        mock_repo.create_routing.return_value = created_data

        response = client.post("/process-routings/", json=payload, headers=headers)

        assert response.status_code == 200
        assert response.json() == created_data

        mock_repo.create_routing.assert_called_once()

    def test_update_process_routing(self, headers, mock_repo):
        """PATCH /{id}: 更新のテスト"""
        routing_id = 1
        payload = {"process_name": "Updated Process"}
        updated_data = {"id": routing_id, "process_name": "Updated Process"}

        mock_repo.update_routing.return_value = updated_data

        response = client.patch(
            f"/process-routings/{routing_id}", json=payload, headers=headers
        )

        assert response.status_code == 200
        assert response.json() == updated_data

        mock_repo.update_routing.assert_called_once()
        called_id, called_data = mock_repo.update_routing.call_args[0]
        assert called_id == routing_id
        assert called_data == payload

    def test_delete_process_routing_success(self, headers, mock_repo):
        """DELETE /{id}: 削除成功時のテスト"""
        routing_id = 1
        mock_repo.delete_routing.return_value = True

        response = client.delete(f"/process-routings/{routing_id}", headers=headers)

        assert response.status_code == 200
        assert response.json() == {"status": "deleted"}
        mock_repo.delete_routing.assert_called_with(routing_id)

    def test_delete_process_routing_not_found(self, headers, mock_repo):
        """DELETE /{id}: 存在しないID削除時の404エラーテスト"""
        routing_id = 999
        mock_repo.delete_routing.return_value = False

        response = client.delete(f"/process-routings/{routing_id}", headers=headers)

        assert response.status_code == 404
        assert response.json()["detail"] == "Not found"
