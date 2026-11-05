"""日報の名寄せ・別名辞書 API のスキーマ (Issue #488)。"""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator

NameKindParam = Literal["equipment", "process", "customer", "product"]

_RAW_TEXT_MAX_LENGTH = 200


class _RawTextSchema(BaseModel):
    # 日報の表記そのもの（前後の空白のみ除去）。未照合一覧の raw_text をそのまま送る
    raw_text: str = Field(min_length=1, max_length=_RAW_TEXT_MAX_LENGTH)

    @field_validator("raw_text", mode="before")
    @classmethod
    def _strip_raw_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


def _normalize_process_names(value: list[str]) -> list[str]:
    names: list[str] = []
    for name in value:
        stripped = name.strip()
        if stripped and stripped not in names:
            names.append(stripped)
    if not names:
        raise ValueError("process_names must contain at least one name")
    return names


class EquipmentNameAliasCreate(_RawTextSchema):
    equipment_id: int


class EquipmentNameAliasUpdate(BaseModel):
    equipment_id: int


class ProcessNameAliasCreate(_RawTextSchema):
    # マスタの工程名（process_routings.process_name）。1つの表記が複数の工程を指しうる
    process_names: list[str] = Field(min_length=1)

    @field_validator("process_names")
    @classmethod
    def _dedupe(cls, value: list[str]) -> list[str]:
        return _normalize_process_names(value)


class ProcessNameAliasUpdate(BaseModel):
    process_names: list[str] = Field(min_length=1)

    @field_validator("process_names")
    @classmethod
    def _dedupe(cls, value: list[str]) -> list[str]:
        return _normalize_process_names(value)


class CustomerNameAliasCreate(_RawTextSchema):
    customer_id: int


class CustomerNameAliasUpdate(BaseModel):
    customer_id: int


class DailyReportProductAliasCreate(_RawTextSchema):
    """日報の商品名を製品別名辞書（product_name_aliases、顧客単位）に登録する。"""

    customer_id: int
    product_id: int


class UnmatchedNameResponse(BaseModel):
    kind: NameKindParam
    raw_text: str
    # 製品のみ: 顧客先の表記と、その照合結果（照合できなければ None）
    customer_raw: str | None = None
    customer_id: int | None = None
    entry_count: int
    last_work_date: date | None = None


class ProductCandidateResponse(BaseModel):
    product_id: int
    name: str
    score: float
    # 顧客（customer_id）を指定したときだけ値が入る (Issue #646)。数えるのは割り付けの候補と
    # 同じ confirmed / in_progress の受注。受注が無ければ 0 / None
    open_order_count: int | None = None
    nearest_deadline: str | None = None


class CustomerOpenOrderResponse(BaseModel):
    """顧客の未出荷の受注 (Issue #646)。`desired_deadline` の DB 列は `orders.deadline_date`。"""

    order_id: int
    order_number: str | None = None
    customer_order_no: str | None = None
    product_id: int
    product_name: str
    quantity: int | None = None
    desired_deadline: str | None = None
    status: str
    # 割り付けの候補（confirmed / in_progress）か
    allocatable: bool


class IgnoredNameCreate(_RawTextSchema):
    """未照合キューの表記を「対象外」にする (Issue #489)。"""

    kind: NameKindParam
    # 製品のみ: 顧客先の表記（未照合一覧の customer_raw をそのまま送る。空欄なら None）
    customer_raw: str | None = Field(default=None, max_length=_RAW_TEXT_MAX_LENGTH)

    @field_validator("customer_raw", mode="before")
    @classmethod
    def _strip_customer_raw(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip() or None
        return value


class IgnoredNameResponse(BaseModel):
    id: str
    kind: NameKindParam
    raw_text: str
    customer_raw: str | None = None
    created_by: str
    created_at: str


class NameEntryResponse(BaseModel):
    """表記が使われている日報の明細（未照合キューでの確認用）。"""

    id: int
    sheet_name: str
    row_no: int
    work_date: date | None = None
    customer_raw: str | None = None
    product_raw: str | None = None
    process_raw: str | None = None
    equipment_raw: str | None = None
    worker_raw: str | None = None
    processed_qty: int | None = None
    defect_qty: int | None = None
    good_qty: int | None = None
