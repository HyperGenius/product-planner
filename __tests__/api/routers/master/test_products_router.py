# __tests__/unit/routers/master/test_products_router.py
import uuid
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from dependencies import get_product_repo

# テスト対象のAPIインスタンス
from function_app import prod_planner_api

# テストクライアントの作成
client = TestClient(prod_planner_api)


@pytest.mark.api
class TestProductRouter:
    """productsルーターのユニットテスト"""

    @pytest.fixture
    def mock_repo(self):
        """リポジトリのモックを作成するフィクスチャ"""
        mock = MagicMock()
        return mock

    @pytest.fixture(autouse=True)
    def override_dependency(self, mock_repo):
        """
        テスト実行中だけ get_product_repo を mock_repo に差し替える。
        autouse=True なので、このクラスの全テストで自動的に適用される。
        """
        prod_planner_api.dependency_overrides[get_product_repo] = lambda: mock_repo
        yield
        # テスト終了後に元に戻す（重要）
        prod_planner_api.dependency_overrides = {}

    def test_get_products(self, mock_repo):
        """GET /: 全件取得のテスト"""
        # 1. モックの振る舞いを定義
        expected_data = [
            {"id": 1, "name": "Product A", "code": "P001", "tenant_id": "uuid-1"},
            {"id": 2, "name": "Product B", "code": "P002", "tenant_id": "uuid-1"},
        ]
        mock_repo.get_all.return_value = expected_data

        # 2. リクエスト実行
        response = client.get("/products/")  # prefixの設定に合わせてパスを調整

        # 3. 検証
        assert response.status_code == 200
        assert response.json() == expected_data
        mock_repo.get_all.assert_called_once()

    def test_get_product_by_id(self, mock_repo):
        """GET /{id}: 1件取得のテスト"""
        product_id = 1
        expected_data = {"id": product_id, "name": "Product A"}
        mock_repo.get_by_id.return_value = expected_data

        response = client.get(f"/products/{product_id}")

        assert response.status_code == 200
        assert response.json() == expected_data
        mock_repo.get_by_id.assert_called_with(product_id)

    def test_create_product(self, mock_repo):
        """POST /: 新規作成のテスト"""
        tenant_id_str = str(uuid.uuid4())
        headers = {"x-tenant-id": tenant_id_str}
        payload = {
            "name": "New Product",
            "code": "NP001",
            "type": "standard",
        }
        # 保存後に返される想定のデータ
        created_data = {**payload, "id": 100}

        mock_repo.create.return_value = created_data

        response = client.post("/products/", json=payload, headers=headers)

        assert response.status_code == 200
        assert response.json() == created_data

        # モックが正しい引数で呼ばれたか確認
        # (payloadの内容が Pydantic -> dict に変換されて渡されているか)
        mock_repo.create.assert_called_once()
        call_args = mock_repo.create.call_args[0][0]
        assert call_args["name"] == "New Product"

    def test_update_product(self, mock_repo):
        """PATCH /{id}: 更新のテスト"""
        product_id = 1
        payload = {"name": "Updated Name"}
        updated_data = {
            "id": product_id,
            "name": "Updated Name",
            "code": "P001",
        }

        mock_repo.update.return_value = updated_data

        response = client.patch(f"/products/{product_id}", json=payload)

        assert response.status_code == 200
        assert response.json() == updated_data

        # exclude_unset=True が効いているか確認（渡したフィールドだけ更新に行っているか）
        mock_repo.update.assert_called_once()
        called_id, called_data = mock_repo.update.call_args[0]
        assert called_id == product_id
        assert called_data == payload

    def test_delete_product_success(self, mock_repo):
        """DELETE /{id}: 削除成功時のテスト"""
        product_id = 1
        mock_repo.delete.return_value = True  # 削除成功

        response = client.delete(f"/products/{product_id}")

        assert response.status_code == 200
        assert response.json() == {"status": "deleted"}
        mock_repo.delete.assert_called_with(product_id)

    def test_delete_product_not_found(self, mock_repo):
        """DELETE /{id}: 存在しないID削除時の404エラーテスト"""
        product_id = 999
        mock_repo.delete.return_value = False  # 削除失敗（見つからない）

        response = client.delete(f"/products/{product_id}")

        assert response.status_code == 404
        assert response.json()["detail"] == "Not found"

    # バリデーションエラーのテスト (追加提案):
    # もし ProductCreateSchema で「名前は必須」などの定義がある場合、
    # payload = {} のような空データを POST して 422 Unprocessable Entity が
    # 返ってくるかどうかをテストすると、より堅牢になります。
