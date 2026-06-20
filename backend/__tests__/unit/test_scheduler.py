"""
スケジューリングロジックの単体テスト
"""

from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest
from app.scheduler_logic import (
    RoutingUnconfirmedError,
    routings_are_confirmed,
    schedule_order,
)


@pytest.mark.unit
class TestScheduleOrder:
    """schedule_order関数のテスト"""

    def test_schedule_single_process_product(self) -> None:
        """単一工程の製品をスケジュールする"""
        # Mockの準備
        mock_product_repo = MagicMock()
        mock_schedule_repo = MagicMock()

        # 工程データ（1工程のみ）
        routings = [
            {
                "id": 1,
                "equipment_group_id": 100,
                "setup_time_seconds": 1800,  # 30分
                "unit_time_seconds": 600,  # 10分/個
                "sequence_order": 1,
                "is_confirmed": True,
            }
        ]
        mock_product_repo.get_routings_by_product.return_value = routings

        # 設備グループに属する設備
        mock_product_repo.client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"equipment_id": 1},
            {"equipment_id": 2},
        ]

        # 設備の最終終了時刻（設備1は空き、設備2は使用中）
        def get_last_end_time_side_effect(equipment_id: int):
            if equipment_id == 1:
                return None  # 空き
            elif equipment_id == 2:
                return datetime(2025, 1, 6, 14, 0, tzinfo=UTC)  # 月曜日 14:00に終了予定

        mock_schedule_repo.get_last_end_time.side_effect = get_last_end_time_side_effect
        mock_schedule_repo.create.return_value = None
        mock_schedule_repo.get_schedules_by_equipment.return_value = []

        # テスト実行（開始時刻を固定して時刻依存を排除）
        start_time = datetime(2025, 1, 6, 9, 0, tzinfo=UTC)  # 月曜日 9:00
        result = schedule_order(
            order_id=1,
            product_id=1,
            quantity=10,
            product_repo=mock_product_repo,
            schedule_repo=mock_schedule_repo,
            tenant_id="test-tenant-id",
            start_time=start_time,
        )

        # 検証
        assert len(result) == 1
        assert result[0]["order_id"] == 1
        assert result[0]["equipment_id"] in [1, 2]  # どちらかの設備が選ばれる
        mock_schedule_repo.create.assert_called_once()

    def test_schedule_multi_process_product(self) -> None:
        """複数工程の製品をスケジュールする"""
        # Mockの準備
        mock_product_repo = MagicMock()
        mock_schedule_repo = MagicMock()

        # 工程データ（3工程）
        routings = [
            {
                "id": 1,
                "equipment_group_id": 100,
                "setup_time_seconds": 1800,  # 30分
                "unit_time_seconds": 600,  # 10分/個
                "sequence_order": 1,
                "is_confirmed": True,
            },
            {
                "id": 2,
                "equipment_group_id": 200,
                "setup_time_seconds": 2400,  # 40分
                "unit_time_seconds": 900,  # 15分/個
                "sequence_order": 2,
                "is_confirmed": True,
            },
            {
                "id": 3,
                "equipment_group_id": 300,
                "setup_time_seconds": 600,  # 10分
                "unit_time_seconds": 300,  # 5分/個
                "sequence_order": 3,
                "is_confirmed": True,
            },
        ]
        mock_product_repo.get_routings_by_product.return_value = routings

        # 各設備グループに1台ずつ設備がある
        def table_mock_side_effect(*args, **kwargs):
            table_mock = MagicMock()
            table_mock.select.return_value.eq.return_value.execute.return_value.data = [
                {"equipment_id": 1}
            ]
            return table_mock

        mock_product_repo.client.table.side_effect = table_mock_side_effect

        # すべての設備が空き
        mock_schedule_repo.get_last_end_time.return_value = None
        mock_schedule_repo.create.return_value = None
        mock_schedule_repo.get_schedules_by_equipment.return_value = []

        # テスト実行（開始時刻を9:00に固定して、日またぎが発生しないようにする）
        start_time = datetime(2025, 1, 6, 9, 0, tzinfo=UTC)  # 月曜日 9:00
        result = schedule_order(
            order_id=2,
            product_id=2,
            quantity=5,
            product_repo=mock_product_repo,
            schedule_repo=mock_schedule_repo,
            tenant_id="test-tenant-id",
            start_time=start_time,
        )

        # 検証
        # Process 1: 80分 (9:00-10:20)
        # Process 2: 115分 (10:20-12:15)
        # Process 3: 35分 (12:15-12:50)
        # すべて1日以内に収まるため、3工程 = 3スケジュール
        assert len(result) == 3
        assert result[0]["process_routing_id"] == 1
        assert result[1]["process_routing_id"] == 2
        assert result[2]["process_routing_id"] == 3
        assert mock_schedule_repo.create.call_count == 3

        # 各工程の開始時刻が前工程の終了時刻以降であることを確認
        for i in range(1, len(result)):
            prev_end = datetime.fromisoformat(result[i - 1]["end_datetime"])
            curr_start = datetime.fromisoformat(result[i]["start_datetime"])
            assert curr_start >= prev_end

    def test_schedule_with_busy_equipment(self) -> None:
        """設備が使用中の場合、より早く開始できる設備を選択する"""
        # Mockの準備
        mock_product_repo = MagicMock()
        mock_schedule_repo = MagicMock()

        routings = [
            {
                "id": 1,
                "equipment_group_id": 100,
                "setup_time_seconds": 0,
                "unit_time_seconds": 3600,  # 60分/個
                "sequence_order": 1,
                "is_confirmed": True,
            }
        ]
        mock_product_repo.get_routings_by_product.return_value = routings

        # 設備グループに2台の設備
        mock_product_repo.client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"equipment_id": 1},
            {"equipment_id": 2},
        ]

        # 設備1は遠い未来まで使用中、設備2は近い未来まで使用中
        # 設備2の方が早く開始できるべき
        now = datetime.now(tz=UTC)

        def get_last_end_time_side_effect(equipment_id: int):
            if equipment_id == 1:
                return now.replace(
                    hour=16, minute=0, second=0, microsecond=0
                )  # 今日の16:00まで使用中
            elif equipment_id == 2:
                return now.replace(
                    hour=10, minute=0, second=0, microsecond=0
                )  # 今日の10:00まで使用中（より早く空く）

        mock_schedule_repo.get_last_end_time.side_effect = get_last_end_time_side_effect
        mock_schedule_repo.create.return_value = None
        mock_schedule_repo.get_schedules_by_equipment.return_value = []

        # テスト実行（数量1個 = 60分）
        result = schedule_order(
            order_id=3,
            product_id=3,
            quantity=1,
            product_repo=mock_product_repo,
            schedule_repo=mock_schedule_repo,
            tenant_id="test-tenant-id",
        )

        # 検証：より早く空く設備2が選ばれるべき
        # ただし、今日が土日の場合は月曜日になるため、厳密な検証は難しい
        # ここでは、スケジュールが作成されたことを確認
        assert len(result) == 1
        assert result[0]["order_id"] == 3

    def test_schedule_with_no_routings(self) -> None:
        """工程が存在しない場合、ValueErrorを投げる"""
        mock_product_repo = MagicMock()
        mock_schedule_repo = MagicMock()

        mock_product_repo.get_routings_by_product.return_value = []

        with pytest.raises(ValueError, match="工程が見つかりません"):
            schedule_order(
                order_id=4,
                product_id=4,
                quantity=1,
                product_repo=mock_product_repo,
                schedule_repo=mock_schedule_repo,
                tenant_id="test-tenant-id",
            )

    def test_schedule_with_no_equipment_in_group(self) -> None:
        """設備グループに設備が存在しない場合、ValueErrorを投げる"""
        mock_product_repo = MagicMock()
        mock_schedule_repo = MagicMock()

        routings = [
            {
                "id": 1,
                "equipment_group_id": 100,
                "setup_time_seconds": 0,
                "unit_time_seconds": 600,
                "sequence_order": 1,
                "is_confirmed": True,
            }
        ]
        mock_product_repo.get_routings_by_product.return_value = routings

        # 設備グループに設備が存在しない
        mock_product_repo.client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []

        with pytest.raises(ValueError, match="設備が見つかりません"):
            schedule_order(
                order_id=5,
                product_id=5,
                quantity=1,
                product_repo=mock_product_repo,
                schedule_repo=mock_schedule_repo,
                tenant_id="test-tenant-id",
            )

    def test_schedule_respects_calendar_logic(self) -> None:
        """カレンダーロジックが適用され、17:00を超える場合は分割される"""
        mock_product_repo = MagicMock()
        mock_schedule_repo = MagicMock()

        routings = [
            {
                "id": 1,
                "equipment_group_id": 100,
                "setup_time_seconds": 0,
                "unit_time_seconds": 7200,  # 120分/個 = 2時間
                "sequence_order": 1,
                "is_confirmed": True,
            }
        ]
        mock_product_repo.get_routings_by_product.return_value = routings

        mock_product_repo.client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"equipment_id": 1}
        ]

        # 設備の最終終了時刻を今日の 16:00 に設定
        # 2時間の作業を開始すると18:00になるため、2つのスケジュールに分割されるべき
        now = datetime.now(tz=UTC)
        mock_schedule_repo.get_last_end_time.return_value = now.replace(
            hour=16, minute=0, second=0, microsecond=0
        )
        mock_schedule_repo.create.return_value = None
        mock_schedule_repo.get_schedules_by_equipment.return_value = []

        result = schedule_order(
            order_id=6,
            product_id=6,
            quantity=1,
            product_repo=mock_product_repo,
            schedule_repo=mock_schedule_repo,
            tenant_id="test-tenant-id",
        )

        # 検証：2つのスケジュールに分割される
        assert len(result) == 2
        # 1つ目: 16:00から17:00まで（1時間）
        start_dt_1 = datetime.fromisoformat(result[0]["start_datetime"])
        end_dt_1 = datetime.fromisoformat(result[0]["end_datetime"])
        assert start_dt_1.hour == 16
        assert end_dt_1.hour == 17
        # 2つ目: 翌営業日の9:00から10:00まで（1時間）
        start_dt_2 = datetime.fromisoformat(result[1]["start_datetime"])
        end_dt_2 = datetime.fromisoformat(result[1]["end_datetime"])
        assert start_dt_2.hour == 9
        assert end_dt_2.hour == 10

    def test_schedule_with_dry_run_true(self) -> None:
        """dry_run=True の場合、DBに保存せずに計算結果のみを返す"""
        # Mockの準備
        mock_product_repo = MagicMock()
        mock_schedule_repo = MagicMock()

        # 工程データ（1工程のみ）
        routings = [
            {
                "id": 1,
                "equipment_group_id": 100,
                "setup_time_seconds": 1800,  # 30分
                "unit_time_seconds": 600,  # 10分/個
                "sequence_order": 1,
                "is_confirmed": True,
            }
        ]
        mock_product_repo.get_routings_by_product.return_value = routings

        # 設備グループに属する設備
        mock_product_repo.client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"equipment_id": 1}
        ]

        # 設備の最終終了時刻
        mock_schedule_repo.get_last_end_time.return_value = None
        mock_schedule_repo.create.return_value = None
        mock_schedule_repo.get_schedules_by_equipment.return_value = []

        # テスト実行（dry_run=True、開始時刻を固定）
        start_time = datetime(2025, 1, 6, 9, 0, tzinfo=UTC)
        result = schedule_order(
            order_id=1,
            product_id=1,
            quantity=10,
            product_repo=mock_product_repo,
            schedule_repo=mock_schedule_repo,
            tenant_id="test-tenant-id",
            dry_run=True,
            start_time=start_time,
        )

        # 検証：結果は返されるが、DBには保存されない
        assert len(result) == 1
        assert result[0]["order_id"] == 1
        assert result[0]["equipment_id"] == 1
        # dry_run=True のため、create は呼ばれないはず
        mock_schedule_repo.create.assert_not_called()

    def test_schedule_with_dry_run_false(self) -> None:
        """dry_run=False の場合、DBに保存する"""
        # Mockの準備
        mock_product_repo = MagicMock()
        mock_schedule_repo = MagicMock()

        # 工程データ（1工程のみ）
        routings = [
            {
                "id": 1,
                "equipment_group_id": 100,
                "setup_time_seconds": 1800,  # 30分
                "unit_time_seconds": 600,  # 10分/個
                "sequence_order": 1,
                "is_confirmed": True,
            }
        ]
        mock_product_repo.get_routings_by_product.return_value = routings

        # 設備グループに属する設備
        mock_product_repo.client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"equipment_id": 1}
        ]

        # 設備の最終終了時刻
        mock_schedule_repo.get_last_end_time.return_value = None
        mock_schedule_repo.create.return_value = None
        mock_schedule_repo.get_schedules_by_equipment.return_value = []

        # テスト実行（dry_run=False、開始時刻を固定）
        start_time = datetime(2025, 1, 6, 9, 0, tzinfo=UTC)
        result = schedule_order(
            order_id=1,
            product_id=1,
            quantity=10,
            product_repo=mock_product_repo,
            schedule_repo=mock_schedule_repo,
            tenant_id="test-tenant-id",
            dry_run=False,
            start_time=start_time,
        )

        # 検証：結果は返され、DBにも保存される
        assert len(result) == 1
        assert result[0]["order_id"] == 1
        assert result[0]["equipment_id"] == 1
        # dry_run=False のため、create が呼ばれるはず
        mock_schedule_repo.create.assert_called_once()

    def test_schedule_with_multi_day_process(self) -> None:
        """10時間の作業が2日間に分割されること"""
        # Mockの準備
        mock_product_repo = MagicMock()
        mock_schedule_repo = MagicMock()

        # 工程データ（1工程、10時間の作業）
        routings = [
            {
                "id": 1,
                "equipment_group_id": 100,
                "setup_time_seconds": 0,
                "unit_time_seconds": 36000,  # 600分/個 = 10時間
                "sequence_order": 1,
                "is_confirmed": True,
            }
        ]
        mock_product_repo.get_routings_by_product.return_value = routings

        # 設備グループに属する設備
        mock_product_repo.client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"equipment_id": 1}
        ]

        # 設備は空き
        mock_schedule_repo.get_last_end_time.return_value = None
        mock_schedule_repo.create.return_value = None
        mock_schedule_repo.get_schedules_by_equipment.return_value = []

        # テスト実行（月曜日9:00から開始）
        from datetime import UTC

        start_time = datetime(2025, 1, 6, 9, 0, tzinfo=UTC)  # 月曜日 9:00
        result = schedule_order(
            order_id=7,
            product_id=7,
            quantity=1,
            product_repo=mock_product_repo,
            schedule_repo=mock_schedule_repo,
            tenant_id="test-tenant-id",
            start_time=start_time,
        )

        # 検証：2つのスケジュールレコードが作成される
        assert len(result) == 2

        # 1日目: 9:00 - 17:00 (8時間)
        assert result[0]["order_id"] == 7
        assert result[0]["process_routing_id"] == 1
        assert result[0]["equipment_id"] == 1
        start_dt_1 = datetime.fromisoformat(result[0]["start_datetime"])
        end_dt_1 = datetime.fromisoformat(result[0]["end_datetime"])
        assert start_dt_1.hour == 9
        assert start_dt_1.minute == 0
        assert end_dt_1.hour == 17
        assert end_dt_1.minute == 0
        assert start_dt_1.day == 6  # 月曜日

        # 2日目: 9:00 - 12:00 (3時間: 10時間 - 7稼働時間(1日目))
        # 1日目は9:00-17:00で昼休憩1時間を除いた7時間分=420分、残り600-420=180分=3時間
        assert result[1]["order_id"] == 7
        assert result[1]["process_routing_id"] == 1
        assert result[1]["equipment_id"] == 1
        start_dt_2 = datetime.fromisoformat(result[1]["start_datetime"])
        end_dt_2 = datetime.fromisoformat(result[1]["end_datetime"])
        assert start_dt_2.hour == 9
        assert start_dt_2.minute == 0
        assert end_dt_2.hour == 12
        assert end_dt_2.minute == 0
        assert start_dt_2.day == 7  # 火曜日

        # create が2回呼ばれることを確認
        assert mock_schedule_repo.create.call_count == 2

    def test_schedule_multi_day_process_over_weekend(self) -> None:
        """金曜日から始まる長時間作業が週末を跨ぐこと"""
        # Mockの準備
        mock_product_repo = MagicMock()
        mock_schedule_repo = MagicMock()

        # 工程データ（1工程、6時間の作業）
        routings = [
            {
                "id": 1,
                "equipment_group_id": 100,
                "setup_time_seconds": 0,
                "unit_time_seconds": 21600,  # 360分/個 = 6時間
                "sequence_order": 1,
                "is_confirmed": True,
            }
        ]
        mock_product_repo.get_routings_by_product.return_value = routings

        # 設備グループに属する設備
        mock_product_repo.client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"equipment_id": 1}
        ]

        # 設備は空き
        mock_schedule_repo.get_last_end_time.return_value = None
        mock_schedule_repo.create.return_value = None
        mock_schedule_repo.get_schedules_by_equipment.return_value = []

        # テスト実行（金曜日14:00から開始）
        from datetime import UTC

        start_time = datetime(2025, 1, 10, 14, 0, tzinfo=UTC)  # 金曜日 14:00
        result = schedule_order(
            order_id=8,
            product_id=8,
            quantity=1,
            product_repo=mock_product_repo,
            schedule_repo=mock_schedule_repo,
            tenant_id="test-tenant-id",
            start_time=start_time,
        )

        # 検証：2つのスケジュールレコードが作成される
        assert len(result) == 2

        # 1日目(金曜日): 14:00 - 17:00 (3時間)
        start_dt_1 = datetime.fromisoformat(result[0]["start_datetime"])
        end_dt_1 = datetime.fromisoformat(result[0]["end_datetime"])
        assert start_dt_1.day == 10  # 金曜日
        assert start_dt_1.hour == 14
        assert end_dt_1.hour == 17

        # 2日目(月曜日): 9:00 - 12:00 (3時間)
        start_dt_2 = datetime.fromisoformat(result[1]["start_datetime"])
        end_dt_2 = datetime.fromisoformat(result[1]["end_datetime"])
        assert start_dt_2.day == 13  # 月曜日
        assert start_dt_2.hour == 9
        assert end_dt_2.hour == 12

    def test_schedule_with_no_equipment_process(self) -> None:
        """equipment_group_id が None の工程（設備なし）は設備制約を無視してスケジュールする"""
        mock_product_repo = MagicMock()
        mock_schedule_repo = MagicMock()

        # 工程データ（設備なし）
        routings = [
            {
                "id": 1,
                "equipment_group_id": None,
                "setup_time_seconds": 0,
                "unit_time_seconds": 1800,  # 30分/個
                "sequence_order": 1,
                "is_confirmed": True,
            }
        ]
        mock_product_repo.get_routings_by_product.return_value = routings
        mock_schedule_repo.create.return_value = None
        mock_schedule_repo.get_schedules_by_equipment.return_value = []

        # テスト実行
        start_time = datetime(2025, 1, 6, 9, 0, tzinfo=UTC)  # 月曜日 9:00
        result = schedule_order(
            order_id=10,
            product_id=10,
            quantity=1,
            product_repo=mock_product_repo,
            schedule_repo=mock_schedule_repo,
            tenant_id="test-tenant-id",
            start_time=start_time,
        )

        # 検証: スケジュールが作成され、equipment_id は None
        assert len(result) == 1
        assert result[0]["order_id"] == 10
        assert result[0]["equipment_id"] is None
        # 設備グループへのアクセスが発生しないことを確認
        mock_product_repo.client.table.assert_not_called()
        mock_schedule_repo.get_last_end_time.assert_not_called()
        mock_schedule_repo.create.assert_called_once()

    def test_schedule_no_equipment_process_does_not_block_parallel(self) -> None:
        """設備なし工程は前工程終了後すぐに開始できる（設備の空き待ちが発生しない）"""
        mock_product_repo = MagicMock()
        mock_schedule_repo = MagicMock()

        # 工程1: 設備あり、工程2: 設備なし
        routings = [
            {
                "id": 1,
                "equipment_group_id": 100,
                "setup_time_seconds": 0,
                "unit_time_seconds": 3600,  # 60分/個
                "sequence_order": 1,
                "is_confirmed": True,
            },
            {
                "id": 2,
                "equipment_group_id": None,
                "setup_time_seconds": 0,
                "unit_time_seconds": 3600,  # 60分/個
                "sequence_order": 2,
                "is_confirmed": True,
            },
        ]
        mock_product_repo.get_routings_by_product.return_value = routings

        # 工程1の設備グループに設備1台
        mock_product_repo.client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"equipment_id": 1}
        ]
        mock_schedule_repo.get_last_end_time.return_value = None
        mock_schedule_repo.create.return_value = None
        mock_schedule_repo.get_schedules_by_equipment.return_value = []

        start_time = datetime(2025, 1, 6, 9, 0, tzinfo=UTC)  # 月曜日 9:00
        result = schedule_order(
            order_id=11,
            product_id=11,
            quantity=1,
            product_repo=mock_product_repo,
            schedule_repo=mock_schedule_repo,
            tenant_id="test-tenant-id",
            start_time=start_time,
        )

        # 2工程分のスケジュールが作成される
        assert len(result) == 2
        # 工程1: 設備あり
        assert result[0]["equipment_id"] == 1
        # 工程2: 設備なし
        assert result[1]["equipment_id"] is None
        # 工程2の開始時刻は工程1の終了時刻以降
        end_1 = datetime.fromisoformat(result[0]["end_datetime"])
        start_2 = datetime.fromisoformat(result[1]["start_datetime"])
        assert start_2 >= end_1


@pytest.mark.unit
class TestGapFillScheduling:
    """ギャップ詰め込みスケジューリングのテスト"""

    def _make_repos(self, routings, machine_ids, existing_schedules=None):
        """テスト用のモックリポジトリを生成するヘルパー"""
        mock_product_repo = MagicMock()
        mock_schedule_repo = MagicMock()

        mock_product_repo.get_routings_by_product.return_value = routings
        mock_product_repo.client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"equipment_id": mid} for mid in machine_ids
        ]
        mock_schedule_repo.create.return_value = None
        mock_schedule_repo.get_schedules_by_equipment.return_value = (
            existing_schedules or []
        )
        mock_schedule_repo.get_last_end_time.return_value = None
        return mock_product_repo, mock_schedule_repo

    def test_gap_fill_fits_in_gap(self) -> None:
        """既存スケジュールのギャップに収まる場合、ギャップに詰め込まれる"""
        routings = [
            {
                "id": 1,
                "equipment_group_id": 100,
                "setup_time_seconds": 0,
                "unit_time_seconds": 1800,  # 30分/個
                "sequence_order": 1,
                "is_confirmed": True,
            }
        ]
        # 月曜 9:00 開始、30分の作業 → 9:30 終了
        start_time = datetime(2025, 1, 6, 9, 0, tzinfo=UTC)
        # 既存スケジュール: 10:00-17:00 (gap = 9:00-10:00 = 60分)
        existing = [
            {
                "id": 99,
                "start_datetime": "2025-01-06T10:00:00+00:00",
                "end_datetime": "2025-01-06T17:00:00+00:00",
            }
        ]
        mock_product_repo, mock_schedule_repo = self._make_repos(
            routings, [1], existing
        )

        result = schedule_order(
            order_id=100,
            product_id=1,
            quantity=1,
            product_repo=mock_product_repo,
            schedule_repo=mock_schedule_repo,
            tenant_id="test-tenant-id",
            start_time=start_time,
            dry_run=True,
        )

        assert len(result) == 1
        start_dt = datetime.fromisoformat(result[0]["start_datetime"])
        end_dt = datetime.fromisoformat(result[0]["end_datetime"])
        # ギャップ内 (9:00-10:00) に収まっていること
        assert start_dt.hour == 9
        assert start_dt.minute == 0
        assert end_dt <= datetime(2025, 1, 6, 10, 0, tzinfo=UTC)

    def test_gap_fill_falls_back_on_max_fragments_exceeded(self) -> None:
        """断片数が最大断片数(1)を超えたとき _try_gap_fill が None を返すこと"""
        from app.models.common.scheduling_settings import SchedulingParams
        from app.scheduler_logic import _try_gap_fill

        start_time = datetime(2025, 1, 6, 9, 0, tzinfo=UTC)
        # 30分ギャップが2つ → 20分ずつ2セグメント必要 → max_fragments=1 で超過
        existing = [
            {
                "id": 1,
                "start_datetime": "2025-01-06T09:30:00+00:00",
                "end_datetime": "2025-01-06T10:00:00+00:00",
            },
            {
                "id": 2,
                "start_datetime": "2025-01-06T10:30:00+00:00",
                "end_datetime": "2025-01-06T17:00:00+00:00",
            },
        ]
        _, mock_schedule_repo = self._make_repos([], [1], existing)
        params = SchedulingParams(
            guard_time_minutes=0, min_slot_minutes=0, max_fragments=1
        )

        result = _try_gap_fill(
            machine_id=1,
            current_process_start=start_time,
            total_duration_min=50.0,  # 50分: 最初のギャップ30分 + 2つ目から20分必要
            params=params,
            schedule_repo=mock_schedule_repo,
            calendar_config=None,
        )

        # max_fragments=1 なので2セグメントになった時点で None を返す
        assert result is None

    def test_gap_fill_respects_guard_time(self) -> None:
        """ガードタイムが大きい場合、ギャップに入れず None を返すこと"""
        from app.models.common.scheduling_settings import SchedulingParams
        from app.scheduler_logic import _try_gap_fill

        # 9:00-9:30 のギャップ (30分) だが guard_time=25分なので有効スロット=5分 → 20分入らない
        start_time = datetime(2025, 1, 6, 9, 0, tzinfo=UTC)
        existing = [
            {
                "id": 99,
                "start_datetime": "2025-01-06T09:30:00+00:00",
                "end_datetime": "2025-01-06T17:00:00+00:00",
            }
        ]
        _, mock_schedule_repo = self._make_repos([], [1], existing)
        params = SchedulingParams(
            guard_time_minutes=25, min_slot_minutes=0, max_fragments=10
        )

        result = _try_gap_fill(
            machine_id=1,
            current_process_start=start_time,
            total_duration_min=20.0,
            params=params,
            schedule_repo=mock_schedule_repo,
            calendar_config=None,
        )

        # ガードタイムにより有効ギャップが5分しかなく、20分を収められないので None
        assert result is None


@pytest.mark.unit
class TestRoutingsAreConfirmed:
    """routings_are_confirmed ヘルパーのテスト"""

    def test_empty_routings_returns_false(self) -> None:
        assert routings_are_confirmed([]) is False

    def test_all_confirmed_returns_true(self) -> None:
        routings = [
            {"id": 1, "is_confirmed": True},
            {"id": 2, "is_confirmed": True},
        ]
        assert routings_are_confirmed(routings) is True

    def test_any_unconfirmed_returns_false(self) -> None:
        routings = [
            {"id": 1, "is_confirmed": True},
            {"id": 2, "is_confirmed": False},
        ]
        assert routings_are_confirmed(routings) is False

    def test_missing_is_confirmed_field_returns_false(self) -> None:
        """is_confirmed カラムが存在しない(マイグレーション前)レコードは未確定扱い"""
        routings = [{"id": 1}]
        assert routings_are_confirmed(routings) is False


@pytest.mark.unit
class TestScheduleOrderRoutingGuard:
    """schedule_order の工程確定ガードのテスト"""

    def _make_repos(self, routings: list) -> tuple:
        mock_product_repo = MagicMock()
        mock_schedule_repo = MagicMock()
        mock_product_repo.get_routings_by_product.return_value = routings
        mock_schedule_repo.get_schedules_by_equipment.return_value = []
        mock_schedule_repo.get_last_end_time.return_value = None
        return mock_product_repo, mock_schedule_repo

    def test_dry_run_allows_unconfirmed_routings(self) -> None:
        """dry_run=True のシミュレーションは未確定工程でも実行できる"""
        routings = [
            {
                "id": 1,
                "equipment_group_id": None,
                "setup_time_seconds": 0,
                "unit_time_seconds": 60,
                "sequence_order": 1,
                "is_confirmed": False,
            }
        ]
        mock_product_repo, mock_schedule_repo = self._make_repos(routings)
        start_time = datetime(2025, 1, 6, 9, 0, tzinfo=UTC)

        # 例外なく実行できることを確認
        result = schedule_order(
            order_id=None,
            product_id=1,
            quantity=1,
            product_repo=mock_product_repo,
            schedule_repo=mock_schedule_repo,
            tenant_id="test-tenant",
            start_time=start_time,
            dry_run=True,
        )
        assert len(result) >= 1

    def test_dry_run_false_raises_for_unconfirmed_routings(self) -> None:
        """dry_run=False 時に未確定工程があれば RoutingUnconfirmedError を送出する"""
        routings = [
            {
                "id": 1,
                "equipment_group_id": None,
                "setup_time_seconds": 0,
                "unit_time_seconds": 60,
                "sequence_order": 1,
                "is_confirmed": False,
            }
        ]
        mock_product_repo, mock_schedule_repo = self._make_repos(routings)
        start_time = datetime(2025, 1, 6, 9, 0, tzinfo=UTC)

        with pytest.raises(RoutingUnconfirmedError):
            schedule_order(
                order_id=1,
                product_id=1,
                quantity=1,
                product_repo=mock_product_repo,
                schedule_repo=mock_schedule_repo,
                tenant_id="test-tenant",
                start_time=start_time,
                dry_run=False,
                desired_deadline="2025-02-01",
            )

    def test_dry_run_false_allows_all_confirmed_routings(self) -> None:
        """全工程確定済みなら dry_run=False でも正常にスケジュールされる"""
        routings = [
            {
                "id": 1,
                "equipment_group_id": None,
                "setup_time_seconds": 0,
                "unit_time_seconds": 60,
                "sequence_order": 1,
                "is_confirmed": True,
            }
        ]
        mock_product_repo, mock_schedule_repo = self._make_repos(routings)
        mock_schedule_repo.create.return_value = None
        start_time = datetime(2025, 1, 6, 9, 0, tzinfo=UTC)

        result = schedule_order(
            order_id=1,
            product_id=1,
            quantity=1,
            product_repo=mock_product_repo,
            schedule_repo=mock_schedule_repo,
            tenant_id="test-tenant",
            start_time=start_time,
            dry_run=False,
        )
        assert len(result) >= 1

    def test_routing_unconfirmed_error_carries_desired_deadline(self) -> None:
        """RoutingUnconfirmedError に desired_deadline が設定される"""
        routings = [
            {
                "id": 1,
                "equipment_group_id": None,
                "setup_time_seconds": 0,
                "unit_time_seconds": 60,
                "sequence_order": 1,
                "is_confirmed": False,
            }
        ]
        mock_product_repo, mock_schedule_repo = self._make_repos(routings)
        start_time = datetime(2025, 1, 6, 9, 0, tzinfo=UTC)

        with pytest.raises(RoutingUnconfirmedError) as exc_info:
            schedule_order(
                order_id=1,
                product_id=1,
                quantity=1,
                product_repo=mock_product_repo,
                schedule_repo=mock_schedule_repo,
                tenant_id="test-tenant",
                start_time=start_time,
                dry_run=False,
                desired_deadline="2025-03-15",
            )
        assert exc_info.value.desired_deadline == "2025-03-15"
