# __tests__/api/routers/transaction/test_orders.py
from unittest.mock import MagicMock

import pytest
from app.dependencies import (
    get_order_repo,
    get_product_repo,
    get_schedule_repo,
)

# テスト対象のAPIインスタンス
from app.main import app
from fastapi.testclient import TestClient

# テストクライアントの作成
client = TestClient(app)


@pytest.mark.api
class TestOrderRouter:
    """ordersルーターのユニットテスト"""

    @pytest.fixture
    def mock_repo(self):
        """リポジトリのモックを作成するフィクスチャ"""
        mock = MagicMock()
        return mock

    @pytest.fixture
    def mock_product_repo(self):
        """製品リポジトリのモックを作成するフィクスチャ"""
        mock = MagicMock()
        return mock

    @pytest.fixture
    def mock_schedule_repo(self):
        """スケジュールリポジトリのモックを作成するフィクスチャ"""
        mock = MagicMock()
        return mock

    @pytest.fixture(autouse=True)
    def override_dependency(self, mock_repo, mock_product_repo, mock_schedule_repo):
        """
        テスト実行中だけ依存関係を mock に差し替える。
        """
        app.dependency_overrides[get_order_repo] = lambda: mock_repo
        app.dependency_overrides[get_product_repo] = lambda: mock_product_repo
        app.dependency_overrides[get_schedule_repo] = lambda: mock_schedule_repo
        yield
        app.dependency_overrides = {}

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

    def test_simulate_schedule(
        self, headers, mock_repo, mock_product_repo, mock_schedule_repo
    ):
        """POST /{order_id}/simulate: シミュレーション実行のテスト"""
        order_id = 1
        order_data = {
            "id": order_id,
            "product_id": 100,
            "quantity": 10,
            "order_number": "ORD-001",
        }

        # Mockの設定
        mock_repo.get_by_id.return_value = order_data

        # 工程データ
        routings = [
            {
                "id": 1,
                "equipment_group_id": 100,
                "setup_time_seconds": 1800,
                "unit_time_seconds": 600,
                "sequence_order": 1,
            }
        ]
        mock_product_repo.get_routings_by_product.return_value = routings

        # 設備グループのメンバー
        mock_product_repo.client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"equipment_id": 1}
        ]

        # 設備の最終終了時刻
        mock_schedule_repo.get_last_end_time.return_value = None

        response = client.post(f"/orders/{order_id}/simulate", headers=headers)

        assert response.status_code == 200
        result = response.json()
        assert "schedules" in result
        assert isinstance(result["schedules"], list)
        # dry_run=True のため、schedule_repo.create は呼ばれない
        mock_schedule_repo.create.assert_not_called()

    def test_simulate_schedule_not_found(self, headers, mock_repo):
        """POST /{order_id}/simulate: 注文が存在しない場合の404エラーテスト"""
        order_id = 999
        mock_repo.get_by_id.return_value = None

        response = client.post(f"/orders/{order_id}/simulate", headers=headers)

        assert response.status_code == 404
        assert response.json()["detail"] == "Order not found"

    def test_confirm_order(
        self, headers, mock_repo, mock_product_repo, mock_schedule_repo
    ):
        """POST /{order_id}/confirm: 注文確定のテスト"""
        order_id = 1
        order_data = {
            "id": order_id,
            "product_id": 100,
            "quantity": 10,
            "order_number": "ORD-001",
            "status": "draft",
        }

        # Mockの設定
        mock_repo.get_by_id.return_value = order_data

        # 工程データ
        routings = [
            {
                "id": 1,
                "equipment_group_id": 100,
                "setup_time_seconds": 1800,
                "unit_time_seconds": 600,
                "sequence_order": 1,
            }
        ]
        mock_product_repo.get_routings_by_product.return_value = routings

        # 設備グループのメンバー
        mock_product_repo.client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"equipment_id": 1}
        ]

        # 設備の最終終了時刻
        mock_schedule_repo.get_last_end_time.return_value = None
        mock_schedule_repo.create.return_value = None

        # 更新のMock
        updated_order = {**order_data, "status": "confirmed", "is_scheduled": True}
        mock_repo.update.return_value = updated_order

        response = client.post(f"/orders/{order_id}/confirm", headers=headers)

        assert response.status_code == 200
        result = response.json()
        assert result["status"] == "confirmed"
        assert "schedules" in result
        assert isinstance(result["schedules"], list)
        # dry_run=False のため、schedule_repo.create が呼ばれる
        mock_schedule_repo.create.assert_called_once()
        # ステータスが更新される
        mock_repo.update.assert_called_once_with(
            order_id, {"status": "confirmed", "is_scheduled": True}
        )

    def test_confirm_order_not_found(self, headers, mock_repo):
        """POST /{order_id}/confirm: 注文が存在しない場合の404エラーテスト"""
        order_id = 999
        mock_repo.get_by_id.return_value = None

        response = client.post(f"/orders/{order_id}/confirm", headers=headers)

        assert response.status_code == 404
        assert response.json()["detail"] == "Order not found"
