"""日報の実績による受注の進捗 API のスキーマ (Issue #490)。"""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

ProgressStatus = Literal["not_started", "in_progress", "completed"]
CompletedBy = Literal["quantity", "later_process"]
UnallocatedReason = Literal[
    "no_routing_process",
    "no_candidate_order",
    "before_order_date",
    "exceeds_order_qty",
    "no_work_date",
]


class ProcessProgressResponse(BaseModel):
    order_id: int
    process_routing_id: int
    sequence_order: int | None
    process_name: str | None
    # 割り付けた良品数（受注数量が上限）
    good_qty: int
    # 受注数量（進捗率 good_qty ÷ order_quantity の分母。Issue #491）
    order_quantity: int | None
    first_actual_date: date | None
    last_actual_date: date | None
    status: ProgressStatus
    # completed の根拠（quantity: 良品数が受注数量以上 / later_process: 後の工程に実績がある）
    completed_by: CompletedBy | None
    # 計画の終了日時（この工程のスケジュールの最後のセグメントの終了）。未スケジュールなら None。
    # 遅れ（計画の終了日時を過ぎても completed でない）の判定に使う（Issue #491）
    planned_end_datetime: datetime | None


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


# ---------------------------------------------------------------------------
# 日報の照合状況（Issue #542）
# ---------------------------------------------------------------------------

# 画面での未割当の分類。no_candidate_order は、その製品の候補にならない受注の有無で
# unapproved_order（下書き・承認待ちあり）/ closed_order_only（出荷済み・完了だけ）/ no_order に分ける
UnallocatedCategory = Literal[
    "no_routing_process",
    "unapproved_order",
    "closed_order_only",
    "no_order",
    "before_order_date",
    # 受注日より前の実績のうち、作り置きの推定（Issue #591）が出ている製品のもの
    "stocked",
    "exceeds_order_qty",
    "no_work_date",
]


class UnallocatedCategoryTotal(BaseModel):
    category: UnallocatedCategory
    row_count: int
    qty: int


class CoverageSummaryResponse(BaseModel):
    # 数量の単位は「明細×マスタの工程名」（1行が2工程に対応する明細は2回数える）。未照合は1行1回
    total_qty: int
    allocated_qty: int
    unallocated_qty: int
    unmatched_rows: int
    unmatched_qty: int
    # 分類ごとの未割当（数量の多い順）
    unallocated: list[UnallocatedCategoryTotal]


class UnallocatedGroupResponse(BaseModel):
    product_id: int
    product_name: str | None
    product_code: str | None
    # 製品に工程ルートが1件でもあるか（無ければ「工程ルートが無い製品」）
    product_has_routings: bool
    # マスタの工程名（別名辞書で解決した後の名前）
    process_name: str
    reason: UnallocatedReason
    category: UnallocatedCategory
    row_count: int
    qty: int
    first_work_date: date | None
    last_work_date: date | None
    customer_names: list[str]


class DailyReportCoverageResponse(BaseModel):
    # 割り付けの最終計算日時。一度も計算していなければ None
    computed_at: datetime | None
    # 加工日の絞り込みの開始日（直近 N か月の初日）。すべての期間なら None
    since: date | None
    summary: CoverageSummaryResponse
    # (製品, 工程名, 理由) ごとの未割当（数量の多い順）
    groups: list[UnallocatedGroupResponse]
