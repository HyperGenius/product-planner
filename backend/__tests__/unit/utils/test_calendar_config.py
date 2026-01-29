"""
CalendarConfig と休日設定機能の単体テスト
"""

from datetime import date, datetime

import pytest

from app.utils.calendar import (
    CalendarConfig,
    calculate_end_time,
    calculate_remaining_work_minutes,
    get_next_available_start_time,
    get_next_work_start,
    is_workday,
    split_work_across_days,
)


@pytest.mark.unit
class TestCalendarConfig:
    """CalendarConfig クラスのテスト"""

    def test_default_config_weekday(self):
        """デフォルト設定（休日情報なし）で平日を判定"""
        config = CalendarConfig()
        dt = datetime(2025, 1, 6, 10, 0)  # 月曜日
        assert not config.is_holiday(dt)

    def test_default_config_weekend(self):
        """デフォルト設定（休日情報なし）で土日を判定"""
        config = CalendarConfig()
        saturday = datetime(2025, 1, 11, 10, 0)  # 土曜日
        sunday = datetime(2025, 1, 12, 10, 0)  # 日曜日
        assert config.is_holiday(saturday)
        assert config.is_holiday(sunday)

    def test_custom_holiday(self):
        """カスタム休日設定（祝日など）"""
        # 2025-01-13（月曜日）を休日として設定
        holidays = {date(2025, 1, 13)}
        config = CalendarConfig(holidays=holidays)

        monday = datetime(2025, 1, 13, 10, 0)  # 設定した休日
        assert config.is_holiday(monday)

    def test_custom_holiday_with_weekday(self):
        """通常は平日だが、カスタム設定で休日とした日を判定"""
        holidays = {date(2025, 1, 6)}  # 月曜日を休日に
        config = CalendarConfig(holidays=holidays)

        monday = datetime(2025, 1, 6, 10, 0)
        assert config.is_holiday(monday)

    def test_no_custom_holiday_weekday(self):
        """カスタム休日設定があっても、通常の平日は稼働日"""
        holidays = {date(2025, 1, 13)}  # 別の日を休日に
        config = CalendarConfig(holidays=holidays)

        tuesday = datetime(2025, 1, 7, 10, 0)  # 火曜日
        assert not config.is_holiday(tuesday)


@pytest.mark.unit
class TestIsWorkdayWithConfig:
    """is_workday関数（CalendarConfig対応）のテスト"""

    def test_workday_default(self):
        """デフォルト設定で平日判定"""
        dt = datetime(2025, 1, 6, 10, 0)  # 月曜日
        assert is_workday(dt) is True

    def test_weekend_default(self):
        """デフォルト設定で土日判定"""
        saturday = datetime(2025, 1, 11, 10, 0)
        assert is_workday(saturday) is False

    def test_custom_holiday_config(self):
        """カスタム休日設定を使用"""
        holidays = {date(2025, 1, 6)}  # 月曜日を休日に
        config = CalendarConfig(holidays=holidays)

        monday = datetime(2025, 1, 6, 10, 0)
        assert is_workday(monday, config) is False

    def test_workday_with_config(self):
        """カスタム設定ありでも通常の平日は稼働日"""
        holidays = {date(2025, 1, 13)}
        config = CalendarConfig(holidays=holidays)

        tuesday = datetime(2025, 1, 7, 10, 0)
        assert is_workday(tuesday, config) is True


@pytest.mark.unit
class TestGetNextWorkStartWithConfig:
    """get_next_work_start関数（CalendarConfig対応）のテスト"""

    def test_skip_custom_holiday(self):
        """カスタム休日をスキップして次の稼働日を取得"""
        # 2025-01-06（月曜日）を休日に設定
        holidays = {date(2025, 1, 6)}
        config = CalendarConfig(holidays=holidays)

        # 金曜日の夕方から → 月曜は休日なので火曜の朝
        friday_evening = datetime(2025, 1, 3, 18, 0)
        result = get_next_work_start(friday_evening, config)
        assert result == datetime(2025, 1, 7, 9, 0)  # 火曜日の9:00

    def test_skip_weekend_and_monday_holiday(self):
        """週末と月曜休日をスキップ"""
        # 2025-01-06（月曜日）を休日に設定
        holidays = {date(2025, 1, 6)}
        config = CalendarConfig(holidays=holidays)

        # 土曜日から → 月曜は休日なので火曜の朝
        saturday = datetime(2025, 1, 4, 10, 0)
        result = get_next_work_start(saturday, config)
        assert result == datetime(2025, 1, 7, 9, 0)  # 火曜日の9:00


@pytest.mark.unit
class TestSplitWorkAcrossDaysWithConfig:
    """split_work_across_days関数（CalendarConfig対応）のテスト"""

    def test_split_over_custom_holiday(self):
        """カスタム休日をまたぐ作業の分割"""
        # 2025-01-07（火曜日）を休日に設定
        holidays = {date(2025, 1, 7)}
        config = CalendarConfig(holidays=holidays)

        # 月曜日の午後から6時間の作業（火曜は休みなので水曜に繰越）
        start_dt = datetime(2025, 1, 6, 14, 0)  # 月曜日 14:00
        duration = 6 * 60  # 6時間

        result = split_work_across_days(start_dt, duration, config)

        # 1日目（月曜）: 14:00 - 17:00 (3時間)
        # 2日目（水曜）: 9:00 - 12:00 (3時間) ※火曜は休日
        assert len(result) == 2
        assert result[0][0] == datetime(2025, 1, 6, 14, 0)
        assert result[0][1] == datetime(2025, 1, 6, 17, 0)
        assert result[1][0] == datetime(2025, 1, 8, 9, 0)  # 水曜日
        assert result[1][1] == datetime(2025, 1, 8, 12, 0)

    def test_split_over_weekend_and_holiday(self):
        """週末と祝日をまたぐ作業の分割"""
        # 2025-01-06（月曜日）を休日に設定
        holidays = {date(2025, 1, 6)}
        config = CalendarConfig(holidays=holidays)

        # 金曜日の午後から6時間の作業（週末+月曜休みで火曜に繰越）
        start_dt = datetime(2025, 1, 3, 14, 0)  # 金曜日 14:00
        duration = 6 * 60  # 6時間

        result = split_work_across_days(start_dt, duration, config)

        # 1日目（金曜）: 14:00 - 17:00 (3時間)
        # 2日目（火曜）: 9:00 - 12:00 (3時間) ※土日月は休み
        assert len(result) == 2
        assert result[0][0] == datetime(2025, 1, 3, 14, 0)
        assert result[0][1] == datetime(2025, 1, 3, 17, 0)
        assert result[1][0] == datetime(2025, 1, 7, 9, 0)  # 火曜日
        assert result[1][1] == datetime(2025, 1, 7, 12, 0)


@pytest.mark.unit
class TestGetNextAvailableStartTimeWithConfig:
    """get_next_available_start_time関数（CalendarConfig対応）のテスト"""

    def test_on_custom_holiday(self):
        """カスタム休日の場合、次の稼働日から開始"""
        holidays = {date(2025, 1, 6)}  # 月曜日を休日に
        config = CalendarConfig(holidays=holidays)

        # 月曜日（休日）の10:00 → 火曜日の9:00から開始
        monday = datetime(2025, 1, 6, 10, 0)
        duration = 60
        result = get_next_available_start_time(monday, duration, config)
        assert result == datetime(2025, 1, 7, 9, 0)  # 火曜日の9:00


@pytest.mark.unit
class TestCalculateEndTimeWithConfig:
    """calculate_end_time関数（CalendarConfig対応）のテスト"""

    def test_raises_on_custom_holiday(self):
        """カスタム休日での開始はエラー"""
        holidays = {date(2025, 1, 6)}  # 月曜日を休日に
        config = CalendarConfig(holidays=holidays)

        start_dt = datetime(2025, 1, 6, 10, 0)  # 月曜日（休日）
        duration = 60

        with pytest.raises(ValueError, match="開始日時が平日ではありません"):
            calculate_end_time(start_dt, duration, config)


@pytest.mark.unit
class TestCalculateRemainingWorkMinutesWithConfig:
    """calculate_remaining_work_minutes関数（CalendarConfig対応）のテスト"""

    def test_raises_on_custom_holiday(self):
        """カスタム休日での計算はエラー"""
        holidays = {date(2025, 1, 6)}  # 月曜日を休日に
        config = CalendarConfig(holidays=holidays)

        start_dt = datetime(2025, 1, 6, 10, 0)  # 月曜日（休日）

        with pytest.raises(ValueError, match="開始日時が平日ではありません"):
            calculate_remaining_work_minutes(start_dt, config)
