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


class OrderedProductCandidateResponse(BaseModel):
    """顧客の受注のうち、日報の実績が1つも割り付いていない受注の製品 (Issue #704)。

    受注の情報は代表の受注（希望納期の近い受注）のもの。`nearest_deadline` の DB 列は
    `orders.deadline_date`（無ければ確定納期）。
    """

    product_id: int
    name: str
    code: str | None = None
    # 実績の付いていない割り付けの候補（confirmed / in_progress）の受注の数
    order_count: int
    nearest_deadline: str | None = None
    order_number: str | None = None
    customer_order_no: str | None = None
    quantity: int | None = None


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


# ---------------------------------------------------------------------------
# 製品の工程ルートと日報の工程の突き合わせ（Issue #708）
# ---------------------------------------------------------------------------


class ProductProcessMismatchResponse(BaseModel):
    """② 製品の工程を日報に合わせる の1行（工程ルートと日報の工程が合わない製品）。"""

    product_id: int
    product_name: str | None
    product_code: str | None
    # 工程ルートが1件でもあるか（無ければ日報の工程はすべて工程ルートに無い工程になる）
    has_routings: bool
    # 合わない工程の数（工程名に結び付かない表記・工程ルートに無い工程名・日報で追わないのに実績がある工程）
    mismatch_count: int
    # 合わない工程の日報の明細の数
    entry_count: int


class ProcessRawResponse(BaseModel):
    """日報の工程の表記（製品1つ分）。"""

    raw_text: str
    entry_count: int
    last_work_date: date | None


class RoutingProcessRowResponse(BaseModel):
    """左: 工程ルートの工程と、それに結び付く日報の表記（結び付く表記が無ければ左だけの工程）。"""

    routing_id: int
    sequence_order: int
    process_name: str
    # 日報で追わない工程（#681）
    untracked: bool
    raws: list[ProcessRawResponse]


class OffRoutingProcessRowResponse(BaseModel):
    """右だけ: 工程名には結び付くが、この製品の工程ルートに無い工程。"""

    process_name: str
    untracked: bool
    raws: list[ProcessRawResponse]


class UnmatchedProcessRawResponse(ProcessRawResponse):
    """右だけ: 工程名に結び付かない日報の表記。"""

    # 同じ表記を日報で使っている他の製品の数（工程の別名はテナント共通）
    other_product_count: int


class ProductProcessComparisonResponse(BaseModel):
    product_id: int
    product_name: str | None
    product_code: str | None
    has_routings: bool
    mismatch_count: int
    routings: list[RoutingProcessRowResponse]
    off_routing: list[OffRoutingProcessRowResponse]
    unmatched: list[UnmatchedProcessRawResponse]
