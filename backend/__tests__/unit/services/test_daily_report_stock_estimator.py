"""日報からの作り置き（先行着手）の推定のテスト (Issue #591)。"""

from datetime import date

from app.services.daily_report_allocator import ActualEntry, Allocation, RoutingRef
from app.services.daily_report_stock_estimator import (
    ShippedOrderRef,
    StockEstimate,
    StockFeedback,
    estimate_stock,
)

PRODUCT = 100
TODAY = date(2026, 10, 29)
# プレス → 洗浄（日報に出ない）→ カシメ → クグシ
ROUTINGS = [
    RoutingRef(id=11, product_id=PRODUCT, sequence_order=1, process_name="プレス"),
    RoutingRef(id=12, product_id=PRODUCT, sequence_order=2, process_name="洗浄"),
    RoutingRef(id=13, product_id=PRODUCT, sequence_order=3, process_name="カシメ"),
    RoutingRef(id=14, product_id=PRODUCT, sequence_order=4, process_name="クグシ"),
]

_next_id = iter(range(1, 10_000))


def _entry(
    work_date: date | None,
    process: str | tuple[str, ...],
    good: int,
    processed: int | None = None,
    product_id: int = PRODUCT,
) -> ActualEntry:
    return ActualEntry(
        entry_id=next(_next_id),
        work_date=work_date,
        product_id=product_id,
        customer_id=None,
        process_names=(process,) if isinstance(process, str) else process,
        good_qty=good,
        processed_qty=good if processed is None else processed,
    )


def _alloc(order_id: int, process: str, work_date: date, qty: int) -> Allocation:
    return Allocation(
        order_id=order_id,
        product_id=PRODUCT,
        process_name=process,
        work_date=work_date,
        qty=qty,
    )


def _estimate(
    entries,
    allocations=(),
    shipped=(),
    feedback=(),
    routings=ROUTINGS,
) -> list[tuple[str, str | None, int]]:
    return [
        (e.process_name, e.next_process_name, e.qty)
        for e in estimate_stock(
            entries, routings, allocations, shipped, feedback, today=TODAY
        )
    ]


class TestMovements:
    def test_good_qty_adds_and_next_process_processed_qty_consumes(self):
        entries = [
            _entry(date(2026, 10, 1), "プレス", 100),
            # カシメ 40 加工（不良 5）: 作り置きのプレスを 40 使っている
            _entry(date(2026, 10, 2), "カシメ", 35, processed=40),
        ]

        assert _estimate(entries) == [
            ("プレス", "カシメ", 60),
            # 日報に出てくる最後の工程の後（送品で減る）
            ("カシメ", None, 35),
        ]

    def test_processes_not_in_daily_reports_are_skipped(self):
        # 洗浄は日報に出てこないので、プレスの次はカシメ
        entries = [_entry(date(2026, 10, 1), "プレス", 10)]

        estimates = estimate_stock(entries, ROUTINGS, [], [], [], today=TODAY)

        assert estimates == [
            StockEstimate(
                product_id=PRODUCT,
                process_name="プレス",
                next_process_name=None,
                qty=10,
                last_movement_date=date(2026, 10, 1),
            )
        ]

    def test_never_goes_below_zero(self):
        entries = [
            _entry(date(2026, 10, 1), "プレス", 10),
            # 前の工程の日報が漏れていた: 0 にして、以降の増減はそこから
            _entry(date(2026, 10, 2), "カシメ", 30),
            _entry(date(2026, 10, 3), "プレス", 20),
        ]

        assert ("プレス", "カシメ", 20) in _estimate(entries)

    def test_same_day_adds_before_consuming(self):
        entries = [
            _entry(date(2026, 10, 1), "カシメ", 50),
            _entry(date(2026, 10, 1), "プレス", 50),
        ]

        # 同じ日にプレスしてカシメた 50 はプレスの後に残らない（カシメの後は送品待ち）
        assert _estimate(entries) == [("カシメ", None, 50)]

    def test_entry_for_two_processes_counts_both(self):
        # 「カシメ、仕上げ加工」→ カシメ・クグシ
        entries = [_entry(date(2026, 10, 1), ("カシメ", "クグシ"), 30)]

        assert _estimate(entries) == [("クグシ", None, 30)]

    def test_entries_without_work_date_are_ignored(self):
        assert _estimate([_entry(None, "プレス", 10)]) == []

    def test_shipped_orders_consume_last_process(self):
        entries = [_entry(date(2026, 9, 1), "プレス", 100)]
        shipped = [
            ShippedOrderRef(
                product_id=PRODUCT, quantity=30, shipped_on=date(2026, 9, 5)
            ),
            # 送品日が分からない受注は使えない
            ShippedOrderRef(product_id=PRODUCT, quantity=50, shipped_on=None),
            ShippedOrderRef(product_id=999, quantity=50, shipped_on=date(2026, 9, 5)),
        ]

        assert _estimate(entries, shipped=shipped) == [("プレス", None, 70)]

    def test_old_stock_expires(self):
        entries = [
            # 最後の増減が 6 か月より前（2026-04-29 より前）
            _entry(date(2026, 4, 28), "プレス", 10, product_id=1),
            _entry(date(2026, 4, 29), "プレス", 10, product_id=2),
        ]
        routings = [
            RoutingRef(id=1, product_id=1, sequence_order=1, process_name="プレス"),
            RoutingRef(id=2, product_id=2, sequence_order=1, process_name="プレス"),
        ]

        estimates = estimate_stock(entries, routings, [], [], [], today=TODAY)

        assert [(e.product_id, e.qty) for e in estimates] == [(2, 10)]


class TestAttachedToOrders:
    def test_work_in_progress_of_orders_is_not_stock(self):
        entries = [
            _entry(date(2026, 10, 1), "プレス", 150),
            _entry(date(2026, 10, 2), "カシメ", 40),
        ]
        allocations = [
            # 受注1: プレス 100・カシメ 40 → プレスの後に 60 が受注1の仕掛かり
            _alloc(1, "プレス", date(2026, 10, 1), 100),
            _alloc(1, "カシメ", date(2026, 10, 2), 40),
        ]

        # プレスの後の仕掛かり 110 のうち、受注1の 60 を除いた 50 が作り置き
        # カシメの後の 40 は受注1に割り付いている（送品待ち）
        assert _estimate(entries, allocations) == [("プレス", "カシメ", 50)]

    def test_order_made_from_stock_reduces_stock(self):
        entries = [
            # 受注より前に作り置き
            _entry(date(2026, 9, 1), "プレス", 100),
            # 受注2が来て、作り置きからカシメ 60
            _entry(date(2026, 10, 5), "カシメ", 60),
        ]
        allocations = [_alloc(2, "カシメ", date(2026, 10, 5), 60)]

        assert _estimate(entries, allocations) == [("プレス", "カシメ", 40)]


class TestFeedback:
    ENTRIES = [
        _entry(date(2026, 10, 1), "プレス", 100),
        _entry(date(2026, 10, 2), "カシメ", 40),
    ]

    def test_not_stocked_hides_product(self):
        feedback = [StockFeedback(product_id=PRODUCT, kind="not_stocked")]

        assert _estimate(self.ENTRIES, feedback=feedback) == []

    def test_stock_process_shows_only_that_process(self):
        feedback = [
            StockFeedback(
                product_id=PRODUCT, kind="stock_process", process_name="カシメ"
            )
        ]

        assert _estimate(self.ENTRIES, feedback=feedback) == [("カシメ", None, 40)]

    def test_stock_process_not_in_reports_shows_nothing(self):
        feedback = [
            StockFeedback(product_id=PRODUCT, kind="stock_process", process_name="洗浄")
        ]

        assert _estimate(self.ENTRIES, feedback=feedback) == []

    def test_baseline_replaces_count_at_baseline_date(self):
        entries = [
            _entry(date(2026, 9, 1), "プレス", 500),
            # 基準日以前の日報は使わない
            _entry(date(2026, 9, 10), "カシメ", 100),
            # 基準日より後の増減は反映する
            _entry(date(2026, 9, 20), "プレス", 30),
            _entry(date(2026, 9, 21), "カシメ", 10),
        ]
        feedback = [
            StockFeedback(
                product_id=PRODUCT,
                kind="stock_process",
                process_name="プレス",
                baseline_qty=50,
                baseline_date=date(2026, 9, 10),
            )
        ]

        estimates = estimate_stock(entries, ROUTINGS, [], [], feedback, today=TODAY)

        assert [(e.process_name, e.qty, e.last_movement_date) for e in estimates] == [
            ("プレス", 70, date(2026, 9, 21))
        ]

    def test_baseline_keeps_orders_work_in_progress_out(self):
        entries = [
            _entry(date(2026, 9, 1), "プレス", 100),
            # 基準日の後に受注1がカシメ 100（基準日の時点で受注1の仕掛かりだった分）
            _entry(date(2026, 9, 15), "カシメ", 100),
        ]
        allocations = [
            _alloc(1, "プレス", date(2026, 9, 1), 100),
            _alloc(1, "カシメ", date(2026, 9, 15), 100),
        ]
        feedback = [
            StockFeedback(
                product_id=PRODUCT,
                kind="stock_process",
                process_name="プレス",
                baseline_qty=20,
                baseline_date=date(2026, 9, 10),
            )
        ]

        # 基準値 20 は受注に割り付いていない分。受注1がカシメで使った分では減らない
        assert _estimate(entries, allocations, feedback=feedback) == [
            ("プレス", "カシメ", 20)
        ]

    def test_recent_baseline_without_movements_does_not_expire(self):
        feedback = [
            StockFeedback(
                product_id=PRODUCT,
                kind="stock_process",
                process_name="プレス",
                baseline_qty=15,
                baseline_date=date(2026, 10, 20),
            )
        ]
        entries = [_entry(date(2026, 1, 5), "プレス", 100)]

        assert _estimate(entries, feedback=feedback) == [("プレス", None, 15)]
