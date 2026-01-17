# __tests__/api/routers/transaction/test_orders.py
from unittest.mock import MagicMock

import pytest
from dependencies import get_order_repo
from fastapi.testclient import TestClient

# テスト対象のAPIインスタンス
from function_app import prod_planner_api

# テストクライアントの作成
client = TestClient(prod_planner_api)


@pytest.mark.api
class TestOrderRouter:
    """ordersルーターのユニットテスト"""

    @pytest.fixture
    def mock_repo(self):
        """リポジトリのモックを作成するフィクスチャ"""
        mock = MagicMock()
        return mock

    @pytest.fixture(autouse=True)
    def override_dependency(self, mock_repo):
        """
        テスト実行中だけ get_order_repo を mock_repo に差し替える。
        """
        prod_planner_api.dependency_overrides[get_order_repo] = lambda: mock_repo
        yield
        prod_planner_api.dependency_overrides = {}

    def test_get_orders(self, mock_repo):
        """GET /: 全件取得のテスト"""
        expected_data = [
            {"id": 1, "order_number": "ORD-001", "product_id": 1, "quantity": 100},
            {"id": 2, "order_number": "ORD-002", "product_id": 2, "quantity": 200},
        ]
        mock_repo.get_all.return_value = expected_data

        response = client.get("/orders/")

        assert response.status_code == 200
        assert response.json() == expected_data
        mock_repo.get_all.assert_called_once()

    def test_get_order_by_id(self, mock_repo):
        """GET /{id}: 1件取得のテスト"""
        order_id = 1
        expected_data = {"id": order_id, "order_number": "ORD-001"}
        mock_repo.get_by_id.return_value = expected_data

        response = client.get(f"/orders/{order_id}")

        assert response.status_code == 200
        assert response.json() == expected_data
        mock_repo.get_by_id.assert_called_with(order_id)

    def test_create_order(self, headers, mock_repo):
        """POST /: 新規作成のテスト"""
        payload = {
            "order_number": "NEW-ORD",
            "product_id": 1,
            "quantity": 50,
            "deadline_date": "2024-12-31",
        }
        created_data = {**payload, "id": 100}

        mock_repo.create.return_value = created_data

        response = client.post("/orders/", json=payload, headers=headers)

        assert response.status_code == 200
        assert response.json() == created_data

        mock_repo.create.assert_called_once()

    def test_update_order(self, headers, mock_repo):
        """PATCH /{id}: 更新のテスト"""
        order_id = 1
        payload = {"quantity": 60}
        updated_data = {"id": order_id, "quantity": 60, "order_number": "ORD-001"}

        mock_repo.update.return_value = updated_data

        response = client.patch(f"/orders/{order_id}", json=payload, headers=headers)

        assert response.status_code == 200
        assert response.json() == updated_data

        mock_repo.update.assert_called_once()
        called_id, called_data = mock_repo.update.call_args[0]
        assert called_id == order_id
        assert called_data == payload

    def test_delete_order_success(self, headers, mock_repo):
        """DELETE /{id}: 削除成功時のテスト"""
        order_id = 1
        mock_repo.delete.return_value = True

        response = client.delete(f"/orders/{order_id}", headers=headers)

        assert response.status_code == 200
        assert response.json() == {"status": "deleted"}
        mock_repo.delete.assert_called_with(order_id)

    def test_delete_order_not_found(self, headers, mock_repo):
        """DELETE /{id}: 存在しないID削除時の404エラーテスト"""
        order_id = 999
        mock_repo.delete.return_value = False

        response = client.delete(f"/orders/{order_id}", headers=headers)

        assert response.status_code == 404
        assert response.json()["detail"] == "Not found"
