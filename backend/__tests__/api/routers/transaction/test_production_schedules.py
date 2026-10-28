# __tests__/api/routers/transaction/test_production_schedules.py
from typing import Any
from unittest.mock import MagicMock

import pytest
from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_schedule_repo,
    get_supabase_client,
)

# テスト対象のAPIインスタンス
from app.main import app
from app.routers.transaction import production_schedules as router_module
from fastapi.testclient import TestClient

# テストクライアントの作成
client = TestClient(app)

# レスポンスモデル（ProductionScheduleItem）の任意項目。リポジトリが返さなかった項目は null で返る
_OPTIONAL_FIELDS = (
    "equipment_id",
    "order_number",
    "customer_order_no",
    "order_status",
    "quantity",
    "desired_deadline",
    "confirmed_deadline",
    "product_name",
    "customer_name",
    "customer_alias",
    "process_name",
    "sequence_order",
    "equipment_name",
    "equipment_group_id",
    "equipment_group_name",
    "process_start_datetime",
    "process_end_datetime",
    "order_start_datetime",
    "order_end_datetime",
)


def _with_defaults(item: dict[str, Any]) -> dict[str, Any]:
    return {**dict.fromkeys(_OPTIONAL_FIELDS), **item}


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
        app.dependency_overrides[get_current_user_id] = lambda: "test-user-id"
        app.dependency_overrides[get_current_tenant_id] = lambda: "test-tenant-id"
        app.dependency_overrides[get_supabase_client] = lambda: MagicMock()
        yield
        app.dependency_overrides = {}

    @pytest.fixture
    def set_role(self, monkeypatch):
        def _set(role: str) -> None:
            monkeypatch.setattr(
                router_module, "get_current_user_role", lambda *_args: role
            )

        return _set

    @pytest.fixture
    def as_president(self, set_role):
        """スケジュールの変更は president のみ（Issue #581）"""
        set_role("president")

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
            "/production-schedules",
            params={"start_date": "2024-01-01", "end_date": "2024-01-31"},
            headers=headers,
        )

        assert response.status_code == 200
        assert response.json() == [_with_defaults(item) for item in expected_data]
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
            "/production-schedules",
            params={
                "start_date": "2024-01-01",
                "end_date": "2024-01-31",
                "equipment_group_id": 1,
            },
            headers=headers,
        )

        assert response.status_code == 200
        assert response.json() == [_with_defaults(item) for item in expected_data]
        mock_repo.get_by_period.assert_called_once_with("2024-01-01", "2024-01-31", 1)

    def test_get_production_schedules_returns_order_fields(self, headers, mock_repo):
        """GET /: ガントのラベル用の受注・工程の項目を返す（Issue #579）"""
        item = {
            "id": 1,
            "order_id": 1000001,
            "process_routing_id": 100001,
            "equipment_id": 101,
            "start_datetime": "2026-10-27T00:00:00+00:00",
            "end_datetime": "2026-10-27T03:00:00+00:00",
            "order_number": "ORD-001",
            "customer_order_no": "PO-123",
            "order_status": "confirmed",
            "quantity": 500,
            "desired_deadline": "2026-10-31",
            "confirmed_deadline": "2026-11-02",
            "product_name": "製品A",
            "customer_name": None,
            "customer_alias": None,
            "process_name": "切削",
            "sequence_order": 2,
            "equipment_name": "設備1",
            "equipment_group_id": 7,
            "equipment_group_name": "設備1",
            "process_start_datetime": "2026-10-20T00:00:00+00:00",
            "process_end_datetime": "2026-10-27T03:00:00+00:00",
            "order_start_datetime": "2026-10-20T00:00:00+00:00",
            "order_end_datetime": "2026-11-02T08:00:00+00:00",
        }
        mock_repo.get_by_period.return_value = [item]

        response = client.get(
            "/production-schedules",
            params={"start_date": "2026-10-25", "end_date": "2026-10-31"},
            headers=headers,
        )

        assert response.status_code == 200
        assert response.json() == [item]

    def test_get_production_schedules_empty_result(self, headers, mock_repo):
        """GET /: 結果が空の場合のテスト"""
        mock_repo.get_by_period.return_value = []

        response = client.get(
            "/production-schedules",
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
            "/production-schedules",
            params={
                "start_date": "2024-01-01",
                "end_date": "2024-01-31",
                "equipment_group_id": 999,
            },
            headers=headers,
        )

        assert response.status_code == 200
        assert response.json() == []
        mock_repo.get_by_period.assert_called_once_with("2024-01-01", "2024-01-31", 999)

    def test_get_production_schedules_missing_required_params(self, headers):
        """GET /: 必須パラメータが不足している場合のテスト"""
        # start_date のみ指定
        response = client.get(
            "/production-schedules",
            params={"start_date": "2024-01-01"},
            headers=headers,
        )
        assert response.status_code == 422  # Unprocessable Entity

        # end_date のみ指定
        response = client.get(
            "/production-schedules",
            params={"end_date": "2024-01-31"},
            headers=headers,
        )
        assert response.status_code == 422  # Unprocessable Entity

        # パラメータなし
        response = client.get("/production-schedules", headers=headers)
        assert response.status_code == 422  # Unprocessable Entity

    def test_update_production_schedule(self, headers, as_president, mock_repo):
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

    def test_update_production_schedule_partial_update(
        self, headers, as_president, mock_repo
    ):
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

    def test_update_production_schedule_equipment_only(
        self, headers, as_president, mock_repo
    ):
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

    def test_update_production_schedule_not_found(
        self, headers, as_president, mock_repo
    ):
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

    def test_update_production_schedule_invalid_datetime_order(
        self, headers, as_president
    ):
        """PATCH /{schedule_id}: 開始日時が終了日時より後の場合のテスト"""
        schedule_id = 10000001
        update_data = {
            "start_datetime": "2024-01-01T14:00:00+00:00",
            "end_datetime": "2024-01-01T10:00:00+00:00",
        }

        response = client.patch(
            f"/production-schedules/{schedule_id}",
            json=update_data,
            headers=headers,
        )

        assert response.status_code == 422  # Validation error
        assert "detail" in response.json()

    def test_update_production_schedule_empty_payload(
        self, headers, as_president, mock_repo
    ):
        """PATCH /{schedule_id}: 空のペイロードの場合のテスト"""
        schedule_id = 10000001
        update_data: dict[str, Any] = {}
        expected_response = {
            "id": schedule_id,
            "order_id": 1000001,
            "process_routing_id": 100001,
            "equipment_id": 101,
            "start_datetime": "2024-01-01T09:00:00+00:00",
            "end_datetime": "2024-01-01T12:00:00+00:00",
        }
        mock_repo.update.return_value = expected_response

        response = client.patch(
            f"/production-schedules/{schedule_id}",
            json=update_data,
            headers=headers,
        )

        # 空のペイロードでも有効（何も更新されないが、リクエストは成功）
        assert response.status_code == 200
        assert response.json() == expected_response
        mock_repo.update.assert_called_once_with(schedule_id, {})

    @pytest.mark.parametrize("role", ["order_handler", "iso_officer", "platform_admin"])
    def test_update_production_schedule_forbidden_for_non_president(
        self, headers, mock_repo, set_role, role
    ):
        """PATCH /{schedule_id}: president 以外は 403 で、スケジュールを書き換えない（Issue #581）"""
        set_role(role)

        response = client.patch(
            "/production-schedules/10000001",
            json={"start_datetime": "2024-01-01T10:00:00+00:00"},
            headers=headers,
        )

        assert response.status_code == 403
        mock_repo.update.assert_not_called()
