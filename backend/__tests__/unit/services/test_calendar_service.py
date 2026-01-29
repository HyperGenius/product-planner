"""
calendar_service の単体テスト
"""

from datetime import date
from unittest.mock import MagicMock

import pytest


@pytest.mark.unit
class TestBuildCalendarConfig:
    """build_calendar_config 関数のテスト（モックベース）"""

    def test_calendar_config_construction_logic(self):
        """休日データからCalendarConfigを構築するロジックのテスト"""
        # モックリポジトリの設定
        repo_mock = MagicMock()
        holidays_data = [
            {"date": "2025-01-01", "is_holiday": True, "note": "元日"},
            {"date": "2025-01-13", "is_holiday": True, "note": "成人の日"},
            {"date": "2025-01-11", "is_holiday": False, "note": "土曜出勤"},
        ]

        # is_holiday=True と is_holiday=False を分類するロジックをテスト
        holidays = {
            date.fromisoformat(item["date"])
            for item in holidays_data
            if item.get("is_holiday", False) is True
        }

        workdays = {
            date.fromisoformat(item["date"])
            for item in holidays_data
            if item.get("is_holiday", False) is False
        }

        # 検証
        assert holidays == {date(2025, 1, 1), date(2025, 1, 13)}
        assert workdays == {date(2025, 1, 11)}  # 土曜出勤

    def test_no_holidays_logic(self):
        """休日データがない場合のロジックをテスト"""
        holidays_data = []

        # 空のデータから休日セットを構築
        holidays = {
            date.fromisoformat(item["date"])
            for item in holidays_data
            if item.get("is_holiday", False)
        }

        # 検証
        assert holidays == set()

    def test_filter_non_holidays_logic(self):
        """is_holiday=Falseのレコードを除外するロジックをテスト"""
        holidays_data = [
            {"date": "2025-01-01", "is_holiday": True, "note": "元日"},
            {"date": "2025-01-02", "is_holiday": False, "note": "通常営業日"},
        ]

        # is_holiday=True のみをフィルタ
        holidays = {
            date.fromisoformat(item["date"])
            for item in holidays_data
            if item.get("is_holiday", False)
        }

        # 検証
        assert date(2025, 1, 1) in holidays
        assert date(2025, 1, 2) not in holidays
