# routers/master/calendars.py
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import get_current_tenant_id, get_supabase_client
from app.models.common.work_calendar import (
    WorkCalendar,
    WorkCalendarCreate,
    WorkCalendarUpdate,
)
from app.repositories.supa_infra.common.calendar_repo import CalendarRepository
from app.utils.logger import get_logger
from pydantic import BaseModel, Field
from supabase import Client

calendar_router = APIRouter(prefix="/calendars", tags=["Master (Calendars)"])

logger = get_logger(__name__)


class CalendarQueryParams(BaseModel):
    """カレンダー取得用のクエリパラメータ"""

    year: int = Field(..., description="年")
    month: int = Field(..., ge=1, le=12, description="月（1-12）")


class BatchUpdateRequest(BaseModel):
    """一括更新リクエスト"""

    dates: list[date] = Field(..., description="更新対象の日付リスト")
    is_holiday: bool = Field(..., description="休日フラグ")
    note: str | None = Field(None, description="備考")


def get_calendar_repo(client: Client = Depends(get_supabase_client)) -> CalendarRepository:
    """カレンダーリポジトリを取得する"""
    return CalendarRepository(client)


@calendar_router.get("/")
def get_calendars(
    year: int,
    month: int,
    repo: CalendarRepository = Depends(get_calendar_repo),
) -> list[dict[str, Any]]:
    """
    指定月のカレンダー情報を取得

    Args:
        year: 年
        month: 月（1-12）

    Returns:
        カレンダー情報のリスト
    """
    logger.info(f"Fetching calendars for {year}-{month}")

    # 月の最初の日と最後の日を計算
    start_date = date(year, month, 1)
    if month == 12:
        end_date = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        end_date = date(year, month + 1, 1) - timedelta(days=1)

    return repo.get_holidays_in_range(start_date, end_date)


@calendar_router.post("/")
def upsert_calendar(
    calendar_data: WorkCalendarCreate,
    tenant_id: str = Depends(get_current_tenant_id),
    repo: CalendarRepository = Depends(get_calendar_repo),
) -> dict[str, Any]:
    """
    カレンダー情報を作成または更新

    Args:
        calendar_data: カレンダーデータ
        tenant_id: テナントID
        repo: カレンダーリポジトリ

    Returns:
        作成/更新されたカレンダー情報
    """
    logger.info(f"Upserting calendar for {calendar_data.date}")
    return repo.create_or_update_holiday(
        tenant_id=tenant_id,
        target_date=calendar_data.date,
        is_holiday=calendar_data.is_holiday,
        note=calendar_data.note,
    )


@calendar_router.post("/batch")
def batch_update_calendars(
    batch_data: BatchUpdateRequest,
    tenant_id: str = Depends(get_current_tenant_id),
    repo: CalendarRepository = Depends(get_calendar_repo),
) -> dict[str, Any]:
    """
    複数日のカレンダー情報を一括更新

    Args:
        batch_data: 一括更新データ
        tenant_id: テナントID
        repo: カレンダーリポジトリ

    Returns:
        更新結果
    """
    logger.info(f"Batch updating {len(batch_data.dates)} dates")

    updated_count = 0
    for target_date in batch_data.dates:
        try:
            repo.create_or_update_holiday(
                tenant_id=tenant_id,
                target_date=target_date,
                is_holiday=batch_data.is_holiday,
                note=batch_data.note,
            )
            updated_count += 1
        except Exception as e:
            logger.error(f"Failed to update {target_date}: {e}")
            # 継続して処理する

    return {
        "updated_count": updated_count,
        "total_count": len(batch_data.dates),
    }
