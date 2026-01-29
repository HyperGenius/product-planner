"""
稼働カレンダーユーティリティの単体テスト
"""

from datetime import datetime

import pytest

from app.utils.calendar import (
    calculate_end_time,
    get_next_available_start_time,
    get_next_work_start,
    is_workday,
    split_work_across_days,
)


@pytest.mark.unit
class TestIsWorkday:
    """is_workday関数のテスト"""

    @pytest.mark.parametrize(
        "date_str, expected",
        [
            # 平日のテスト
            ("2025-01-06", True),  # 月曜日
            ("2025-01-07", True),  # 火曜日
            ("2025-01-08", True),  # 水曜日
            ("2025-01-09", True),  # 木曜日
            ("2025-01-10", True),  # 金曜日
            # 週末のテスト
            ("2025-01-11", False),  # 土曜日
            ("2025-01-12", False),  # 日曜日
        ],
    )
    def test_workday_detection(self, date_str: str, expected: bool) -> None:
        """曜日判定のテスト"""
        dt = datetime.fromisoformat(f"{date_str}T10:00:00")
        assert is_workday(dt) == expected


@pytest.mark.unit
class TestGetNextWorkStart:
    """get_next_work_start関数のテスト"""

    def test_weekday_before_work_hours(self) -> None:
        """平日の始業前の場合、その日の9:00を返す"""
        dt = datetime(2025, 1, 6, 8, 30)  # 月曜日 8:30
        result = get_next_work_start(dt)
        assert result == datetime(2025, 1, 6, 9, 0)

    def test_weekday_during_work_hours(self) -> None:
        """平日の稼働時間中の場合、翌営業日の9:00を返す"""
        dt = datetime(2025, 1, 6, 10, 30)  # 月曜日 10:30
        result = get_next_work_start(dt)
        assert result == datetime(2025, 1, 7, 9, 0)  # 火曜日 9:00

    def test_weekday_after_work_hours(self) -> None:
        """平日の終業後の場合、翌営業日の9:00を返す"""
        dt = datetime(2025, 1, 6, 18, 0)  # 月曜日 18:00
        result = get_next_work_start(dt)
        assert result == datetime(2025, 1, 7, 9, 0)  # 火曜日 9:00

    def test_friday_evening_to_monday(self) -> None:
        """金曜日の夕方から月曜日の朝へ"""
        dt = datetime(2025, 1, 10, 18, 0)  # 金曜日 18:00
        result = get_next_work_start(dt)
        assert result == datetime(2025, 1, 13, 9, 0)  # 月曜日 9:00

    def test_saturday_to_monday(self) -> None:
        """土曜日から月曜日の朝へ"""
        dt = datetime(2025, 1, 11, 10, 0)  # 土曜日 10:00
        result = get_next_work_start(dt)
        assert result == datetime(2025, 1, 13, 9, 0)  # 月曜日 9:00

    def test_sunday_to_monday(self) -> None:
        """日曜日から月曜日の朝へ"""
        dt = datetime(2025, 1, 12, 10, 0)  # 日曜日 10:00
        result = get_next_work_start(dt)
        assert result == datetime(2025, 1, 13, 9, 0)  # 月曜日 9:00


@pytest.mark.unit
class TestGetNextAvailableStartTime:
    """get_next_available_start_time関数のテスト"""

    def test_weekday_morning_short_task(self) -> None:
        """平日朝、短時間作業の場合はそのまま開始"""
        current_dt = datetime(2025, 1, 6, 10, 0)  # 月曜日 10:00
        duration = 60  # 1時間
        result = get_next_available_start_time(current_dt, duration)
        assert result == current_dt

    def test_weekday_afternoon_task_fits(self) -> None:
        """平日午後、作業が17:00以内に収まる場合"""
        current_dt = datetime(2025, 1, 6, 15, 0)  # 月曜日 15:00
        duration = 90  # 1.5時間 → 16:30に終了
        result = get_next_available_start_time(current_dt, duration)
        assert result == current_dt

    def test_weekday_afternoon_task_overflows(self) -> None:
        """平日午後、作業が17:00を超える場合でも当日から開始（分割処理に任せる）"""
        current_dt = datetime(2025, 1, 6, 15, 0)  # 月曜日 15:00
        duration = 150  # 2.5時間 → 17:30になるが、split_work_across_daysで分割処理される
        result = get_next_available_start_time(current_dt, duration)
        assert result == current_dt  # 当日から開始

    def test_weekday_just_before_end_time(self) -> None:
        """17:00ちょうどを超える場合でも当日から開始"""
        current_dt = datetime(2025, 1, 6, 16, 30)  # 月曜日 16:30
        duration = 30  # 30分 → 17:00ちょうど
        result = get_next_available_start_time(current_dt, duration)
        assert result == current_dt

    def test_weekday_exceeds_end_time_by_one_minute(self) -> None:
        """17:00を1分でも超える場合でも当日から開始（分割処理に任せる）"""
        current_dt = datetime(2025, 1, 6, 16, 30)  # 月曜日 16:30
        duration = 31  # 31分 → 17:01になるが、当日から開始
        result = get_next_available_start_time(current_dt, duration)
        assert result == current_dt

    def test_before_work_hours_on_weekday(self) -> None:
        """平日の始業前の場合、その日の9:00から開始"""
        current_dt = datetime(2025, 1, 6, 8, 0)  # 月曜日 8:00
        duration = 60  # 1時間
        result = get_next_available_start_time(current_dt, duration)
        assert result == datetime(2025, 1, 6, 9, 0)  # 月曜日 9:00

    def test_after_work_hours_on_weekday(self) -> None:
        """平日の終業後の場合、翌営業日の9:00から開始"""
        current_dt = datetime(2025, 1, 6, 18, 0)  # 月曜日 18:00
        duration = 60  # 1時間
        result = get_next_available_start_time(current_dt, duration)
        assert result == datetime(2025, 1, 7, 9, 0)  # 火曜日 9:00

    def test_weekend_to_monday(self) -> None:
        """週末の場合、月曜日の9:00から開始"""
        current_dt = datetime(2025, 1, 11, 10, 0)  # 土曜日 10:00
        duration = 60  # 1時間
        result = get_next_available_start_time(current_dt, duration)
        assert result == datetime(2025, 1, 13, 9, 0)  # 月曜日 9:00

    def test_friday_evening_long_task(self) -> None:
        """金曜日の夕方で長時間作業の場合でも、当日から開始（分割処理に任せる）"""
        current_dt = datetime(2025, 1, 10, 16, 0)  # 金曜日 16:00
        duration = 120  # 2時間 → 18:00になるが、split_work_across_daysで分割処理される
        result = get_next_available_start_time(current_dt, duration)
        assert result == current_dt  # 当日から開始

    def test_long_duration_task(self) -> None:
        """所要時間が8時間を超える場合でも開始時刻を返す（分割は別関数で処理）"""
        current_dt = datetime(2025, 1, 6, 10, 0)  # 月曜日 10:00
        duration = 9 * 60  # 9時間
        # get_next_available_start_time は開始時刻のみを判定
        # 8時間を超える場合は、その日から開始できる
        result = get_next_available_start_time(current_dt, duration)
        assert result == current_dt  # その日の10:00から開始

    def test_duration_exactly_8_hours(self) -> None:
        """所要時間がちょうど8時間の場合"""
        current_dt = datetime(2025, 1, 6, 9, 0)  # 月曜日 9:00
        duration = 8 * 60  # 8時間
        result = get_next_available_start_time(current_dt, duration)
        assert result == current_dt  # 9:00から開始して17:00に終了


@pytest.mark.unit
class TestCalculateEndTime:
    """calculate_end_time関数のテスト"""

    def test_simple_calculation(self) -> None:
        """シンプルな終了時刻計算"""
        start_dt = datetime(2025, 1, 6, 10, 0)  # 月曜日 10:00
        duration = 120  # 2時間
        result = calculate_end_time(start_dt, duration)
        assert result == datetime(2025, 1, 6, 12, 0)  # 月曜日 12:00

    def test_calculation_with_minutes(self) -> None:
        """分単位の計算"""
        start_dt = datetime(2025, 1, 6, 14, 30)  # 月曜日 14:30
        duration = 90  # 1.5時間
        result = calculate_end_time(start_dt, duration)
        assert result == datetime(2025, 1, 6, 16, 0)  # 月曜日 16:00

    def test_end_time_exactly_at_work_end(self) -> None:
        """終了時刻がちょうど17:00の場合"""
        start_dt = datetime(2025, 1, 6, 9, 0)  # 月曜日 9:00
        duration = 8 * 60  # 8時間
        result = calculate_end_time(start_dt, duration)
        assert result == datetime(2025, 1, 6, 17, 0)  # 月曜日 17:00

    def test_start_before_work_hours_raises_error(self) -> None:
        """始業前の開始時刻はエラー"""
        start_dt = datetime(2025, 1, 6, 8, 0)  # 月曜日 8:00
        duration = 60  # 1時間
        with pytest.raises(ValueError, match="開始時刻が稼働時間"):
            calculate_end_time(start_dt, duration)

    def test_start_at_work_end_raises_error(self) -> None:
        """終業時刻での開始はエラー"""
        start_dt = datetime(2025, 1, 6, 17, 0)  # 月曜日 17:00
        duration = 60  # 1時間
        with pytest.raises(ValueError, match="開始時刻が稼働時間"):
            calculate_end_time(start_dt, duration)

    def test_start_after_work_hours_raises_error(self) -> None:
        """終業後の開始時刻はエラー"""
        start_dt = datetime(2025, 1, 6, 18, 0)  # 月曜日 18:00
        duration = 60  # 1時間
        with pytest.raises(ValueError, match="開始時刻が稼働時間"):
            calculate_end_time(start_dt, duration)

    def test_start_on_weekend_raises_error(self) -> None:
        """週末の開始はエラー"""
        start_dt = datetime(2025, 1, 11, 10, 0)  # 土曜日 10:00
        duration = 60  # 1時間
        with pytest.raises(ValueError, match="開始日時が稼働日ではありません"):
            calculate_end_time(start_dt, duration)

    def test_end_time_exceeds_work_end_raises_error(self) -> None:
        """終了時刻が17:00を超える場合はエラー"""
        start_dt = datetime(2025, 1, 6, 16, 0)  # 月曜日 16:00
        duration = 90  # 1.5時間 → 17:30になるためエラー
        with pytest.raises(ValueError, match="作業が稼働時間を超えます"):
            calculate_end_time(start_dt, duration)

    def test_precise_minute_calculation(self) -> None:
        """分単位での精密な計算"""
        start_dt = datetime(2025, 1, 6, 13, 15)  # 月曜日 13:15
        duration = 45  # 45分
        result = calculate_end_time(start_dt, duration)
        assert result == datetime(2025, 1, 6, 14, 0)  # 月曜日 14:00


@pytest.mark.unit
class TestSplitWorkAcrossDays:
    """split_work_across_days関数のテスト"""

    def test_work_fits_in_single_day(self) -> None:
        """作業が1日以内に収まる場合"""
        start_dt = datetime(2025, 1, 6, 9, 0)  # 月曜日 9:00
        duration = 4 * 60  # 4時間

        result = split_work_across_days(start_dt, duration)
        assert len(result) == 1
        assert result[0][0] == datetime(2025, 1, 6, 9, 0)  # 開始
        assert result[0][1] == datetime(2025, 1, 6, 13, 0)  # 終了

    def test_work_exactly_one_day(self) -> None:
        """作業がちょうど1日（8時間）の場合"""
        start_dt = datetime(2025, 1, 6, 9, 0)  # 月曜日 9:00
        duration = 8 * 60  # 8時間

        result = split_work_across_days(start_dt, duration)
        assert len(result) == 1
        assert result[0][0] == datetime(2025, 1, 6, 9, 0)  # 開始
        assert result[0][1] == datetime(2025, 1, 6, 17, 0)  # 終了

    def test_work_splits_across_two_days(self) -> None:
        """作業が2日間にまたがる場合（10時間）"""
        start_dt = datetime(2025, 1, 6, 9, 0)  # 月曜日 9:00
        duration = 10 * 60  # 10時間

        result = split_work_across_days(start_dt, duration)
        assert len(result) == 2
        # 1日目: 9:00 - 17:00 (8時間)
        assert result[0][0] == datetime(2025, 1, 6, 9, 0)
        assert result[0][1] == datetime(2025, 1, 6, 17, 0)
        # 2日目: 9:00 - 11:00 (2時間)
        assert result[1][0] == datetime(2025, 1, 7, 9, 0)
        assert result[1][1] == datetime(2025, 1, 7, 11, 0)

    def test_work_splits_across_three_days(self) -> None:
        """作業が3日間にまたがる場合（20時間）"""
        start_dt = datetime(2025, 1, 6, 9, 0)  # 月曜日 9:00
        duration = 20 * 60  # 20時間

        result = split_work_across_days(start_dt, duration)
        assert len(result) == 3
        # 1日目: 9:00 - 17:00 (8時間)
        assert result[0][0] == datetime(2025, 1, 6, 9, 0)
        assert result[0][1] == datetime(2025, 1, 6, 17, 0)
        # 2日目: 9:00 - 17:00 (8時間)
        assert result[1][0] == datetime(2025, 1, 7, 9, 0)
        assert result[1][1] == datetime(2025, 1, 7, 17, 0)
        # 3日目: 9:00 - 13:00 (4時間)
        assert result[2][0] == datetime(2025, 1, 8, 9, 0)
        assert result[2][1] == datetime(2025, 1, 8, 13, 0)

    def test_work_starting_mid_day(self) -> None:
        """作業が日中から開始する場合"""
        start_dt = datetime(2025, 1, 6, 14, 0)  # 月曜日 14:00
        duration = 6 * 60  # 6時間

        result = split_work_across_days(start_dt, duration)
        assert len(result) == 2
        # 1日目: 14:00 - 17:00 (3時間)
        assert result[0][0] == datetime(2025, 1, 6, 14, 0)
        assert result[0][1] == datetime(2025, 1, 6, 17, 0)
        # 2日目: 9:00 - 12:00 (3時間)
        assert result[1][0] == datetime(2025, 1, 7, 9, 0)
        assert result[1][1] == datetime(2025, 1, 7, 12, 0)

    def test_work_over_weekend(self) -> None:
        """金曜日から始まり、週末を跨ぐ場合"""
        start_dt = datetime(2025, 1, 10, 14, 0)  # 金曜日 14:00
        duration = 6 * 60  # 6時間

        result = split_work_across_days(start_dt, duration)
        assert len(result) == 2
        # 1日目(金曜日): 14:00 - 17:00 (3時間)
        assert result[0][0] == datetime(2025, 1, 10, 14, 0)
        assert result[0][1] == datetime(2025, 1, 10, 17, 0)
        # 2日目(月曜日): 9:00 - 12:00 (3時間)
        assert result[1][0] == datetime(2025, 1, 13, 9, 0)
        assert result[1][1] == datetime(2025, 1, 13, 12, 0)

    def test_start_before_work_hours_raises_error(self) -> None:
        """始業前の開始時刻はエラー"""
        start_dt = datetime(2025, 1, 6, 8, 0)  # 月曜日 8:00
        duration = 60  # 1時間

        with pytest.raises(ValueError, match="開始時刻が稼働時間"):
            split_work_across_days(start_dt, duration)

    def test_start_on_weekend_raises_error(self) -> None:
        """週末の開始はエラー"""
        start_dt = datetime(2025, 1, 11, 10, 0)  # 土曜日 10:00
        duration = 60  # 1時間

        with pytest.raises(ValueError, match="開始日時が稼働日ではありません"):
            split_work_across_days(start_dt, duration)

    def test_zero_duration_raises_error(self) -> None:
        """所要時間が0の場合はエラー"""
        start_dt = datetime(2025, 1, 6, 9, 0)  # 月曜日 9:00
        duration = 0

        with pytest.raises(ValueError, match="所要時間は正の値である必要があります"):
            split_work_across_days(start_dt, duration)

    def test_negative_duration_raises_error(self) -> None:
        """所要時間が負の場合はエラー"""
        start_dt = datetime(2025, 1, 6, 9, 0)  # 月曜日 9:00
        duration = -60

        with pytest.raises(ValueError, match="所要時間は正の値である必要があります"):
            split_work_across_days(start_dt, duration)
