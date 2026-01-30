# models/transaction/schedule.py
from pydantic import BaseModel, Field


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
