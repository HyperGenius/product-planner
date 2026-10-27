# models/transaction/schedule_shift.py
"""工程の前倒し・後ろ倒し（Issue #582）。Frontend の `types/schedule-shift.ts` と揃える"""

from datetime import date

from pydantic import BaseModel, Field, field_validator

from app.services.schedule_shift_service import MAX_SHIFT_WORKING_DAYS


class ProcessShiftRequest(BaseModel):
    working_days: int = Field(
        ...,
        ge=-MAX_SHIFT_WORKING_DAYS,
        le=MAX_SHIFT_WORKING_DAYS,
        description="ずらす稼働日（負は前倒し、0 は不可）",
    )
    dry_run: bool = Field(True, description="true はプレビュー（保存しない）")

    @field_validator("working_days")
    @classmethod
    def _non_zero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("working_days must not be 0")
        return value


class ShiftTimeRange(BaseModel):
    start_datetime: str
    end_datetime: str


class ShiftSegment(BaseModel):
    start_datetime: str
    end_datetime: str
    equipment_id: int | None = None


class ShiftedProcessItem(BaseModel):
    process_routing_id: int
    process_name: str | None = None
    sequence_order: int | None = None
    is_milestone: bool
    is_completed: bool = Field(
        ..., description="日報の進捗で完了済み（動かせるが警告する）"
    )
    before: ShiftTimeRange
    after: ShiftTimeRange
    segments: list[ShiftSegment]


class ShiftOverlapItem(BaseModel):
    """ずらした後の工程と同じ設備で時間が重なる、他の注文のセグメント（保存は妨げない）"""

    process_routing_id: int
    process_name: str | None = None
    equipment_id: int
    equipment_name: str | None = None
    other_order_id: int
    other_order_number: str | None = None
    other_process_name: str | None = None
    start_datetime: str
    end_datetime: str


class ProcessShiftResponse(BaseModel):
    order_id: int
    process_routing_id: int
    working_days: int
    stopped_at_previous: bool = Field(..., description="前倒しが前工程の終了で止まった")
    processes: list[ShiftedProcessItem] = Field(
        ..., description="動く工程（対象＋同じ注文の後工程、工程順）"
    )
    confirmed_deadline_before: date | None = None
    confirmed_deadline_after: date
    desired_deadline: date | None = None
    exceeds_desired_deadline: bool
    overlaps: list[ShiftOverlapItem]
    saved: bool
