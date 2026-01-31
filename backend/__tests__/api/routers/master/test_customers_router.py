# __tests__/api/routers/master/test_customers_router.py
import uuid
from unittest.mock import MagicMock

import pytest
from app.dependencies import get_customer_repo

# テスト対象のAPIインスタンス
from app.main import app
from fastapi.testclient import TestClient

# テストクライアントの作成
client = TestClient(app)


@pytest.mark.api
class TestCustomerRouter:
    """customersルーターのユニットテスト"""

    @pytest.fixture
    def mock_repo(self):
        """リポジトリのモックを作成するフィクスチャ"""
        mock = MagicMock()
        return mock

    @pytest.fixture(autouse=True)
    def override_dependency(self, mock_repo):
        """
        テスト実行中だけ get_customer_repo を mock_repo に差し替える。
        autouse=True なので、このクラスの全テストで自動的に適用される。
        """
        app.dependency_overrides[get_customer_repo] = lambda: mock_repo
        yield
        # テスト終了後に元に戻す（重要）
        app.dependency_overrides = {}

    def test_get_customers(self, mock_repo):
        """GET /: 全件取得のテスト"""
        # 1. モックの振る舞いを定義
        expected_data = [
            {
                "id": 1,
                "name": "Customer A",
                "alias": "A社",
                "tenant_id": "uuid-1",
            },
            {
                "id": 2,
                "name": "Customer B",
                "alias": "B社",
                "tenant_id": "uuid-1",
            },
        ]
        mock_repo.get_all.return_value = expected_data

        # 2. リクエスト実行
        response = client.get("/customers/")

        # 3. 検証
        assert response.status_code == 200
        assert response.json() == expected_data
        mock_repo.get_all.assert_called_once()

    def test_get_customer_by_id(self, mock_repo):
        """GET /{id}: 1件取得のテスト"""
        customer_id = 1
        expected_data = {
            "id": customer_id,
            "name": "Customer A",
            "alias": "A社",
        }
        mock_repo.get_by_id.return_value = expected_data

        response = client.get(f"/customers/{customer_id}")

        assert response.status_code == 200
        assert response.json() == expected_data
        mock_repo.get_by_id.assert_called_with(customer_id)

    def test_create_customer(self, mock_repo):
        """POST /: 新規作成のテスト"""
        tenant_id_str = str(uuid.uuid4())
        headers = {"x-tenant-id": tenant_id_str}
        payload = {
            "name": "New Customer",
            "alias": "新規顧客",
            "representative_name": "山田太郎",
            "phone_number": "03-1234-5678",
            "email": "customer@example.com",
        }
        # 保存後に返される想定のデータ
        created_data = {**payload, "id": 100}

        mock_repo.create.return_value = created_data

        response = client.post("/customers/", json=payload, headers=headers)

        assert response.status_code == 200
        assert response.json() == created_data

        # モックが正しい引数で呼ばれたか確認
        mock_repo.create.assert_called_once()
        call_args = mock_repo.create.call_args[0][0]
        assert call_args["name"] == "New Customer"

    def test_update_customer(self, mock_repo):
        """PATCH /{id}: 更新のテスト"""
        customer_id = 1
        payload = {"name": "Updated Name"}
        updated_data = {
            "id": customer_id,
            "name": "Updated Name",
            "alias": "A社",
        }

        mock_repo.update.return_value = updated_data

        response = client.patch(f"/customers/{customer_id}", json=payload)

        assert response.status_code == 200
        assert response.json() == updated_data

        # exclude_unset=True が効いているか確認
        mock_repo.update.assert_called_once()
        called_id, called_data = mock_repo.update.call_args[0]
        assert called_id == customer_id
        assert called_data == payload

    def test_delete_customer_success(self, mock_repo):
        """DELETE /{id}: 削除成功時のテスト"""
        customer_id = 1
        mock_repo.delete.return_value = True  # 削除成功

        response = client.delete(f"/customers/{customer_id}")

        assert response.status_code == 200
        assert response.json() == {"status": "deleted"}
        mock_repo.delete.assert_called_with(customer_id)

    def test_delete_customer_not_found(self, mock_repo):
        """DELETE /{id}: 存在しないID削除時の404エラーテスト"""
        customer_id = 999
        mock_repo.delete.return_value = False  # 削除失敗（見つからない）

        response = client.delete(f"/customers/{customer_id}")

        assert response.status_code == 404
        assert response.json()["detail"] == "Not found"
