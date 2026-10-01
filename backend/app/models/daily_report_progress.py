"""日報の実績による受注の進捗 API のスキーマ (Issue #490)。"""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

ProgressStatus = Literal["not_started", "in_progress", "completed"]
CompletedBy = Literal["quantity", "later_process"]
UnallocatedReason = Literal[
    "no_candidate_order", "before_order_date", "exceeds_order_qty", "no_work_date"
]


class ProcessProgressResponse(BaseModel):
    order_id: int
    process_routing_id: int
    sequence_order: int | None
    process_name: str | None
    # 割り付けた良品数（受注数量が上限）
    good_qty: int
    first_actual_date: date | None
    last_actual_date: date | None
    status: ProgressStatus
    # completed の根拠（quantity: 良品数が受注数量以上 / later_process: 後の工程に実績がある）
    completed_by: CompletedBy | None


class OrderProgressResponse(BaseModel):
    order_id: int
    # テナントの最終計算日時。一度も計算していなければ None
    computed_at: datetime | None
    # 割り付けの対象外（確定済み・生産中以外）の受注は空
    processes: list[ProcessProgressResponse]


class OrderProgressListResponse(BaseModel):
    computed_at: datetime | None
    items: list[ProcessProgressResponse]


class UnallocatedActualResponse(BaseModel):
    id: int
    entry_id: int
    product_id: int
    customer_id: int | None
    process_name: str
    work_date: date | None
    qty: int
    reason: UnallocatedReason
    # 日報上の位置と表記
    sheet_name: str | None
    row_no: int | None
    customer_raw: str | None
    product_raw: str | None
    process_raw: str | None
