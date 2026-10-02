"""日報の実績の割り付けと進捗の算出のテスト (Issue #490)。"""

from datetime import date

from app.services.daily_report_allocator import (
    ActualEntry,
    OrderRef,
    ProcessProgress,
    RoutingRef,
    UnallocatedActual,
    allocate_actuals,
)

PRODUCT = 100
OTHER_PRODUCT = 200

# 製品 100 の工程: プレス(1) → 洗浄(2、日報に出ない) → カシメ(3) → クグシ(4) → 検査(5、日報に出ない)
ROUTINGS = [
    RoutingRef(id=11, product_id=PRODUCT, sequence_order=1, process_name="プレス"),
    RoutingRef(id=12, product_id=PRODUCT, sequence_order=2, process_name="洗浄"),
    RoutingRef(id=13, product_id=PRODUCT, sequence_order=3, process_name="カシメ"),
    RoutingRef(id=14, product_id=PRODUCT, sequence_order=4, process_name="クグシ"),
    RoutingRef(id=15, product_id=PRODUCT, sequence_order=5, process_name="検査"),
]


def _order(
    order_id: int,
    quantity: int,
    deadline: date | None,
    *,
    customer_id: int | None = 10,
    product_id: int = PRODUCT,
    order_date: date | None = date(2026, 9, 1),
) -> OrderRef:
    return OrderRef(
        id=order_id,
        product_id=product_id,
        customer_id=customer_id,
        quantity=quantity,
        deadline=deadline,
        order_date=order_date,
    )


def _entry(
    entry_id: int,
    qty: int,
    process: str | tuple[str, ...],
    work_date: date | None = date(2026, 9, 10),
    *,
    customer_id: int | None = None,
    product_id: int = PRODUCT,
) -> ActualEntry:
    return ActualEntry(
        entry_id=entry_id,
        work_date=work_date,
        product_id=product_id,
        customer_id=customer_id,
        process_names=(process,) if isinstance(process, str) else process,
        good_qty=qty,
    )


def _progress(result, order_id: int) -> dict[str, ProcessProgress]:
    by_routing = {r.id: r.process_name or "" for r in ROUTINGS}
    return {
        by_routing[p.process_routing_id]: p
        for p in result.progress
        if p.order_id == order_id
    }


class TestAllocation:
    def test_fills_orders_in_deadline_order_and_overflows_to_next(self):
        orders = [
            _order(2, 100, date(2026, 10, 20)),
            _order(1, 100, date(2026, 10, 10)),
            _order(3, 100, date(2026, 10, 30)),
        ]
        entries = [
            _entry(1, 80, "プレス", date(2026, 9, 10)),
            _entry(2, 70, "プレス", date(2026, 9, 11)),
        ]

        result = allocate_actuals(entries, orders, ROUTINGS)

        first = _progress(result, 1)["プレス"]
        second = _progress(result, 2)["プレス"]
        third = _progress(result, 3)["プレス"]
        assert (first.good_qty, first.status, first.completed_by) == (
            100,
            "completed",
            "quantity",
        )
        assert first.first_actual_date == date(2026, 9, 10)
        assert first.last_actual_date == date(2026, 9, 11)
        # 2件目の明細のあふれた 50 が次の納期の受注へ
        assert (second.good_qty, second.status) == (50, "in_progress")
        assert second.first_actual_date == second.last_actual_date == date(2026, 9, 11)
        assert (third.good_qty, third.status) == (0, "not_started")
        assert third.first_actual_date is None
        assert result.unallocated == []

    def test_overflow_beyond_all_orders_is_unallocated(self):
        orders = [_order(1, 100, date(2026, 10, 10))]
        entries = [_entry(7, 130, "プレス", customer_id=10)]

        result = allocate_actuals(entries, orders, ROUTINGS)

        assert _progress(result, 1)["プレス"].good_qty == 100
        assert result.unallocated == [
            UnallocatedActual(
                entry_id=7,
                product_id=PRODUCT,
                customer_id=10,
                process_name="プレス",
                work_date=date(2026, 9, 10),
                qty=30,
                reason="exceeds_order_qty",
            )
        ]

    def test_entries_are_applied_in_work_date_order(self):
        orders = [
            _order(1, 100, date(2026, 10, 10)),
            _order(2, 100, date(2026, 10, 20)),
        ]
        # ID の順と加工日の順が逆でも、加工日の古い明細から先に充当する
        entries = [
            _entry(1, 60, "プレス", date(2026, 9, 12)),
            _entry(2, 60, "プレス", date(2026, 9, 10)),
        ]

        result = allocate_actuals(entries, orders, ROUTINGS)

        first = _progress(result, 1)["プレス"]
        second = _progress(result, 2)["プレス"]
        assert (first.first_actual_date, first.last_actual_date) == (
            date(2026, 9, 10),
            date(2026, 9, 12),
        )
        assert second.first_actual_date == date(2026, 9, 12)

    def test_deadline_falls_back_to_confirmed_deadline_and_missing_goes_last(self):
        # 納期の解決（deadline_date → confirmed_deadline）は呼び出し側で deadline に入れる
        orders = [
            _order(1, 50, None),
            _order(2, 50, date(2026, 10, 30)),
            _order(3, 50, date(2026, 10, 1)),
        ]
        entries = [_entry(1, 120, "プレス")]

        result = allocate_actuals(entries, orders, ROUTINGS)

        assert _progress(result, 3)["プレス"].good_qty == 50
        assert _progress(result, 2)["プレス"].good_qty == 50
        assert _progress(result, 1)["プレス"].good_qty == 20

    def test_same_deadline_is_ordered_by_order_id(self):
        orders = [_order(5, 50, date(2026, 10, 1)), _order(4, 50, date(2026, 10, 1))]

        result = allocate_actuals([_entry(1, 50, "プレス")], orders, ROUTINGS)

        assert _progress(result, 4)["プレス"].good_qty == 50
        assert _progress(result, 5)["プレス"].good_qty == 0

    def test_one_report_process_counts_for_each_mapped_process(self):
        orders = [_order(1, 100, date(2026, 10, 10))]
        entries = [_entry(1, 40, ("カシメ", "クグシ"))]

        result = allocate_actuals(entries, orders, ROUTINGS)

        progress = _progress(result, 1)
        assert progress["カシメ"].good_qty == 40
        assert progress["クグシ"].good_qty == 40

    def test_matched_customer_restricts_candidates(self):
        orders = [
            _order(1, 100, date(2026, 10, 1), customer_id=10),
            _order(2, 100, date(2026, 10, 30), customer_id=20),
        ]
        entries = [
            # 顧客 20 の明細は、納期の早い顧客 10 の受注を飛ばして顧客 20 の受注へ
            _entry(1, 30, "プレス", customer_id=20),
            # 顧客が照合できない明細は顧客で絞り込まない
            _entry(2, 30, "プレス", customer_id=None),
            # 該当顧客の受注が無ければ未割当
            _entry(3, 30, "プレス", customer_id=30),
        ]

        result = allocate_actuals(entries, orders, ROUTINGS)

        assert _progress(result, 1)["プレス"].good_qty == 30
        assert _progress(result, 2)["プレス"].good_qty == 30
        assert [(u.entry_id, u.reason) for u in result.unallocated] == [
            (3, "no_candidate_order")
        ]

    def test_no_candidate_when_product_has_no_order_or_no_such_process(self):
        orders = [_order(1, 100, date(2026, 10, 10))]
        entries = [
            _entry(1, 10, "プレス", product_id=OTHER_PRODUCT),
            _entry(2, 10, "溶接"),
        ]

        result = allocate_actuals(entries, orders, ROUTINGS)

        assert [(u.entry_id, u.process_name, u.reason) for u in result.unallocated] == [
            (1, "プレス", "no_candidate_order"),
            (2, "溶接", "no_candidate_order"),
        ]

    def test_actuals_before_order_date_are_not_allocated(self):
        orders = [
            _order(1, 100, date(2026, 10, 1), order_date=date(2026, 9, 15)),
            _order(2, 100, date(2026, 10, 30), order_date=date(2026, 9, 5)),
        ]
        entries = [
            # 受注1の受注日より前なので、納期の遅い受注2へ
            _entry(1, 30, "プレス", date(2026, 9, 10)),
            # どの受注の受注日よりも前（在庫の先行生産・出荷済み受注の実績）
            _entry(2, 30, "プレス", date(2026, 9, 1)),
            # 受注日当日は充当する
            _entry(3, 30, "プレス", date(2026, 9, 15)),
        ]

        result = allocate_actuals(entries, orders, ROUTINGS)

        assert _progress(result, 1)["プレス"].good_qty == 30
        assert _progress(result, 2)["プレス"].good_qty == 30
        assert [(u.entry_id, u.reason) for u in result.unallocated] == [
            (2, "before_order_date")
        ]

    def test_entry_without_work_date_is_unallocated(self):
        orders = [_order(1, 100, date(2026, 10, 10))]

        result = allocate_actuals([_entry(1, 10, "プレス", None)], orders, ROUTINGS)

        assert _progress(result, 1)["プレス"].good_qty == 0
        assert [(u.reason, u.qty) for u in result.unallocated] == [("no_work_date", 10)]

    def test_zero_good_qty_is_ignored(self):
        orders = [_order(1, 100, date(2026, 10, 10))]

        result = allocate_actuals([_entry(1, 0, "プレス")], orders, ROUTINGS)

        assert _progress(result, 1)["プレス"].status == "not_started"
        assert result.unallocated == []

    def test_duplicate_process_name_counts_for_the_earliest_routing(self):
        routings = [
            RoutingRef(
                id=21, product_id=PRODUCT, sequence_order=1, process_name="プレス"
            ),
            RoutingRef(
                id=22, product_id=PRODUCT, sequence_order=2, process_name=" プレス"
            ),
        ]
        orders = [_order(1, 100, date(2026, 10, 10))]

        result = allocate_actuals([_entry(1, 40, "プレス")], orders, routings)

        progress = {p.process_routing_id: p for p in result.progress}
        assert progress[21].good_qty == 40
        assert progress[22].good_qty == 0


class TestProgressStatus:
    def test_later_process_actual_completes_earlier_processes(self):
        orders = [_order(1, 100, date(2026, 10, 10))]
        # カシメ（3）に実績があれば、プレス（1）・日報に出ない洗浄（2）は完了
        entries = [_entry(1, 20, "カシメ")]

        result = allocate_actuals(entries, orders, ROUTINGS)

        progress = _progress(result, 1)
        assert (progress["プレス"].status, progress["プレス"].completed_by) == (
            "completed",
            "later_process",
        )
        assert progress["プレス"].good_qty == 0
        assert (progress["洗浄"].status, progress["洗浄"].completed_by) == (
            "completed",
            "later_process",
        )
        assert progress["カシメ"].status == "in_progress"
        # 後の工程に実績が無い工程は未着手のまま（日報に出ない検査も）
        assert progress["クグシ"].status == "not_started"
        assert progress["検査"].status == "not_started"

    def test_process_not_in_reports_stays_not_started_without_later_actuals(self):
        orders = [_order(1, 100, date(2026, 10, 10))]

        result = allocate_actuals([_entry(1, 100, "プレス")], orders, ROUTINGS)

        progress = _progress(result, 1)
        assert progress["プレス"].completed_by == "quantity"
        assert progress["洗浄"].status == "not_started"

    def test_completion_is_judged_per_order(self):
        orders = [
            _order(1, 100, date(2026, 10, 10)),
            _order(2, 100, date(2026, 10, 20)),
        ]
        # クグシの実績は受注1にしか割り付かないので、受注2のプレスは完了にならない
        entries = [_entry(1, 150, "プレス"), _entry(2, 10, "クグシ")]

        result = allocate_actuals(entries, orders, ROUTINGS)

        assert _progress(result, 1)["カシメ"].completed_by == "later_process"
        assert _progress(result, 2)["プレス"].status == "in_progress"
        assert _progress(result, 2)["カシメ"].status == "not_started"

    def test_every_routing_of_every_candidate_order_has_a_row(self):
        orders = [_order(1, 100, date(2026, 10, 10)), _order(2, 100, None)]

        result = allocate_actuals([], orders, ROUTINGS)

        assert [(p.order_id, p.process_routing_id) for p in result.progress] == [
            (1, 11),
            (1, 12),
            (1, 13),
            (1, 14),
            (1, 15),
            (2, 11),
            (2, 12),
            (2, 13),
            (2, 14),
            (2, 15),
        ]
        assert {p.status for p in result.progress} == {"not_started"}

    def test_zero_quantity_order_is_not_completed_by_quantity(self):
        orders = [_order(1, 0, date(2026, 10, 10))]

        result = allocate_actuals([_entry(1, 10, "プレス")], orders, ROUTINGS)

        assert _progress(result, 1)["プレス"].status == "not_started"
        assert [u.reason for u in result.unallocated] == ["exceeds_order_qty"]

    def test_recomputation_is_deterministic(self):
        orders = [
            _order(1, 100, date(2026, 10, 10)),
            _order(2, 100, date(2026, 10, 20)),
        ]
        entries = [_entry(1, 150, "プレス"), _entry(2, 30, ("カシメ", "クグシ"))]

        assert allocate_actuals(entries, orders, ROUTINGS) == allocate_actuals(
            list(reversed(entries)), list(reversed(orders)), list(reversed(ROUTINGS))
        )
