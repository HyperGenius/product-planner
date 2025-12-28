# __tests__/api/routers/master/test_equipment_groups.py
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from dependencies import get_equipment_repo

# テスト対象のAPIインスタンス
from function_app import prod_planner_api

# テストクライアントの作成
client = TestClient(prod_planner_api)


@pytest.mark.api
class TestEquipmentGroupRouter:
    """equipment-groupsルーターのユニットテスト"""

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

    def test_get_equipment_groups(self, mock_repo):
        """GET /: 全件取得のテスト"""
        expected_data = [
            {"id": 1, "name": "Group A", "tenant_id": "uuid-1"},
            {"id": 2, "name": "Group B", "tenant_id": "uuid-1"},
        ]
        mock_repo.get_all_groups.return_value = expected_data

        response = client.get("/equipment-groups/")

        assert response.status_code == 200
        assert response.json() == expected_data
        mock_repo.get_all_groups.assert_called_once()

    def test_get_equipment_group_by_id(self, mock_repo):
        """GET /{id}: 1件取得のテスト"""
        group_id = 1
        expected_data = {"id": group_id, "name": "Group A"}
        mock_repo.get_group_by_id.return_value = expected_data

        response = client.get(f"/equipment-groups/{group_id}")

        assert response.status_code == 200
        assert response.json() == expected_data
        mock_repo.get_group_by_id.assert_called_with(group_id)

    def test_create_equipment_group(self, headers, mock_repo):
        """POST /: 新規作成のテスト"""
        payload = {
            "name": "New Group",
        }
        created_data = {**payload, "id": 100}

        mock_repo.create_group.return_value = created_data

        response = client.post("/equipment-groups/", json=payload, headers=headers)

        assert response.status_code == 200
        assert response.json() == created_data

        mock_repo.create_group.assert_called_once()
        call_args = mock_repo.create_group.call_args[0][0]
        assert call_args["name"] == "New Group"

    def test_update_equipment_group(self, headers, mock_repo):
        """PATCH /{id}: 更新のテスト"""
        group_id = 1
        payload = {"name": "Updated Name"}
        updated_data = {"id": group_id, "name": "Updated Name", "tenant_id": "uuid-1"}

        mock_repo.update_group.return_value = updated_data

        response = client.patch(
            f"/equipment-groups/{group_id}", json=payload, headers=headers
        )

        assert response.status_code == 200
        assert response.json() == updated_data

        mock_repo.update_group.assert_called_once()
        called_id, called_data = mock_repo.update_group.call_args[0]
        assert called_id == group_id
        assert called_data == payload

    def test_delete_equipment_group_success(self, headers, mock_repo):
        """DELETE /{id}: 削除成功時のテスト"""
        group_id = 1
        mock_repo.delete_group.return_value = True

        response = client.delete(f"/equipment-groups/{group_id}", headers=headers)

        assert response.status_code == 200
        assert response.json() == {"status": "deleted"}
        mock_repo.delete_group.assert_called_with(group_id)

    def test_delete_equipment_group_not_found(self, headers, mock_repo):
        """DELETE /{id}: 存在しないID削除時の404エラーテスト"""
        group_id = 999
        mock_repo.delete_group.return_value = False

        response = client.delete(f"/equipment-groups/{group_id}", headers=headers)

        assert response.status_code == 404
        assert response.json()["detail"] == "Not found"
