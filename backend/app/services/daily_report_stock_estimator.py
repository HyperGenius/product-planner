"""日報からの作り置き（先行着手）の推定 (Issue #591, 親Issue #485)。

DB から切り離した純粋なロジック。割り付け（`daily_report_allocator.allocate_actuals()`）と同じ明細・工程ルートと、
割り付けの結果（受注ごとの充当 `Allocation`）・送品した受注・現場の指摘を受け取り、(製品, 工程) ごとの
作り置きの推定数を返す。DB の入出力は `daily_report_allocation_service`（割り付けの再計算で一緒に保存する）。

現場は、よく注文される製品を先に作って置いておき、注文が来たらそこから出している。在庫数の元になるデータは
日報しか無く、現場が数を直すことも期待できないので、正確な数は目指さない。推定を見せ、違うところを指摘して
もらって直す（`StockFeedback`）。受注への引き当ては「日報で次の工程が始まってから」とみなすので、割り付けの
規則は変えない（作り置きを使った受注で次の工程が始まれば、後の工程の実績で前の工程は完了になる）。

推定（製品ごと）:
* 工程の並びは製品の工程ルート（`sequence_order` 順、同じ工程名は最初の行）のうち、その製品の日報に実績が
  出てくる工程だけ（洗浄・検査など日報に出ない工程は飛ばす）
* 工程 k の後の仕掛かりを、加工日の古い順に増減させる（同じ日は増を先に）
  * 増: 工程 k の良品数（不良数はパース時に差し引き済み）
  * 減: 次の工程の加工数（次の工程で不良になった分も前の工程の品物を使っている）。日報に出てくる最後の工程の
    後は、送品した受注の数量（送品日。送品日の記録が無い受注は納期）
  * 0未満にしない（次の工程が上回ったら、前の工程の日報が漏れていたとみなして0にする）
* 作り置き＝仕掛かり −「確定済み・生産中の受注に割り付いた分」。受注ごとに、工程 k に割り付いた数から
  次の工程に割り付いた数を引いた残り（最後の工程は割り付いた数そのもの＝送品待ち）を合計して差し引く。
  受注どおりに流れている仕掛かり（今日プレスして明日カシメる分）を作り置きに数えないため
* 最後の増減から `STOCK_EXPIRY_MONTHS` か月動きが無ければ0（不良・廃棄などで実際には無い分を残さない）
* 指摘（製品単位）: `not_stocked` は推定を出さない。`stock_process` はその工程の後だけを出し、基準値が
  あれば基準日（の作業を終えた時点）の作り置きをその数として、基準日より後の日報だけで増減させる

推定数は保存して足し引きせず、毎回日報の全件から計算し直す（辞書・マスタの修正が過去の分まで反映される）。
"""

import calendar
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date
from typing import Literal

from app.services.daily_report_allocator import ActualEntry, Allocation, RoutingRef

# 最後の増減からこの月数動きが無い作り置きは0とみなす
STOCK_EXPIRY_MONTHS = 6

FeedbackKind = Literal["not_stocked", "stock_process"]


@dataclass(frozen=True)
class ShippedOrderRef:
    """送品済み・完了の受注（日報に出てくる最後の工程の後の作り置きを減らす）。"""

    product_id: int
    quantity: int
    # shipped_at の JST 暦日。記録が無ければ納期（deadline_date → confirmed_deadline）
    shipped_on: date | None


@dataclass(frozen=True)
class StockFeedback:
    """現場の「ここは違う」の指摘（製品単位で1件）。"""

    product_id: int
    kind: FeedbackKind
    # stock_process: 作り置きしている工程（この工程の後に置いている）
    process_name: str | None = None
    # stock_process: 基準日（の作業を終えた時点）の作り置きの数
    baseline_qty: int | None = None
    baseline_date: date | None = None


@dataclass(frozen=True)
class StockEstimate:
    product_id: int
    # 作り置きしている工程（この工程の後に置いている）
    process_name: str
    # 日報に出てくる次の工程。None は日報に出てくる最後の工程（送品で減る）
    next_process_name: str | None
    qty: int
    # 最後に増減した加工日（基準日の方が新しければ基準日）
    last_movement_date: date | None


def _months_before(day: date, months: int) -> date:
    index = day.year * 12 + (day.month - 1) - months
    year, month = index // 12, index % 12 + 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def _process_chain(
    routings: Iterable[RoutingRef], reported_names: set[str]
) -> list[str]:
    """製品の工程の並び（日報に実績が出てくる工程だけ、工程ルートの順）。"""
    chain: list[str] = []
    for routing in sorted(routings, key=lambda r: (r.sequence_order, r.id)):
        name = (routing.process_name or "").strip()
        if name and name in reported_names and name not in chain:
            chain.append(name)
    return chain


def _movements(
    entries: list[ActualEntry],
    process: str,
    next_process: str | None,
    shipped: list[ShippedOrderRef],
) -> list[tuple[date, int]]:
    """工程の後の仕掛かりの増減（加工日の古い順、同じ日は増を先に）。加工日の無い明細は使わない。"""
    moves: list[tuple[date, int]] = []
    for entry in entries:
        if entry.work_date is None:
            continue
        names = set(entry.process_names)
        if process in names and entry.good_qty > 0:
            moves.append((entry.work_date, entry.good_qty))
        if next_process is not None and next_process in names:
            used = (
                entry.processed_qty
                if entry.processed_qty is not None
                else entry.good_qty
            )
            if used > 0:
                moves.append((entry.work_date, -used))
    if next_process is None:
        for order in shipped:
            if order.shipped_on is not None and order.quantity > 0:
                moves.append((order.shipped_on, -order.quantity))
    return sorted(moves, key=lambda m: (m[0], m[1] < 0))


def _attached(
    allocations: list[Allocation],
    process: str,
    next_process: str | None,
    until: date | None = None,
) -> int:
    """確定済み・生産中の受注に割り付いた、工程の後の仕掛かり（`until` 以前の加工日の分）。"""
    done: dict[int, int] = {}
    used: dict[int, int] = {}
    for allocation in allocations:
        if until is not None and allocation.work_date > until:
            continue
        if allocation.process_name == process:
            done[allocation.order_id] = (
                done.get(allocation.order_id, 0) + allocation.qty
            )
        elif next_process is not None and allocation.process_name == next_process:
            used[allocation.order_id] = (
                used.get(allocation.order_id, 0) + allocation.qty
            )
    return sum(max(qty - used.get(order_id, 0), 0) for order_id, qty in done.items())


def _estimate_one(
    product_id: int,
    entries: list[ActualEntry],
    process: str,
    next_process: str | None,
    allocations: list[Allocation],
    shipped: list[ShippedOrderRef],
    feedback: StockFeedback | None,
    expires_before: date,
) -> StockEstimate | None:
    start_qty = 0
    start_date: date | None = None
    if (
        feedback is not None
        and feedback.baseline_qty is not None
        and feedback.baseline_date is not None
    ):
        start_date = feedback.baseline_date
        # 基準値は受注に割り付いていない作り置きの数なので、その時点の割り付き分を足して仕掛かりに戻す
        start_qty = feedback.baseline_qty + _attached(
            allocations, process, next_process, until=start_date
        )

    qty, last = start_qty, start_date
    for work_date, delta in _movements(entries, process, next_process, shipped):
        if start_date is not None and work_date <= start_date:
            continue
        qty = max(qty + delta, 0)
        last = work_date if last is None else max(last, work_date)

    stock = max(qty - _attached(allocations, process, next_process), 0)
    if last is None or last < expires_before:
        stock = 0
    if stock <= 0:
        return None
    return StockEstimate(
        product_id=product_id,
        process_name=process,
        next_process_name=next_process,
        qty=stock,
        last_movement_date=last,
    )


def estimate_stock(
    entries: Iterable[ActualEntry],
    routings: Iterable[RoutingRef],
    allocations: Iterable[Allocation],
    shipped_orders: Iterable[ShippedOrderRef],
    feedback: Iterable[StockFeedback],
    today: date,
    expiry_months: int = STOCK_EXPIRY_MONTHS,
) -> list[StockEstimate]:
    """(製品, 工程) ごとの作り置きの推定数（1以上のもの、製品 ID・工程の順）。"""
    entries_by_product: dict[int, list[ActualEntry]] = {}
    for entry in entries:
        entries_by_product.setdefault(entry.product_id, []).append(entry)
    routings_by_product: dict[int, list[RoutingRef]] = {}
    for routing in routings:
        routings_by_product.setdefault(routing.product_id, []).append(routing)
    allocations_by_product: dict[int, list[Allocation]] = {}
    for allocation in allocations:
        allocations_by_product.setdefault(allocation.product_id, []).append(allocation)
    shipped_by_product: dict[int, list[ShippedOrderRef]] = {}
    for order in shipped_orders:
        shipped_by_product.setdefault(order.product_id, []).append(order)
    feedback_by_product = {f.product_id: f for f in feedback}
    expires_before = _months_before(today, expiry_months)

    estimates: list[StockEstimate] = []
    for product_id in sorted(entries_by_product):
        product_feedback = feedback_by_product.get(product_id)
        if product_feedback is not None and product_feedback.kind == "not_stocked":
            continue
        product_entries = entries_by_product[product_id]
        reported = {name for e in product_entries for name in e.process_names}
        chain = _process_chain(routings_by_product.get(product_id, []), reported)
        for index, process in enumerate(chain):
            if (
                product_feedback is not None
                and product_feedback.process_name != process
            ):
                continue
            estimate = _estimate_one(
                product_id,
                product_entries,
                process,
                chain[index + 1] if index + 1 < len(chain) else None,
                allocations_by_product.get(product_id, []),
                shipped_by_product.get(product_id, []),
                product_feedback,
                expires_before,
            )
            if estimate is not None:
                estimates.append(estimate)
    return estimates
