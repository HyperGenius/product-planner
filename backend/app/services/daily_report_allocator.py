"""日報の実績の受注への割り付けと進捗の算出 (Issue #490, 親Issue #485)。

DB から切り離した純粋なロジック。照合済みの明細（`ActualEntry`）・割り付けの候補になる受注
（`OrderRef`）・工程ルート（`RoutingRef`）を受け取り、受注×工程ごとの進捗と未割当の実績を返す。
DB の読み書きは `daily_report_allocation_service`。

割り付け:
* 単位は (製品, マスタの工程名)。明細を加工日の古い順に、同じ製品でその工程を持つ受注へ
  **納期の早い順**に充当する（受注数量を満たしたら、あふれた分を次の受注へ）。納期は
  `deadline_date`（顧客希望納期）、無ければ `confirmed_deadline`。どちらも無い受注は最後
* 顧客が照合できている明細は、同じ顧客の受注にだけ充当する
* 1つの日報の工程名が複数の工程に対応する場合（「カシメ、仕上げ加工」）は、各工程に同じ数量を計上する
* 加工日が受注日（`order_date` の JST 暦日）より前の実績はその受注に充当しない。在庫の先行生産や、
  出荷済みで候補から外れた過去の受注の実績が、後から入った受注を完了に見せるのを避けるため
  （充当できなかった分は未割当 `before_order_date` として残り、見込み生産の発見に使える）
* どの受注にも充当できなかった数量は未割当として返す

進捗の状態（受注×工程）:
* completed: 割り付けた良品数が受注数量以上、または後の工程（`sequence_order` が大きい工程）に
  実績がある。日報に出てこない工程（洗浄・内職・検査など）も同じ規則で完了になる
* in_progress: 実績があり、完了でない
* not_started: それ以外
"""

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date
from typing import Literal

ProgressStatus = Literal["not_started", "in_progress", "completed"]
CompletedBy = Literal["quantity", "later_process"]
UnallocatedReason = Literal[
    "no_candidate_order", "before_order_date", "exceeds_order_qty", "no_work_date"
]


@dataclass(frozen=True)
class ActualEntry:
    """照合済みの明細1行（良品数が1以上のもの）。"""

    entry_id: int
    work_date: date | None
    product_id: int
    customer_id: int | None
    # マスタの工程名（1:N）
    process_names: tuple[str, ...]
    good_qty: int


@dataclass(frozen=True)
class OrderRef:
    """割り付けの候補になる受注（status が confirmed / in_progress のもの）。"""

    id: int
    product_id: int
    customer_id: int | None
    quantity: int
    # deadline_date、無ければ confirmed_deadline
    deadline: date | None
    # order_date の JST 暦日
    order_date: date | None


@dataclass(frozen=True)
class RoutingRef:
    id: int
    product_id: int
    sequence_order: int
    process_name: str | None


@dataclass(frozen=True)
class ProcessProgress:
    order_id: int
    process_routing_id: int
    good_qty: int
    first_actual_date: date | None
    last_actual_date: date | None
    status: ProgressStatus
    completed_by: CompletedBy | None


@dataclass(frozen=True)
class UnallocatedActual:
    entry_id: int
    product_id: int
    customer_id: int | None
    process_name: str
    work_date: date | None
    qty: int
    reason: UnallocatedReason


@dataclass
class AllocationResult:
    progress: list[ProcessProgress] = field(default_factory=list)
    unallocated: list[UnallocatedActual] = field(default_factory=list)


@dataclass
class _Allocated:
    qty: int = 0
    first: date | None = None
    last: date | None = None

    def add(self, qty: int, work_date: date) -> None:
        self.qty += qty
        self.first = work_date if self.first is None else min(self.first, work_date)
        self.last = work_date if self.last is None else max(self.last, work_date)


def _routing_by_process(
    routings: Iterable[RoutingRef],
) -> dict[tuple[int, str], RoutingRef]:
    """(製品, 工程名) → 工程ルートの行。

    同じ製品に同じ工程名の行が複数あるときは、日報からはどの行か区別できないので
    `sequence_order` の最も小さい行に計上する（後の行は「後の工程に実績がある」規則で完了になりうる）。
    """
    index: dict[tuple[int, str], RoutingRef] = {}
    for routing in sorted(routings, key=lambda r: (r.sequence_order, r.id)):
        name = (routing.process_name or "").strip()
        if name:
            index.setdefault((routing.product_id, name), routing)
    return index


def _deadline_order_key(order: OrderRef) -> tuple[bool, date, int]:
    return (order.deadline is None, order.deadline or date.min, order.id)


def allocate_actuals(
    entries: Iterable[ActualEntry],
    orders: Iterable[OrderRef],
    routings: Iterable[RoutingRef],
) -> AllocationResult:
    routing_list = list(routings)
    routing_index = _routing_by_process(routing_list)
    sorted_orders = sorted(orders, key=_deadline_order_key)
    orders_by_product: dict[int, list[OrderRef]] = {}
    for order in sorted_orders:
        orders_by_product.setdefault(order.product_id, []).append(order)

    allocated: dict[tuple[int, int], _Allocated] = {}
    result = AllocationResult()

    for entry in sorted(
        entries,
        key=lambda e: (e.work_date is None, e.work_date or date.min, e.entry_id),
    ):
        if entry.good_qty <= 0:
            continue
        for process_name in dict.fromkeys(entry.process_names):
            reason, remaining = _allocate_one(
                entry, process_name, routing_index, orders_by_product, allocated
            )
            if reason is not None:
                result.unallocated.append(
                    UnallocatedActual(
                        entry_id=entry.entry_id,
                        product_id=entry.product_id,
                        customer_id=entry.customer_id,
                        process_name=process_name,
                        work_date=entry.work_date,
                        qty=remaining,
                        reason=reason,
                    )
                )

    result.progress = _progress_rows(sorted_orders, routing_list, allocated)
    return result


def _allocate_one(
    entry: ActualEntry,
    process_name: str,
    routing_index: dict[tuple[int, str], RoutingRef],
    orders_by_product: dict[int, list[OrderRef]],
    allocated: dict[tuple[int, int], _Allocated],
) -> tuple[UnallocatedReason | None, int]:
    """明細1行の1工程分を充当する。充当しきれなければ (理由, 残数) を返す。"""
    routing = routing_index.get((entry.product_id, process_name))
    candidates = [
        order
        for order in orders_by_product.get(entry.product_id, [])
        if entry.customer_id is None or order.customer_id == entry.customer_id
    ]
    if routing is None or not candidates:
        return "no_candidate_order", entry.good_qty

    work_date = entry.work_date
    if work_date is None:
        return "no_work_date", entry.good_qty

    eligible = [
        order
        for order in candidates
        if order.order_date is None or order.order_date <= work_date
    ]
    if not eligible:
        return "before_order_date", entry.good_qty

    remaining = entry.good_qty
    for order in eligible:
        slot = allocated.setdefault((order.id, routing.id), _Allocated())
        capacity = order.quantity - slot.qty
        if capacity <= 0:
            continue
        take = min(capacity, remaining)
        slot.add(take, work_date)
        remaining -= take
        if remaining == 0:
            return None, 0
    return "exceeds_order_qty", remaining


def _progress_rows(
    orders: list[OrderRef],
    routings: list[RoutingRef],
    allocated: dict[tuple[int, int], _Allocated],
) -> list[ProcessProgress]:
    routings_by_product: dict[int, list[RoutingRef]] = {}
    for routing in sorted(routings, key=lambda r: (r.sequence_order, r.id)):
        routings_by_product.setdefault(routing.product_id, []).append(routing)

    rows: list[ProcessProgress] = []
    for order in sorted(orders, key=lambda o: o.id):
        product_routings = routings_by_product.get(order.product_id, [])
        # 後の工程から順に見て「より後の工程に実績があるか」を持ち回る
        # （sequence_order は製品内で UNIQUE なので、後ろの行は必ず後の工程）
        has_later_actual = False
        order_rows: list[ProcessProgress] = []
        for routing in reversed(product_routings):
            slot = allocated.get((order.id, routing.id)) or _Allocated()
            status: ProgressStatus
            completed_by: CompletedBy | None = None
            if order.quantity > 0 and slot.qty >= order.quantity:
                status, completed_by = "completed", "quantity"
            elif has_later_actual:
                status, completed_by = "completed", "later_process"
            elif slot.qty > 0:
                status = "in_progress"
            else:
                status = "not_started"
            order_rows.append(
                ProcessProgress(
                    order_id=order.id,
                    process_routing_id=routing.id,
                    good_qty=slot.qty,
                    first_actual_date=slot.first,
                    last_actual_date=slot.last,
                    status=status,
                    completed_by=completed_by,
                )
            )
            if slot.qty > 0:
                has_later_actual = True
        rows.extend(reversed(order_rows))
    return rows
