from pydantic import BaseModel, Field


class SchedulingSettings(BaseModel):
    guard_time_minutes: int = Field(0, ge=0, description="ガードタイム（分）")
    min_slot_minutes: int = Field(0, ge=0, description="最低時間スロット（分）")
    max_fragments: int = Field(10, ge=1, description="最大断片数")


class SchedulingSettingsUpdate(BaseModel):
    guard_time_minutes: int | None = Field(None, ge=0, description="ガードタイム（分）")
    min_slot_minutes: int | None = Field(
        None, ge=0, description="最低時間スロット（分）"
    )
    max_fragments: int | None = Field(None, ge=1, description="最大断片数")


class SchedulingParams(BaseModel):
    """優先度解決後の実効スケジューリングパラメータ"""

    guard_time_minutes: int = 0
    min_slot_minutes: int = 0
    max_fragments: int = 10
