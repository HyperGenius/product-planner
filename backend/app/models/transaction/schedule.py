# models/transaction/schedule.py
from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class ScheduleRequest(BaseModel):
    """
    注文を入力してスケジュールを生成するリクエスト
    """

    order_id: int


class ScheduleUpdate(BaseModel):
    """
    スケジュール手動調整用のリクエストモデル
    """

    start_datetime: str | None = Field(
        None, description="変更後の開始日時 (ISO8601形式)"
    )
    end_datetime: str | None = Field(None, description="変更後の終了日時 (ISO8601形式)")
    equipment_id: int | None = Field(None, description="変更後の設備ID")

    @model_validator(mode="after")
    def validate_datetime_order(self) -> "ScheduleUpdate":
        """開始日時と終了日時が両方指定されている場合、開始日時が終了日時より前であることを確認"""
        if self.start_datetime is not None and self.end_datetime is not None:
            try:
                start = datetime.fromisoformat(
                    self.start_datetime.replace("Z", "+00:00")
                )
                end = datetime.fromisoformat(self.end_datetime.replace("Z", "+00:00"))
                if start >= end:
                    raise ValueError("start_datetime must be before end_datetime")
            except ValueError as e:
                if "start_datetime must be before end_datetime" in str(e):
                    raise
                # ISO8601形式のパースエラーはそのまま伝播
                raise ValueError(f"Invalid datetime format: {e}") from e
        return self
