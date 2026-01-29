"""
稼働カレンダー取得ヘルパー

CalendarConfig を CalendarRepository から構築するユーティリティ関数。
"""

from datetime import date, datetime, timedelta

from app.repositories.supa_infra.common.calendar_repo import CalendarRepository
from app.utils.calendar import CalendarConfig


def build_calendar_config(
    calendar_repo: CalendarRepository,
    start_date: date | None = None,
    end_date: date | None = None,
    days_ahead: int = 90,
) -> CalendarConfig:
    """
    CalendarRepository から休日情報を取得し、CalendarConfig を構築する。

    Args:
        calendar_repo: カレンダーリポジトリ
        start_date: 取得開始日（Noneの場合は今日）
        end_date: 取得終了日（Noneの場合はstart_date + days_ahead）
        days_ahead: start_dateがNoneの場合に使用する期間（デフォルト90日）

    Returns:
        CalendarConfig: 休日情報と稼働日情報が設定されたカレンダー設定
    """
    # デフォルトの期間を設定
    if start_date is None:
        start_date = datetime.now().date()
    if end_date is None:
        end_date = start_date + timedelta(days=days_ahead)

    # データベースから休日情報を取得
    holidays_data = calendar_repo.get_holidays_in_range(start_date, end_date)

    # is_holiday=True の日付を休日セット、is_holiday=False の日付を稼働日セットに分類
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

    return CalendarConfig(holidays=holidays, workdays=workdays)
