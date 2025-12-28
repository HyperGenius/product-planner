# __tests__/api/routers/master/test_equipments.py
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from dependencies import get_equipment_repo

# テスト対象のAPIインスタンス
from function_app import prod_planner_api

# テストクライアントの作成
client = TestClient(prod_planner_api)


@pytest.mark.api
class TestEquipmentRouter:
    """equipmentsルーターのユニットテスト"""

    @pytest.fixture
    def mock_repo(self):
        """リポジトリのモックを作成するフィクスチャ"""
        mock = MagicMock()
        return mock

    @pytest.fixture(autouse=True)
    def override_dependency(self, mock_repo):
        """
        テスト実行中だけ get_equipment_repo を mock_repo に差し替える。
        """
        prod_planner_api.dependency_overrides[get_equipment_repo] = lambda: mock_repo
        yield
        prod_planner_api.dependency_overrides = {}

    def test_get_equipments(self, mock_repo):
        """GET /: 全件取得のテスト"""
        expected_data = [
            {"id": 1, "name": "Equipment A", "tenant_id": "uuid-1"},
            {"id": 2, "name": "Equipment B", "tenant_id": "uuid-1"},
        ]
        mock_repo.get_all.return_value = expected_data

        response = client.get("/equipments/")

        assert response.status_code == 200
        assert response.json() == expected_data
        mock_repo.get_all.assert_called_once()

    def test_get_equipment_by_id(self, mock_repo):
        """GET /{id}: 1件取得のテスト"""
        equipment_id = 1
        expected_data = {"id": equipment_id, "name": "Equipment A"}
        mock_repo.get_by_id.return_value = expected_data

        response = client.get(f"/equipments/{equipment_id}")

        assert response.status_code == 200
        assert response.json() == expected_data
        mock_repo.get_by_id.assert_called_with(equipment_id)

    def test_create_equipment(self, headers, mock_repo):
        """POST /: 新規作成のテスト"""
        payload = {
            "name": "New Equipment",
            "group_ids": [],
        }
        created_data = {
            "id": 100,
            "name": "New Equipment",
        }

        mock_repo.create.return_value = created_data

        response = client.post("/equipments/", json=payload, headers=headers)

        assert response.status_code == 200
        assert response.json() == created_data

        mock_repo.create.assert_called_once()
        # group_idsは除外されていることを確認
        call_args = mock_repo.create.call_args[0][0]
        assert call_args["name"] == "New Equipment"
        assert "group_ids" not in call_args

    def test_update_equipment(self, headers, mock_repo):
        """PATCH /{id}: 更新のテスト"""
        equipment_id = 1
        payload = {"name": "Updated Name"}
        updated_data = {
            "id": equipment_id,
            "name": "Updated Name",
            "tenant_id": "uuid-1",
        }

        mock_repo.update.return_value = updated_data

        response = client.patch(
            f"/equipments/{equipment_id}", json=payload, headers=headers
        )

        assert response.status_code == 200
        assert response.json() == updated_data

        mock_repo.update.assert_called_once()
        called_id, called_data = mock_repo.update.call_args[0]
        assert called_id == equipment_id
        assert called_data == payload

    def test_delete_equipment_success(self, headers, mock_repo):
        """DELETE /{id}: 削除成功時のテスト"""
        equipment_id = 1
        mock_repo.delete.return_value = True

        response = client.delete(f"/equipments/{equipment_id}", headers=headers)

        assert response.status_code == 200
        assert response.json() == {"status": "deleted"}
        mock_repo.delete.assert_called_with(equipment_id)

    def test_delete_equipment_not_found(self, headers, mock_repo):
        """DELETE /{id}: 存在しないID削除時の404エラーテスト"""
        equipment_id = 999
        mock_repo.delete.return_value = False

        response = client.delete(f"/equipments/{equipment_id}", headers=headers)

        assert response.status_code == 404
        assert response.json()["detail"] == "Not found"
