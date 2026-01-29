# models/common/work_calendar.py
from datetime import date

from pydantic import BaseModel, Field


class WorkCalendarBase(BaseModel):
    """稼働カレンダーの基本スキーマ"""

    date: date = Field(..., description="日付")
    is_holiday: bool = Field(default=False, description="休日フラグ")
    note: str | None = Field(None, description="備考")


class WorkCalendarCreate(WorkCalendarBase):
    """稼働カレンダー作成用スキーマ"""

    pass


class WorkCalendarUpdate(BaseModel):
    """稼働カレンダー更新用スキーマ"""

    is_holiday: bool | None = Field(None, description="休日フラグ")
    note: str | None = Field(None, description="備考")


class WorkCalendar(WorkCalendarBase):
    """稼働カレンダー（レスポンス用）"""

    id: int
    tenant_id: str

    class Config:
        from_attributes = True
