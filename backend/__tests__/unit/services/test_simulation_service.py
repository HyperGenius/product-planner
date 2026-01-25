# __tests__/unit/services/test_simulation_service.py
from unittest.mock import MagicMock

import pytest
from app.services.simulation_service import (
    build_process_schedules,
    build_simulate_response,
    is_schedule_feasible,
)


@pytest.mark.unit
class TestSimulationService:
    """シミュレーションサービスのユニットテスト"""

    def test_is_schedule_feasible_with_no_deadline(self):
        """希望納期がNoneの場合は常にTrue"""
        result = is_schedule_feasible(None, "2024-12-31T17:00:00")
        assert result is True

    def test_is_schedule_feasible_within_deadline(self):
        """計算納期が希望納期より早い場合はTrue"""
        result = is_schedule_feasible(
            "2024-12-31T17:00:00", "2024-12-30T17:00:00"
        )
        assert result is True

    def test_is_schedule_feasible_exact_deadline(self):
        """計算納期が希望納期と同じ場合はTrue"""
        result = is_schedule_feasible(
            "2024-12-31T17:00:00", "2024-12-31T17:00:00"
        )
        assert result is True

    def test_is_schedule_feasible_exceeds_deadline(self):
        """計算納期が希望納期より遅い場合はFalse"""
        result = is_schedule_feasible(
            "2024-12-31T17:00:00", "2025-01-01T17:00:00"
        )
        assert result is False

    def test_is_schedule_feasible_invalid_format(self):
        """日付フォーマットが不正な場合はTrue（エラーを無視）"""
        result = is_schedule_feasible("invalid-date", "2024-12-31T17:00:00")
        assert result is True

    def test_build_process_schedules(self):
        """プロセススケジュールの構築テスト"""
        # モックリポジトリの作成
        mock_product_repo = MagicMock()
        mock_equipment_repo = MagicMock()

        # モックの戻り値を設定
        mock_product_repo.get_process_name.return_value = "組立"
        mock_equipment_repo.get_equipment_name.return_value = "CNC Machine"

        # テストデータ
        schedules = [
            {
                "process_routing_id": 1,
                "equipment_id": 10,
                "start_datetime": "2024-12-01T09:00:00",
                "end_datetime": "2024-12-01T12:00:00",
            }
        ]

        # 実行
        result = build_process_schedules(
            schedules, mock_product_repo, mock_equipment_repo
        )

        # 検証
        assert len(result) == 1
        assert result[0]["process_name"] == "組立"
        assert result[0]["equipment_name"] == "CNC Machine"
        assert result[0]["start_time"] == "2024-12-01T09:00:00"
        assert result[0]["end_time"] == "2024-12-01T12:00:00"

        # モックが正しく呼ばれたか確認
        mock_product_repo.get_process_name.assert_called_once_with(1)
        mock_equipment_repo.get_equipment_name.assert_called_once_with(10)

    def test_build_process_schedules_no_equipment(self):
        """設備IDがない場合のプロセススケジュール構築テスト"""
        mock_product_repo = MagicMock()
        mock_equipment_repo = MagicMock()

        mock_product_repo.get_process_name.return_value = "検査"

        schedules = [
            {
                "process_routing_id": 2,
                "equipment_id": None,
                "start_datetime": "2024-12-01T13:00:00",
                "end_datetime": "2024-12-01T14:00:00",
            }
        ]

        result = build_process_schedules(
            schedules, mock_product_repo, mock_equipment_repo
        )

        assert len(result) == 1
        assert result[0]["process_name"] == "検査"
        assert result[0]["equipment_name"] is None

        # equipment_idがNoneの場合は呼ばれない
        mock_equipment_repo.get_equipment_name.assert_not_called()

    def test_build_simulate_response(self):
        """シミュレーション結果の構築テスト"""
        mock_product_repo = MagicMock()
        mock_equipment_repo = MagicMock()

        mock_product_repo.get_process_name.return_value = "組立"
        mock_equipment_repo.get_equipment_name.return_value = "Machine A"

        schedules = [
            {
                "process_routing_id": 1,
                "equipment_id": 10,
                "start_datetime": "2024-12-01T09:00:00",
                "end_datetime": "2024-12-01T15:00:00",
            }
        ]

        result = build_simulate_response(
            schedules, "2024-12-31T17:00:00", mock_product_repo, mock_equipment_repo
        )

        assert result["calculated_deadline"] == "2024-12-01T15:00:00"
        assert result["is_feasible"] is True
        assert len(result["process_schedules"]) == 1
        assert result["process_schedules"][0]["process_name"] == "組立"

    def test_build_simulate_response_empty_schedules(self):
        """空のスケジュールの場合はValueErrorを発生"""
        mock_product_repo = MagicMock()
        mock_equipment_repo = MagicMock()

        with pytest.raises(ValueError, match="スケジュール情報が空です"):
            build_simulate_response(
                [], "2024-12-31T17:00:00", mock_product_repo, mock_equipment_repo
            )

    def test_build_simulate_response_exceeds_deadline(self):
        """計算納期が希望納期を超える場合"""
        mock_product_repo = MagicMock()
        mock_equipment_repo = MagicMock()

        mock_product_repo.get_process_name.return_value = "塗装"
        mock_equipment_repo.get_equipment_name.return_value = "Painting Booth"

        schedules = [
            {
                "process_routing_id": 3,
                "equipment_id": 20,
                "start_datetime": "2024-12-01T09:00:00",
                "end_datetime": "2025-01-10T17:00:00",
            }
        ]

        result = build_simulate_response(
            schedules, "2024-12-31T17:00:00", mock_product_repo, mock_equipment_repo
        )

        assert result["calculated_deadline"] == "2025-01-10T17:00:00"
        assert result["is_feasible"] is False
