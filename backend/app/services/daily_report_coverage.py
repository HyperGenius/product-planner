"""日報の照合状況と未割当の実績の集約 (Issue #542, 親Issue #485)。

DB から切り離した純粋なロジック。DB の入出力は `daily_report_coverage_service`（参照）と
`daily_report_allocation_service`（割り付けの再計算時に月ごとの集計を保存）。

数量の単位は「明細×マスタの工程名」（未割当 `daily_report_unallocated_actuals` と同じ）。
「カシメ、仕上げ加工」のように1行が2工程に対応する明細は2回数える。照合できなかった明細は
工程が決まらないので1行1回で数える。

割り付けた数量は保存せず、照合済みの数量から同じ計算時点の未割当の数量を引いて求める
（月ごとの集計と未割当は RPC `replace_daily_report_allocation` が同じトランザクションで置き換える）。
"""

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal

from app.services.daily_report_allocator import (
    ActualEntry,
    UnallocatedReason,
)

# 画面での未割当の分類。reason の `no_candidate_order`（確定済み・生産中の受注が無い）は、
# その製品の他のステータスの受注の有無で聞くことが変わるので3つに分ける
UnallocatedCategory = Literal[
    "no_routing_process",
    # 下書き・承認待ちの受注がある（承認前に作り始めている）
    "unapproved_order",
    # 出荷済み・完了の受注だけがある（過去の受注の実績の可能性が高い）
    "closed_order_only",
    # 受注が1件も無い（見込み生産・受注の登録漏れ）
    "no_order",
    "before_order_date",
    # 受注日より前の実績のうち、作り置きの推定（#591）が出ている製品のもの（作り置きから出す運用）
    "stocked",
    "exceeds_order_qty",
    "no_work_date",
]

UNAPPROVED_ORDER_STATUSES = ("draft", "pending_approval")
CLOSED_ORDER_STATUSES = ("shipped", "completed")


@dataclass(frozen=True)
class UnmatchedEntry:
    """製品か工程が照合できず割り付けに使えなかった明細（良品数が1以上のもの）。"""

    work_date: date | None
    good_qty: int


@dataclass(frozen=True)
class MonthlyCoverage:
    # 加工日の月の1日。加工日の無い明細は None
    work_month: date | None
    # 照合できた数量（明細×工程）
    matched_rows: int = 0
    matched_qty: int = 0
    # 照合できなかった明細
    unmatched_rows: int = 0
    unmatched_qty: int = 0

    def to_json(self) -> dict[str, Any]:
        return {
            "work_month": self.work_month.isoformat() if self.work_month else None,
            "matched_rows": self.matched_rows,
            "matched_qty": self.matched_qty,
            "unmatched_rows": self.unmatched_rows,
            "unmatched_qty": self.unmatched_qty,
        }

    @classmethod
    def from_json(cls, value: dict[str, Any]) -> "MonthlyCoverage":
        month = value.get("work_month")
        return cls(
            work_month=date.fromisoformat(month) if month else None,
            matched_rows=int(value.get("matched_rows") or 0),
            matched_qty=int(value.get("matched_qty") or 0),
            unmatched_rows=int(value.get("unmatched_rows") or 0),
            unmatched_qty=int(value.get("unmatched_qty") or 0),
        )


def _month_of(work_date: date | None) -> date | None:
    return work_date.replace(day=1) if work_date else None


def summarize_coverage(
    entries: Iterable[ActualEntry], unmatched: Iterable[UnmatchedEntry]
) -> list[MonthlyCoverage]:
    """照合済み・未照合の明細を加工日の月ごとに集計する（加工日の無い明細は最後）。"""
    totals: dict[date | None, dict[str, int]] = {}

    def bucket(work_date: date | None) -> dict[str, int]:
        return totals.setdefault(
            _month_of(work_date),
            {
                "matched_rows": 0,
                "matched_qty": 0,
                "unmatched_rows": 0,
                "unmatched_qty": 0,
            },
        )

    for entry in entries:
        if entry.good_qty <= 0:
            continue
        processes = len(dict.fromkeys(entry.process_names))
        b = bucket(entry.work_date)
        b["matched_rows"] += processes
        b["matched_qty"] += entry.good_qty * processes
    for unmatched_entry in unmatched:
        if unmatched_entry.good_qty <= 0:
            continue
        b = bucket(unmatched_entry.work_date)
        b["unmatched_rows"] += 1
        b["unmatched_qty"] += unmatched_entry.good_qty

    return [
        MonthlyCoverage(work_month=month, **values)
        for month, values in sorted(
            totals.items(), key=lambda kv: (kv[0] is None, kv[0] or date.min)
        )
    ]


def period_start(today: date, months: int | None) -> date | None:
    """直近 `months` か月（今月を含む）の初日。None ならすべての期間。"""
    if months is None:
        return None
    index = today.year * 12 + (today.month - 1) - (months - 1)
    return date(index // 12, index % 12 + 1, 1)


def in_period(work_date: date | None, since: date | None) -> bool:
    """期間に含めるか。加工日の無い明細は期間で絞り込めないので常に含める。"""
    return since is None or work_date is None or work_date >= since


def unallocated_category(
    reason: UnallocatedReason,
    other_order_statuses: Iterable[str],
    stocked: bool = False,
) -> UnallocatedCategory:
    """未割当の理由を画面の分類にする。

    `other_order_statuses` はその製品の割り付けの候補にならない受注のステータス。
    下書き・承認待ちがあれば出荷済みより優先する（今まさに作っている受注の可能性が高いため）。
    `stocked` はその製品に作り置きの推定（#591）が出ているか。出ていれば受注日より前の実績は
    作り置きとして要確認から外す（「作り置きしていない」と指摘された製品は推定が出ない）。
    """
    if reason == "before_order_date" and stocked:
        return "stocked"
    if reason != "no_candidate_order":
        return reason
    statuses = set(other_order_statuses)
    if statuses & set(UNAPPROVED_ORDER_STATUSES):
        return "unapproved_order"
    if statuses & set(CLOSED_ORDER_STATUSES):
        return "closed_order_only"
    return "no_order"


@dataclass(frozen=True)
class UnallocatedRow:
    product_id: int
    customer_id: int | None
    process_name: str
    work_date: date | None
    qty: int
    reason: UnallocatedReason


@dataclass
class UnallocatedGroup:
    product_id: int
    process_name: str
    reason: UnallocatedReason
    category: UnallocatedCategory
    row_count: int = 0
    qty: int = 0
    first_work_date: date | None = None
    last_work_date: date | None = None
    customer_ids: list[int] = field(default_factory=list)

    def add(self, row: UnallocatedRow) -> None:
        self.row_count += 1
        self.qty += row.qty
        if row.work_date is not None:
            if self.first_work_date is None or row.work_date < self.first_work_date:
                self.first_work_date = row.work_date
            if self.last_work_date is None or row.work_date > self.last_work_date:
                self.last_work_date = row.work_date
        if row.customer_id is not None and row.customer_id not in self.customer_ids:
            self.customer_ids.append(row.customer_id)


def group_unallocated(
    rows: Iterable[UnallocatedRow],
    order_statuses_by_product: dict[int, set[str]],
    stocked_product_ids: Iterable[int] = (),
) -> list[UnallocatedGroup]:
    """未割当を (製品, 工程名, 理由) 単位にまとめ、数量の多い順に返す。"""
    stocked = set(stocked_product_ids)
    groups: dict[tuple[int, str, str], UnallocatedGroup] = {}
    for row in rows:
        key = (row.product_id, row.process_name, row.reason)
        group = groups.get(key)
        if group is None:
            group = groups[key] = UnallocatedGroup(
                product_id=row.product_id,
                process_name=row.process_name,
                reason=row.reason,
                category=unallocated_category(
                    row.reason,
                    order_statuses_by_product.get(row.product_id, set()),
                    stocked=row.product_id in stocked,
                ),
            )
        group.add(row)
    for group in groups.values():
        group.customer_ids.sort()
    return sorted(
        groups.values(),
        key=lambda g: (-g.qty, g.product_id, g.process_name, g.reason),
    )


@dataclass(frozen=True)
class CategoryTotal:
    category: UnallocatedCategory
    row_count: int
    qty: int


@dataclass(frozen=True)
class CoverageSummary:
    # 日報の良品数の合計（照合済み＋未照合）
    total_qty: int
    # 受注の工程に割り付けた数量
    allocated_qty: int
    unallocated_qty: int
    unmatched_rows: int
    unmatched_qty: int
    # 分類ごとの未割当（数量の多い順。0件の分類は含めない）
    unallocated: list[CategoryTotal]


def build_summary(
    coverage: Iterable[MonthlyCoverage], groups: Iterable[UnallocatedGroup]
) -> CoverageSummary:
    """期間で絞り込み済みの月ごとの集計と未割当のまとめから、照合状況のサマリを作る。"""
    months = list(coverage)
    matched_qty = sum(m.matched_qty for m in months)
    unmatched_rows = sum(m.unmatched_rows for m in months)
    unmatched_qty = sum(m.unmatched_qty for m in months)

    by_category: dict[UnallocatedCategory, list[int]] = {}
    for group in groups:
        totals = by_category.setdefault(group.category, [0, 0])
        totals[0] += group.row_count
        totals[1] += group.qty
    unallocated_qty = sum(qty for _, qty in by_category.values())

    return CoverageSummary(
        total_qty=matched_qty + unmatched_qty,
        # 計算後に明細・製品が消えて未割当の行だけ欠けた場合などに負にしない
        allocated_qty=max(matched_qty - unallocated_qty, 0),
        unallocated_qty=unallocated_qty,
        unmatched_rows=unmatched_rows,
        unmatched_qty=unmatched_qty,
        unallocated=[
            CategoryTotal(category=category, row_count=rows, qty=qty)
            for category, (rows, qty) in sorted(
                by_category.items(), key=lambda kv: (-kv[1][1], kv[0])
            )
        ],
    )
