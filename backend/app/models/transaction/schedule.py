# models/transaction/schedule.py
from datetime import date, datetime

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


class ProductionScheduleItem(BaseModel):
    """`GET /production-schedules` の1行（工程スケジュールの1セグメント）。

    ガントのラベル（顧客・製品・数量・納期）と、表示期間の外へ続くかの判定に使う項目を
    受注・工程から結合して返す（Issue #579）。Frontend の `Schedule` 型と揃える
    """

    id: int
    order_id: int
    process_routing_id: int
    equipment_id: int | None = None
    start_datetime: str
    end_datetime: str
    order_number: str | None = None
    customer_order_no: str | None = None
    order_status: str | None = None
    quantity: int | None = None
    desired_deadline: date | None = Field(None, description="希望納期")
    confirmed_deadline: date | None = Field(
        None, description="完成見込み（承認確定時）"
    )
    product_name: str | None = None
    customer_name: str | None = Field(
        None, description="顧客名。顧客不明（customer_id が NULL、#521）は null"
    )
    process_name: str | None = None
    sequence_order: int | None = None
    equipment_name: str | None = None
    equipment_group_id: int | None = None
    equipment_group_name: str | None = Field(
        None,
        description="設備グループの表示名。1台グループはメンバーの設備の表示名（#512）",
    )
    process_start_datetime: str | None = Field(
        None, description="この工程の全セグメントの開始の最小（表示期間外を含む）"
    )
    process_end_datetime: str | None = Field(
        None, description="この工程の全セグメントの終了の最大（表示期間外を含む）"
    )
    order_start_datetime: str | None = Field(
        None, description="この受注の全工程の開始の最小（表示期間外を含む）"
    )
    order_end_datetime: str | None = Field(
        None, description="この受注の全工程の終了の最大（表示期間外を含む）"
    )
