"""重複製品の統合（Issue #515）の API スキーマ。"""

from typing import Literal

from pydantic import BaseModel, Field, model_validator

# 統合を止める理由
#   spec_mismatch    品名から読み取った直径・長さ・材質が残す製品と違う（読み取れない場合を含む）
#   prefix_mismatch  品名の接頭辞が残す製品と違う（有無の違いを含む。顧客ごとの別製品の想定）
#   order_conflict   付け替え先に同じ顧客・同じ納期の受注がある（orders_dedupe_key）。統合される側が出荷済みなら止めずに削除する
#   routing_mismatch スケジュール済みの受注が参照する工程の sequence_order が残す製品に無い
MergeBlockerReason = Literal[
    "spec_mismatch", "prefix_mismatch", "order_conflict", "routing_mismatch"
]


class ProductMergeCandidate(BaseModel):
    """統合の候補になる製品と、残す製品を選ぶための件数。"""

    id: int
    name: str
    code: str | None
    is_active: bool
    prefix: str = Field(description="品名の先頭の接頭辞（無ければ空文字）")
    prefix_key: str = Field(
        description="接頭辞の比較用キー。残す製品と違う候補は統合できない"
    )
    routing_count: int = Field(description="工程数")
    timed_routing_count: int = Field(description="工程時間が登録された工程数")
    has_decimal_time: bool = Field(description="工程時間に小数があるか")
    order_counts: dict[str, int] = Field(description="受注件数（ステータス別）")
    alias_count: int = Field(description="別名の件数")
    rank: int = Field(
        description="正しさの順位。3: 工程時間が小数まで / 2: 工程時間あり / 1: 工程のみ / 0: 工程なし"
    )


class ProductMergeCandidatesResponse(BaseModel):
    diameter: str
    length: str
    material: str
    candidates: list[ProductMergeCandidate]
    default_keep_product_id: int | None = Field(
        description="残す製品の初期選択。正しさの順位が最上位の候補が1件だけのときに入る"
    )


class ProductMergeGroup(BaseModel):
    """品名の直径・長さ・材質が一致する製品が2件以上ある組（重複の候補の抽出）。"""

    diameter: str
    length: str
    material: str = Field(
        description="候補の検索に入れる材質。グループ内で最も多い表記（無ければ空文字）"
    )
    product_count: int
    mergeable: bool = Field(
        description="接頭辞が同じ製品が2件以上あるか。False なら接頭辞違いのみで統合できない"
    )
    product_names: list[str] = Field(description="グループ内の製品の品名（ID 順）")


class ProductMergeGroupsResponse(BaseModel):
    groups: list[ProductMergeGroup]


class ProductMergeRequest(BaseModel):
    keep_product_id: int
    merge_product_ids: list[int] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def _validate_ids(self) -> "ProductMergeRequest":
        self.merge_product_ids = list(dict.fromkeys(self.merge_product_ids))
        if self.keep_product_id in self.merge_product_ids:
            raise ValueError("残す製品を統合される製品に含めることはできません")
        return self


class ProductMergeBlocker(BaseModel):
    reason: MergeBlockerReason
    product_id: int = Field(description="統合される側の製品")
    product_name: str
    order_id: int | None = None
    order_number: str | None = None
    order_status: str | None = None
    conflicting_order_id: int | None = Field(
        default=None, description="order_conflict の衝突先の受注"
    )
    conflicting_order_number: str | None = None
    sequence_order: int | None = Field(
        default=None, description="routing_mismatch で残す製品に無い工程の順序"
    )


class ProductMergeOrderRef(BaseModel):
    id: int
    order_number: str | None
    product_id: int
    status: str


class ProductMergeCounts(BaseModel):
    orders_reassigned: int
    schedules_reassigned: int
    aliases_reassigned: int
    alias_history_reassigned: int
    orders_deleted: int
    routings_deleted: int
    products_deleted: int


class ProductMergePreview(BaseModel):
    keep_product_id: int
    merge_product_ids: list[int]
    counts: ProductMergeCounts
    deleted_orders: list[ProductMergeOrderRef] = Field(
        description="衝突のため削除される出荷済みの受注"
    )
    blockers: list[ProductMergeBlocker]
