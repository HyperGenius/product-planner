"""重複顧客の統合（Issue #610）の API スキーマ。"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

# 統合を止める理由
#   order_conflict  付け替えると受注の重複キー（orders_dedupe_key 等）が衝突する
CustomerMergeBlockerReason = Literal["order_conflict"]


class CustomerMergeRequest(BaseModel):
    keep_customer_id: int
    merge_customer_ids: list[int] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def _validate_ids(self) -> CustomerMergeRequest:
        self.merge_customer_ids = list(dict.fromkeys(self.merge_customer_ids))
        if self.keep_customer_id in self.merge_customer_ids:
            raise ValueError("残す顧客を統合される顧客に含めることはできません")
        return self


class CustomerMergeCounts(BaseModel):
    """付け替え・削除の件数。RPC `merge_customers` の戻り値と同じキー。"""

    orders_reassigned: int
    attachments_reassigned: int
    aliases_reassigned: int = Field(description="製品の別名の付け替え件数")
    aliases_dropped: int = Field(
        description="製品の別名のうち、同じ表記が残す顧客にもあるため捨てる件数"
    )
    alias_history_reassigned: int
    customer_aliases_reassigned: int
    unallocated_actuals_reassigned: int
    prompt_history_reassigned: int
    contacts_reassigned: int = Field(
        description="担当者の付け替え件数（統合される顧客の email から作る分を含む）"
    )
    customers_deleted: int


class CustomerMergeBlocker(BaseModel):
    reason: CustomerMergeBlockerReason
    customer_id: int = Field(description="統合される側の顧客")
    customer_name: str
    order_id: int
    order_number: str | None = None
    order_status: str
    conflicting_order_id: int
    conflicting_order_number: str | None = None


class CustomerMergeTarget(BaseModel):
    id: int
    name: str
    alias: str | None = None
    email: str | None = None


class CustomerMergePreview(BaseModel):
    keep_customer_id: int
    merge_customer_ids: list[int]
    merge_customers: list[CustomerMergeTarget]
    counts: CustomerMergeCounts
    blockers: list[CustomerMergeBlocker]


class CustomerMergeLogEntry(BaseModel):
    id: int
    keep_customer_id: int | None
    keep_customer_name: str
    merged_customers: list[CustomerMergeTarget]
    counts: CustomerMergeCounts
    merged_by: str | None
    merged_at: datetime
