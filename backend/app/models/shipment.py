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


UnmatchedEntryStatus = Literal[
    "unmatched_customer", "unmatched_product", "no_order", "ambiguous"
]


class ShipmentUnmatchedGroup(BaseModel):
    """受注に当たらない弥生の明細を (得意先, 商品コード, 原因) でまとめた行 (Issue #682)。

    弥生の表記（得意先名・品名・備考）は売上日が最も新しい明細の値。
    """

    status: UnmatchedEntryStatus
    customer_code: str
    customer_code_key: str
    customer_name: str | None = None
    product_code: str
    product_code_key: str
    product_name: str | None = None
    latest_note: str | None = None
    entry_count: int
    total_qty: int = Field(description="明細の数量の合計（赤伝を差し引く）")
    last_sales_date: str | None = None
    customer_ids: list[int] = Field(
        default_factory=list, description="照合できた顧客（商流で複数ありうる）"
    )
    product_ids: list[int] = Field(default_factory=list, description="照合できた製品")
    note_deadlines: list[str] = Field(
        default_factory=list, description="備考の「○/○納期分」の日付"
    )
    candidate_order_ids: list[int] = Field(
        default_factory=list, description="受注が区別できないときの候補"
    )


class ShipmentUnmatchedCounts(BaseModel):
    unmatched_customer: int = 0
    unmatched_product: int = 0
    no_order: int = 0
    ambiguous: int = 0


class ShipmentUnmatchedListResponse(BaseModel):
    latest_sales_date: str | None = Field(
        default=None, description="取り込んだ明細の最新の売上日（無ければ null）"
    )
    since: str | None = Field(
        default=None, description="対象の期間の始まり（売上日。無ければ null）"
    )
    counts: ShipmentUnmatchedCounts = Field(
        description="原因ごとのまとめの件数（上限で切る前）"
    )
    truncated: bool = Field(description="原因ごとの上限で切ったまとめがあるか")
    items: list[ShipmentUnmatchedGroup] = Field(default_factory=list)


OrderReviewCause = Literal[
    "no_routing", "process_mismatch", "customer_or_stock", "missing_report"
]


class ShipmentOrderReview(BaseModel):
    """弥生で送品済みなのに日報の進捗が追いついていない受注と原因 (Issue #683)。"""

    order_id: int
    product_id: int
    cause: OrderReviewCause
    shipped_qty: int = Field(description="弥生の送品数量（突合で確定した明細の合計）")
    last_sales_date: str | None = None
    final_process_name: str | None = Field(
        default=None,
        description="日報で追う最後の工程（工程ルートが無ければ null）",
    )
    final_good_qty: int = Field(
        description="日報で追う最後の工程の良品数（進捗の行が無ければ0）"
    )
    unallocated_qty: int = Field(
        default=0, description="原因に当たった未割当の実績の数量の合計"
    )
    process_names: list[str] = Field(
        default_factory=list, description="原因に当たった未割当の日報の工程名"
    )


class ShipmentOrderReviewCounts(BaseModel):
    no_routing: int = 0
    process_mismatch: int = 0
    customer_or_stock: int = 0
    missing_report: int = 0


class ShipmentOrderReviewListResponse(BaseModel):
    computed_at: str | None = Field(
        default=None, description="日報の割り付けを最後に計算した日時（無ければ null）"
    )
    counts: ShipmentOrderReviewCounts
    items: list[ShipmentOrderReview] = Field(default_factory=list)


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
