"""日報からの作り置き（先行着手）の推定と、現場の指摘 API のスキーマ (Issue #591)。"""

from datetime import date, datetime
from typing import Literal, Self

from pydantic import BaseModel, Field, field_validator, model_validator

StockFeedbackKind = Literal["not_stocked", "stock_process"]

_NOTE_MAX_LENGTH = 500


class StockEstimateResponse(BaseModel):
    product_id: int
    product_name: str | None
    product_code: str | None
    # 作り置きしている工程（この工程の後に置いている）
    process_name: str
    # 日報に出てくる次の工程。None は日報に出てくる最後の工程（送品で減る）
    next_process_name: str | None
    qty: int
    # 最後に増減した加工日（指摘の基準日の方が新しければ基準日）
    last_movement_date: date | None


class StockFeedbackResponse(BaseModel):
    product_id: int
    product_name: str | None
    product_code: str | None
    kind: StockFeedbackKind
    process_name: str | None
    baseline_qty: int | None
    baseline_date: date | None
    note: str | None
    updated_by: str
    updated_at: datetime


class StockEstimatesResponse(BaseModel):
    # 推定の最終計算日時（割り付けと同じ）。一度も計算していなければ None
    computed_at: datetime | None
    # 推定数の多い順
    items: list[StockEstimateResponse]
    # 指摘（指摘日時の新しい順）。推定が出ていない製品の指摘も含む
    feedback: list[StockFeedbackResponse]


class StockFeedbackUpsert(BaseModel):
    """「ここは違う」の指摘。

    * not_stocked: この製品は作り置きしていない
    * stock_process: 作り置きしているのは process_name の工程の後。baseline_qty / baseline_date を
      両方指定すると、その日（の作業を終えた時点）の作り置きの数として推定の起点にする
    """

    kind: StockFeedbackKind
    process_name: str | None = Field(default=None, max_length=200)
    baseline_qty: int | None = Field(default=None, ge=0)
    baseline_date: date | None = None
    note: str | None = Field(default=None, max_length=_NOTE_MAX_LENGTH)

    @field_validator("process_name", "note", mode="before")
    @classmethod
    def _strip_blank(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip() or None
        return value

    @model_validator(mode="after")
    def _fields_by_kind(self) -> Self:
        if self.kind == "not_stocked":
            if (
                self.process_name is not None
                or self.baseline_qty is not None
                or self.baseline_date is not None
            ):
                raise ValueError(
                    "not_stocked では process_name / baseline_qty / baseline_date を指定しない"
                )
            return self
        if self.process_name is None:
            raise ValueError("stock_process では process_name が必要")
        if (self.baseline_qty is None) != (self.baseline_date is None):
            raise ValueError("baseline_qty と baseline_date は両方指定する")
        return self
