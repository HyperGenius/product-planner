# backend/app/services/shipment_review.py
"""弥生で送品済みなのに日報の進捗が追いついていない受注と、その原因 (Issue #683, Epic #679)。

DB から切り離した純粋なロジック。読み込みは `shipment_matching_service.list_order_reviews()`。
結果は保存せず参照のたびに求める（マスタを直せば、次の割り付けの再計算の後に要確認から消える）。

対象: 未送品（確定済・生産中）の受注のうち、弥生の突合で当たった明細があり、弥生の送品数量が
**日報で追う最後の工程**（日報で追わない工程 #681 を除いたうちの `sequence_order` 最大の工程）の
良品数を超えているもの。進捗の行が無い受注は良品数0とみなす。
* 割り付けの候補は確定済・生産中だけなので、送品済みにした受注の進捗は無くなる。判定は未送品に限る
* 製品の工程がすべて日報で追わない工程なら、比べる工程が無いので対象にしない
  （日報で追わない工程があることだけを理由に要確認にしない）
* 「送品済みにする」は止めない（送品の記録は弥生が正）

原因（上から順に判定し、最初に当たったもの）:
1. `no_routing`: 製品の工程ルートが0件
2. `process_mismatch`: その製品の未割当に `no_routing_process`（工程ルートに無い工程）がある
3. `customer_or_stock`: その製品の未割当に `no_candidate_order` / `before_order_date` がある
   （日報の顧客先が違う・作り置き）
4. `missing_report`: どれにも当たらない（日報の書き漏れ・取り込み漏れ。名寄せが未照合の明細は
   未割当に入らない #490 ので、未照合もここに混ざる）

未割当を見る期間は、加工日が受注日以降・その受注の弥生の最新の売上日以前（古い作り置きまで拾わない）。
ただし受注日より前（`before_order_date`）の作り置きは受注日以降には無いので、受注日から
`STOCK_EXPIRY_MONTHS` か月前（作り置きの推定 #591 で動きの無い作り置きを0とみなす期間）まで遡る。
加工日の無い未割当は期間にかかわらず含める（照合状況の画面 #542 と同じ）。
"""

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date
from typing import Literal

from app.services.daily_report_allocator import RoutingRef, is_untracked
from app.services.daily_report_stock_estimator import (
    STOCK_EXPIRY_MONTHS,
    months_before,
)

ReviewCause = Literal[
    "no_routing", "process_mismatch", "customer_or_stock", "missing_report"
]
# 判定の順（画面の見出しの並びも同じ。Frontend `ORDER_REVIEW_CAUSES` と揃える）
REVIEW_CAUSES: tuple[ReviewCause, ...] = (
    "no_routing",
    "process_mismatch",
    "customer_or_stock",
    "missing_report",
)
# 要確認の対象にする受注のステータス（日報の割り付けの候補と同じ）
REVIEW_ORDER_STATUSES = frozenset({"confirmed", "in_progress"})
# 原因の判定に使う未割当の理由
_PROCESS_MISMATCH_REASONS = frozenset({"no_routing_process"})
_CUSTOMER_OR_STOCK_REASONS = frozenset({"no_candidate_order", "before_order_date"})
REVIEW_UNALLOCATED_REASONS = _PROCESS_MISMATCH_REASONS | _CUSTOMER_OR_STOCK_REASONS


@dataclass(frozen=True)
class ReviewOrder:
    """要確認の判定に使う受注（製品のある生産の受注）。"""

    id: int
    product_id: int
    status: str
    # `order_date` の JST 暦日
    order_date: date | None


@dataclass(frozen=True)
class ReviewShipment:
    """受注1件の弥生の送品（突合で確定した明細の合計。区別できなかった明細は含めない）。"""

    shipped_qty: int
    last_sales_date: date | None


@dataclass(frozen=True)
class ReviewUnallocated:
    """日報の割り付けの未割当の実績（`daily_report_unallocated_actuals` の1行）。"""

    product_id: int
    process_name: str
    reason: str
    work_date: date | None
    qty: int


@dataclass(frozen=True)
class OrderReview:
    order_id: int
    product_id: int
    cause: ReviewCause
    shipped_qty: int
    last_sales_date: date | None
    # 日報で追う最後の工程（工程ルートが無ければ None）と、その工程の良品数（進捗の行が無ければ0）
    final_process_name: str | None
    final_good_qty: int
    # 原因の手がかり: 原因に当たった未割当の数量の合計と、その日報の工程名（重複なし・名前順）
    unallocated_qty: int = 0
    process_names: tuple[str, ...] = field(default_factory=tuple)


def _in_period(work_date: date | None, start: date | None, end: date | None) -> bool:
    if work_date is None:
        return True
    if start is not None and work_date < start:
        return False
    return end is None or work_date <= end


def _period_start(reason: str, order_date: date | None) -> date | None:
    if order_date is None:
        return None
    if reason == "before_order_date":
        return months_before(order_date, STOCK_EXPIRY_MONTHS)
    return order_date


def _evidence(
    rows: list[ReviewUnallocated],
    reasons: frozenset[str],
    order: ReviewOrder,
    end: date | None,
) -> list[ReviewUnallocated]:
    return [
        row
        for row in rows
        if row.reason in reasons
        and _in_period(row.work_date, _period_start(row.reason, order.order_date), end)
    ]


def review_orders(
    orders: Iterable[ReviewOrder],
    shipments: dict[int, ReviewShipment],
    final_good_qty: dict[tuple[int, int], int],
    routings: Iterable[RoutingRef],
    untracked_process_names: Iterable[str],
    unallocated: Iterable[ReviewUnallocated],
) -> list[OrderReview]:
    """要確認の受注と原因を、受注 ID の順に返す。

    `final_good_qty` は (受注 ID, 工程ルート ID) → 良品数（`order_process_progress`）。
    """
    untracked = frozenset(n.strip() for n in untracked_process_names if n.strip())
    routings_by_product: dict[int, list[RoutingRef]] = {}
    for routing in routings:
        routings_by_product.setdefault(routing.product_id, []).append(routing)
    unallocated_by_product: dict[int, list[ReviewUnallocated]] = {}
    for row in unallocated:
        unallocated_by_product.setdefault(row.product_id, []).append(row)

    reviews: list[OrderReview] = []
    for order in sorted(orders, key=lambda o: o.id):
        shipment = shipments.get(order.id)
        if (
            order.status not in REVIEW_ORDER_STATUSES
            or shipment is None
            or shipment.shipped_qty <= 0
        ):
            continue
        product_routings = routings_by_product.get(order.product_id, [])
        tracked = [r for r in product_routings if not is_untracked(r, untracked)]
        if product_routings and not tracked:
            continue
        final = max(tracked, key=lambda r: (r.sequence_order, r.id), default=None)
        good_qty = final_good_qty.get((order.id, final.id), 0) if final else 0
        if shipment.shipped_qty <= good_qty:
            continue

        rows = unallocated_by_product.get(order.product_id, [])
        end = shipment.last_sales_date
        evidence: list[ReviewUnallocated] = []
        cause: ReviewCause
        if not product_routings:
            cause = "no_routing"
        elif evidence := _evidence(rows, _PROCESS_MISMATCH_REASONS, order, end):
            cause = "process_mismatch"
        elif evidence := _evidence(rows, _CUSTOMER_OR_STOCK_REASONS, order, end):
            cause = "customer_or_stock"
        else:
            cause = "missing_report"
        reviews.append(
            OrderReview(
                order_id=order.id,
                product_id=order.product_id,
                cause=cause,
                shipped_qty=shipment.shipped_qty,
                last_sales_date=shipment.last_sales_date,
                final_process_name=(final.process_name if final else None),
                final_good_qty=good_qty,
                unallocated_qty=sum(r.qty for r in evidence),
                process_names=tuple(sorted({r.process_name for r in evidence})),
            )
        )
    return reviews
