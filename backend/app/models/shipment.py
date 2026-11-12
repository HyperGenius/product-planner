"""弥生の売上明細の名寄せ・送品の突合 API のスキーマ (Issue #667)。

Frontend の `types/shipment.ts` と揃える。
"""

from typing import Literal

from pydantic import BaseModel, Field

OrderMatchMethod = Literal["order_no", "deadline", "single_open_order"]
ProductAutoMethod = Literal["drawing_no", "spec"]


class ShipmentEntryRef(BaseModel):
    """受注に当たった（または候補になった）弥生の明細1行。金額系の列は持たない。"""

    id: int
    sales_date: str
    slip_no: str | None = None
    quantity: int | None = None
    note: str | None = None
    product_name: str | None = None
    method: OrderMatchMethod | None = Field(
        default=None, description="受注に当てた決め手（確定できなかった明細は null）"
    )
    candidate_order_ids: list[int] = Field(
        default_factory=list,
        description="複数の受注に当たって確定できなかったときの候補",
    )


class ShipmentOrderMatch(BaseModel):
    order_id: int
    shipped_qty: int = Field(
        description="弥生で送品が確認できた数量（分納・赤伝を合算）"
    )
    order_quantity: int | None = None
    is_fully_shipped: bool = Field(description="合算した数量が受注数量に達したか")
    last_sales_date: str | None = None
    entries: list[ShipmentEntryRef] = Field(default_factory=list)
    ambiguous_entries: list[ShipmentEntryRef] = Field(default_factory=list)


class ShipmentOrderMatchListResponse(BaseModel):
    latest_sales_date: str | None = Field(
        default=None, description="取り込んだ明細の最新の売上日（無ければ null）"
    )
    items: list[ShipmentOrderMatch] = Field(default_factory=list)


class ShipmentCustomerLinkRef(BaseModel):
    id: str
    customer_id: int


class ShipmentFlowCandidate(BaseModel):
    customer_id: int
    entry_count: int


class ShipmentCustomerItem(BaseModel):
    customer_code: str
    code_key: str
    customer_name: str | None = None
    entry_count: int
    last_sales_date: str
    links: list[ShipmentCustomerLinkRef] = Field(default_factory=list)
    auto_customer_id: int | None = Field(
        default=None, description="辞書が無いとき、得意先名の一致で決まった顧客"
    )
    ignored_id: str | None = None
    name_candidate_ids: list[int] = Field(default_factory=list)
    flow_candidates: list[ShipmentFlowCandidate] = Field(
        default_factory=list,
        description="商流の推定（製品が決まらない行の品名が、この顧客の受注の製品に当たった件数）",
    )
    unmatched_entry_count: int = 0


class ShipmentProductLinkRef(BaseModel):
    id: str
    product_id: int


class ShipmentCrossCustomerCandidate(BaseModel):
    product_id: int
    customer_ids: list[int]


class ShipmentProductItem(BaseModel):
    customer_code: str
    customer_code_key: str
    customer_name: str | None = None
    product_code: str
    product_code_key: str
    product_name: str | None = None
    entry_count: int
    last_sales_date: str
    customer_ids: list[int] = Field(default_factory=list)
    link: ShipmentProductLinkRef | None = None
    auto_product_id: int | None = None
    auto_method: ProductAutoMethod | None = None
    ignored_id: str | None = None
    customer_ignored: bool = False
    candidate_product_ids: list[int] = Field(default_factory=list)
    cross_customer_candidates: list[ShipmentCrossCustomerCandidate] = Field(
        default_factory=list
    )


class ShipmentCustomerLinkCreate(BaseModel):
    customer_code: str = Field(min_length=1, max_length=100)
    customer_id: int


class ShipmentProductLinkUpsert(BaseModel):
    customer_code: str = Field(min_length=1, max_length=100)
    product_code: str = Field(min_length=1, max_length=100)
    product_id: int


class ShipmentIgnoredCreate(BaseModel):
    kind: Literal["customer", "product"]
    customer_code: str = Field(min_length=1, max_length=100)
    product_code: str | None = Field(default=None, max_length=100)
