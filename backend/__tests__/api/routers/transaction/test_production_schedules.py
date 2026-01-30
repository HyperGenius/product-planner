# __tests__/api/routers/transaction/test_production_schedules.py
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.dependencies import get_schedule_repo

# テスト対象のAPIインスタンス
from app.main import app

# テストクライアントの作成
client = TestClient(app)


@pytest.mark.api
class TestProductionSchedulesRouter:
    """production_schedulesルーターのユニットテスト"""

    @pytest.fixture
    def mock_repo(self):
        """リポジトリのモックを作成するフィクスチャ"""
        mock = MagicMock()
        return mock

    @pytest.fixture(autouse=True)
    def override_dependency(self, mock_repo):
        """
        テスト実行中だけ依存関係を mock に差し替える。
        """
        app.dependency_overrides[get_schedule_repo] = lambda: mock_repo
        yield
        app.dependency_overrides = {}

    def test_get_production_schedules_with_period(self, headers, mock_repo):
        """GET /: 期間指定でスケジュール取得のテスト"""
        expected_data = [
            {
                "id": 1,
                "order_id": 1000001,
                "process_routing_id": 100001,
                "equipment_id": 101,
                "start_datetime": "2024-01-01T09:00:00+00:00",
                "end_datetime": "2024-01-01T12:00:00+00:00",
                "order_number": "ORD-001",
                "product_name": "製品A",
                "process_name": "切削工程",
                "equipment_name": "設備1",
            },
            {
                "id": 2,
                "order_id": 1000002,
                "process_routing_id": 100002,
                "equipment_id": 102,
                "start_datetime": "2024-01-02T09:00:00+00:00",
                "end_datetime": "2024-01-02T15:00:00+00:00",
                "order_number": "ORD-002",
                "product_name": "製品B",
                "process_name": "研削工程",
                "equipment_name": "設備2",
            },
        ]
        mock_repo.get_by_period.return_value = expected_data

        response = client.get(
            "/production-schedules/",
            params={"start_date": "2024-01-01", "end_date": "2024-01-31"},
            headers=headers,
        )

        assert response.status_code == 200
        assert response.json() == expected_data
        mock_repo.get_by_period.assert_called_once_with(
            "2024-01-01", "2024-01-31", None
        )

    def test_get_production_schedules_with_equipment_group_filter(
        self, headers, mock_repo
    ):
        """GET /: 設備グループでフィルタリングするテスト"""
        expected_data = [
            {
                "id": 1,
                "order_id": 1000001,
                "process_routing_id": 100001,
                "equipment_id": 101,
                "start_datetime": "2024-01-01T09:00:00+00:00",
                "end_datetime": "2024-01-01T12:00:00+00:00",
                "order_number": "ORD-001",
                "product_name": "製品A",
                "process_name": "切削工程",
                "equipment_name": "設備1",
            }
        ]
        mock_repo.get_by_period.return_value = expected_data

        response = client.get(
            "/production-schedules/",
            params={
                "start_date": "2024-01-01",
                "end_date": "2024-01-31",
                "equipment_group_id": 1,
            },
            headers=headers,
        )

        assert response.status_code == 200
        assert response.json() == expected_data
        mock_repo.get_by_period.assert_called_once_with("2024-01-01", "2024-01-31", 1)

    def test_get_production_schedules_empty_result(self, headers, mock_repo):
        """GET /: 結果が空の場合のテスト"""
        mock_repo.get_by_period.return_value = []

        response = client.get(
            "/production-schedules/",
            params={"start_date": "2024-12-01", "end_date": "2024-12-31"},
            headers=headers,
        )

        assert response.status_code == 200
        assert response.json() == []
        mock_repo.get_by_period.assert_called_once_with(
            "2024-12-01", "2024-12-31", None
        )

    def test_get_production_schedules_empty_equipment_group(self, headers, mock_repo):
        """GET /: 設備グループにメンバーがいない場合のテスト"""
        mock_repo.get_by_period.return_value = []

        response = client.get(
            "/production-schedules/",
            params={
                "start_date": "2024-01-01",
                "end_date": "2024-01-31",
                "equipment_group_id": 999,
            },
            headers=headers,
        )

        assert response.status_code == 200
        assert response.json() == []
        mock_repo.get_by_period.assert_called_once_with(
            "2024-01-01", "2024-01-31", 999
        )

    def test_get_production_schedules_missing_required_params(self, headers):
        """GET /: 必須パラメータが不足している場合のテスト"""
        # start_date のみ指定
        response = client.get(
            "/production-schedules/",
            params={"start_date": "2024-01-01"},
            headers=headers,
        )
        assert response.status_code == 422  # Unprocessable Entity

        # end_date のみ指定
        response = client.get(
            "/production-schedules/",
            params={"end_date": "2024-01-31"},
            headers=headers,
        )
        assert response.status_code == 422  # Unprocessable Entity

        # パラメータなし
        response = client.get("/production-schedules/", headers=headers)
        assert response.status_code == 422  # Unprocessable Entity

    def test_update_production_schedule(self, headers, mock_repo):
        """PATCH /{schedule_id}: スケジュールの更新テスト"""
        schedule_id = 10000001
        update_data = {
            "start_datetime": "2024-01-01T10:00:00+00:00",
            "end_datetime": "2024-01-01T14:00:00+00:00",
            "equipment_id": 102,
        }
        expected_response = {
            "id": schedule_id,
            "order_id": 1000001,
            "process_routing_id": 100001,
            "equipment_id": 102,
            "start_datetime": "2024-01-01T10:00:00+00:00",
            "end_datetime": "2024-01-01T14:00:00+00:00",
        }
        mock_repo.update.return_value = expected_response

        response = client.patch(
            f"/production-schedules/{schedule_id}",
            json=update_data,
            headers=headers,
        )

        assert response.status_code == 200
        assert response.json() == expected_response
        mock_repo.update.assert_called_once_with(schedule_id, update_data)

    def test_update_production_schedule_partial_update(self, headers, mock_repo):
        """PATCH /{schedule_id}: 部分更新のテスト（開始日時のみ）"""
        schedule_id = 10000001
        update_data = {"start_datetime": "2024-01-01T08:00:00+00:00"}
        expected_response = {
            "id": schedule_id,
            "order_id": 1000001,
            "process_routing_id": 100001,
            "equipment_id": 101,
            "start_datetime": "2024-01-01T08:00:00+00:00",
            "end_datetime": "2024-01-01T12:00:00+00:00",
        }
        mock_repo.update.return_value = expected_response

        response = client.patch(
            f"/production-schedules/{schedule_id}",
            json=update_data,
            headers=headers,
        )

        assert response.status_code == 200
        assert response.json() == expected_response
        mock_repo.update.assert_called_once_with(schedule_id, update_data)

    def test_update_production_schedule_equipment_only(self, headers, mock_repo):
        """PATCH /{schedule_id}: 設備のみ変更するテスト"""
        schedule_id = 10000001
        update_data = {"equipment_id": 103}
        expected_response = {
            "id": schedule_id,
            "order_id": 1000001,
            "process_routing_id": 100001,
            "equipment_id": 103,
            "start_datetime": "2024-01-01T09:00:00+00:00",
            "end_datetime": "2024-01-01T12:00:00+00:00",
        }
        mock_repo.update.return_value = expected_response

        response = client.patch(
            f"/production-schedules/{schedule_id}",
            json=update_data,
            headers=headers,
        )

        assert response.status_code == 200
        assert response.json() == expected_response
        mock_repo.update.assert_called_once_with(schedule_id, update_data)

    def test_update_production_schedule_not_found(self, headers, mock_repo):
        """PATCH /{schedule_id}: 存在しないスケジュールの更新テスト"""
        schedule_id = 99999999
        update_data = {"start_datetime": "2024-01-01T10:00:00+00:00"}
        mock_repo.update.side_effect = ValueError(
            f"Failed to update record {schedule_id}"
        )

        response = client.patch(
            f"/production-schedules/{schedule_id}",
            json=update_data,
            headers=headers,
        )

        assert response.status_code == 404
        assert "detail" in response.json()
        mock_repo.update.assert_called_once_with(schedule_id, update_data)
