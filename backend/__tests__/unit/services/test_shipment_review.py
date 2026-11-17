# __tests__/unit/services/test_shipment_review.py
"""弥生で送品済みなのに日報の進捗が追いついていない受注の判定 (Issue #683)。値はすべて架空。"""

from datetime import date
from typing import Any

import pytest
from app.services.daily_report_allocator import RoutingRef
from app.services.shipment_review import (
    ReviewOrder,
    ReviewShipment,
    ReviewUnallocated,
    review_orders,
)

PRODUCT = 101
ORDER = 1001
ORDER_DATE = date(2026, 10, 1)
SALES_DATE = date(2026, 10, 20)

# 製品 101 の工程: プレス(1) → カシメ(2) → 検査(3)
ROUTINGS = [
    RoutingRef(id=11, product_id=PRODUCT, sequence_order=1, process_name="プレス"),
    RoutingRef(id=12, product_id=PRODUCT, sequence_order=2, process_name="カシメ"),
    RoutingRef(id=13, product_id=PRODUCT, sequence_order=3, process_name="検査"),
]


def _order(**values: Any) -> ReviewOrder:
    base: dict[str, Any] = {
        "id": ORDER,
        "product_id": PRODUCT,
        "status": "in_progress",
        "order_date": ORDER_DATE,
    }
    base.update(values)
    return ReviewOrder(**base)


def _unallocated(reason: str, **values: Any) -> ReviewUnallocated:
    base: dict[str, Any] = {
        "product_id": PRODUCT,
        "process_name": "カシメ",
        "reason": reason,
        "work_date": date(2026, 10, 10),
        "qty": 30,
    }
    base.update(values)
    return ReviewUnallocated(**base)


def _review(
    *,
    orders=None,
    shipped_qty: int = 100,
    good: dict[tuple[int, int], int] | None = None,
    routings=ROUTINGS,
    untracked=(),
    unallocated=(),
):
    return review_orders(
        orders if orders is not None else [_order()],
        {ORDER: ReviewShipment(shipped_qty=shipped_qty, last_sales_date=SALES_DATE)},
        good if good is not None else {},
        routings,
        untracked,
        unallocated,
    )


@pytest.mark.unit
class TestTarget:
    def test_shipped_over_final_good_is_review(self):
        [review] = _review(good={(ORDER, 13): 40})

        assert review.order_id == ORDER
        assert review.shipped_qty == 100
        assert review.final_process_name == "検査"
        assert review.final_good_qty == 40

    def test_final_good_covers_shipment_is_not_review(self):
        assert _review(good={(ORDER, 13): 100}) == []

    def test_order_without_progress_rows_counts_as_zero(self):
        [review] = _review(good={})

        assert review.final_good_qty == 0

    def test_untracked_last_process_uses_previous_tracked_process(self):
        # 検査は日報で追わない → 最後の工程はカシメ。カシメが送品数に届いていれば対象にしない
        assert _review(good={(ORDER, 12): 100}, untracked=["検査"]) == []

        [review] = _review(good={(ORDER, 12): 50}, untracked=[" 検査 "])
        assert review.final_process_name == "カシメ"
        assert review.final_good_qty == 50

    def test_all_processes_untracked_is_not_review(self):
        assert _review(untracked=["プレス", "カシメ", "検査"]) == []

    @pytest.mark.parametrize("status", ["draft", "pending_approval", "shipped"])
    def test_only_confirmed_or_in_progress(self, status):
        assert _review(orders=[_order(status=status)]) == []

    def test_order_without_shipment_is_not_review(self):
        assert _review(shipped_qty=0) == []
        assert review_orders([_order()], {}, {}, ROUTINGS, (), ()) == []


@pytest.mark.unit
class TestCause:
    def test_no_routing_comes_first(self):
        # 工程が無い製品の実績は no_routing_process になるが、工程なしを先に判定する
        [review] = _review(
            routings=[], unallocated=[_unallocated("no_routing_process")]
        )

        assert review.cause == "no_routing"
        assert review.final_process_name is None

    def test_process_mismatch_before_customer_or_stock(self):
        [review] = _review(
            unallocated=[
                _unallocated("no_candidate_order", qty=10),
                _unallocated("no_routing_process", process_name="仕上げ", qty=20),
                _unallocated("no_routing_process", process_name="仕上げ", qty=5),
            ]
        )

        assert review.cause == "process_mismatch"
        assert review.unallocated_qty == 25
        assert review.process_names == ("仕上げ",)

    @pytest.mark.parametrize("reason", ["no_candidate_order", "before_order_date"])
    def test_customer_or_stock(self, reason):
        work_date = date(2026, 9, 1) if reason == "before_order_date" else None
        [review] = _review(
            unallocated=[
                _unallocated(reason, **({"work_date": work_date} if work_date else {}))
            ]
        )

        assert review.cause == "customer_or_stock"
        assert review.unallocated_qty == 30

    def test_missing_report_when_nothing_matches(self):
        # 受注数超過・加工日なしは原因の判定に使わない
        [review] = _review(
            unallocated=[
                _unallocated("exceeds_order_qty"),
                _unallocated("no_work_date", work_date=None),
            ]
        )

        assert review.cause == "missing_report"
        assert review.unallocated_qty == 0
        assert review.process_names == ()

    def test_other_products_unallocated_are_ignored(self):
        [review] = _review(
            unallocated=[_unallocated("no_routing_process", product_id=999)]
        )

        assert review.cause == "missing_report"


@pytest.mark.unit
class TestPeriod:
    def test_unallocated_after_last_sales_date_is_ignored(self):
        [review] = _review(
            unallocated=[
                _unallocated("no_routing_process", work_date=date(2026, 10, 21))
            ]
        )

        assert review.cause == "missing_report"

    def test_unallocated_before_order_date_is_ignored(self):
        [review] = _review(
            unallocated=[
                _unallocated("no_routing_process", work_date=date(2026, 9, 30)),
                _unallocated("no_candidate_order", work_date=date(2026, 9, 30)),
            ]
        )

        assert review.cause == "missing_report"

    def test_stock_before_order_date_within_expiry(self):
        # 作り置きは受注日より前に作るので、受注日から作り置きの期限（6か月）まで遡る
        [review] = _review(
            unallocated=[_unallocated("before_order_date", work_date=date(2026, 4, 1))]
        )
        assert review.cause == "customer_or_stock"

        [review] = _review(
            unallocated=[_unallocated("before_order_date", work_date=date(2026, 3, 31))]
        )
        assert review.cause == "missing_report"

    def test_unallocated_without_work_date_is_included(self):
        [review] = _review(
            unallocated=[_unallocated("no_routing_process", work_date=None)]
        )

        assert review.cause == "process_mismatch"
