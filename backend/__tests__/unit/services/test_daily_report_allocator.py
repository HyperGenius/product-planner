"""日報の実績の割り付けと進捗の算出のテスト (Issue #490)。"""

from datetime import date

from app.services.daily_report_allocator import (
    ActualEntry,
    Allocation,
    OrderRef,
    ProcessProgress,
    RoutingRef,
    StockAssignment,
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

    def test_records_each_allocation_to_an_order(self):
        """作り置きの推定（#591）で受注に割り付いた仕掛かりを除くため、受注ごとの充当を返す。"""
        orders = [
            _order(1, 100, date(2026, 10, 10)),
            _order(2, 100, date(2026, 10, 20)),
        ]
        entries = [
            _entry(1, 130, "プレス", date(2026, 9, 10)),
            _entry(2, 20, ("カシメ", "クグシ"), date(2026, 9, 11)),
        ]

        result = allocate_actuals(entries, orders, ROUTINGS)

        assert result.allocations == [
            Allocation(1, PRODUCT, "プレス", date(2026, 9, 10), 100),
            Allocation(2, PRODUCT, "プレス", date(2026, 9, 10), 30),
            Allocation(1, PRODUCT, "カシメ", date(2026, 9, 11), 20),
            Allocation(1, PRODUCT, "クグシ", date(2026, 9, 11), 20),
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

    def test_no_candidate_when_product_has_no_order(self):
        orders = [_order(1, 100, date(2026, 10, 10))]
        routings = [
            *ROUTINGS,
            RoutingRef(
                id=21, product_id=OTHER_PRODUCT, sequence_order=1, process_name="プレス"
            ),
        ]
        entries = [_entry(1, 10, "プレス", product_id=OTHER_PRODUCT)]

        result = allocate_actuals(entries, orders, routings)

        assert [(u.entry_id, u.process_name, u.reason) for u in result.unallocated] == [
            (1, "プレス", "no_candidate_order"),
        ]

    def test_no_routing_process_takes_precedence_over_no_candidate_order(self):
        # 工程ルートに無い工程は、受注の有無にかかわらず no_routing_process（Issue #542）
        orders = [_order(1, 100, date(2026, 10, 10))]
        entries = [
            # 受注はあるが工程ルートに「溶接」が無い
            _entry(1, 10, "溶接"),
            # 工程ルートが1件も無い製品（受注も無い）
            _entry(2, 10, "プレス", product_id=OTHER_PRODUCT),
            # 加工日が無くても工程ルートの有無を先に見る
            _entry(3, 10, "溶接", None),
        ]

        result = allocate_actuals(entries, orders, ROUTINGS)

        assert [(u.entry_id, u.process_name, u.reason) for u in result.unallocated] == [
            (1, "溶接", "no_routing_process"),
            (2, "プレス", "no_routing_process"),
            (3, "溶接", "no_routing_process"),
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


class TestStockAssignment:
    """作り置きの引き当て（Issue #624）。"""

    def test_assignment_uses_entries_of_other_customer_before_order_date(self):
        # 日報の顧客先が別の顧客（誤記）で、受注日より前に作った作り置き
        orders = [_order(1, 100, date(2026, 11, 1), order_date=date(2026, 10, 21))]
        entries = [
            _entry(1, 100, "クグシ", date(2026, 10, 14), customer_id=99),
        ]
        assignments = [
            StockAssignment(
                order_id=1,
                process_name="クグシ",
                qty=100,
                assigned_on=date(2026, 11, 2),
            )
        ]

        result = allocate_actuals(entries, orders, ROUTINGS, assignments)

        progress = _progress(result, 1)
        assert progress["クグシ"].good_qty == 100
        assert progress["クグシ"].status == "completed"
        assert progress["クグシ"].first_actual_date == date(2026, 10, 14)
        # 後の工程に実績があるので前の工程も完了
        assert progress["カシメ"].status == "completed"
        assert result.unallocated == []
        assert result.allocations == [
            Allocation(
                order_id=1,
                product_id=PRODUCT,
                process_name="クグシ",
                work_date=date(2026, 10, 14),
                qty=100,
            )
        ]

    def test_assignment_takes_newest_entries_first_and_leaves_the_rest(self):
        orders = [_order(1, 100, date(2026, 11, 1), order_date=date(2026, 10, 21))]
        entries = [
            _entry(1, 60, "クグシ", date(2026, 9, 1)),
            _entry(2, 70, "クグシ", date(2026, 10, 9)),
            _entry(3, 50, "クグシ", date(2026, 10, 14)),
        ]
        assignments = [
            StockAssignment(
                order_id=1,
                process_name="クグシ",
                qty=100,
                assigned_on=date(2026, 11, 2),
            )
        ]

        result = allocate_actuals(entries, orders, ROUTINGS, assignments)

        assert _progress(result, 1)["クグシ"].good_qty == 100
        assert [(a.work_date, a.qty) for a in result.allocations] == [
            (date(2026, 10, 14), 50),
            (date(2026, 10, 9), 50),
        ]
        # 使わなかった分は通常どおり（受注日より前なので）未割当
        assert [(u.entry_id, u.qty, u.reason) for u in result.unallocated] == [
            (1, 60, "before_order_date"),
            (2, 20, "before_order_date"),
        ]

    def test_assignment_ignores_entries_after_assigned_on(self):
        orders = [_order(1, 100, date(2026, 11, 1), order_date=date(2026, 10, 21))]
        entries = [
            _entry(1, 40, "クグシ", date(2026, 10, 14)),
            # 引き当てた日より後の実績（別の顧客なので未割当）
            _entry(2, 100, "クグシ", date(2026, 10, 30), customer_id=99),
        ]
        assignments = [
            StockAssignment(
                order_id=1,
                process_name="クグシ",
                qty=100,
                assigned_on=date(2026, 10, 20),
            )
        ]

        result = allocate_actuals(entries, orders, ROUTINGS, assignments)

        assert _progress(result, 1)["クグシ"].good_qty == 40
        assert [(u.entry_id, u.qty, u.reason) for u in result.unallocated] == [
            (2, 100, "no_candidate_order")
        ]

    def test_assignment_uses_only_actuals_left_unallocated(self):
        # 他の受注に割り付いた実績は引き当てに使わない（同じ実績を二重に数えない）
        orders = [
            _order(1, 100, date(2026, 10, 10)),
            _order(2, 100, date(2026, 10, 20)),
        ]
        entries = [
            _entry(1, 30, "プレス", date(2026, 8, 20)),
            _entry(2, 150, "プレス", date(2026, 9, 10)),
        ]
        assignments = [
            StockAssignment(
                order_id=2,
                process_name="プレス",
                qty=100,
                assigned_on=date(2026, 9, 30),
            )
        ]

        result = allocate_actuals(entries, orders, ROUTINGS, assignments)

        assert _progress(result, 1)["プレス"].good_qty == 100
        # 通常の割り付けで 50、受注日より前の作り置きから 30
        assert _progress(result, 2)["プレス"].good_qty == 80
        assert result.unallocated == []
        assert sum(a.qty for a in result.allocations) == 180
        # 引き当て元は、通常の割り付けの後に残った実績（entry 1 の30個）だけ
        assert [(s.order_id, s.entry_id, s.qty) for s in result.stock_sources] == [
            (2, 1, 30)
        ]

    def test_assignment_is_limited_to_remaining_order_quantity(self):
        orders = [_order(1, 100, date(2026, 11, 1), order_date=date(2026, 10, 21))]
        entries = [
            _entry(1, 50, "クグシ", date(2026, 10, 14)),
            _entry(2, 70, "クグシ", date(2026, 10, 25)),
        ]
        assignments = [
            StockAssignment(
                order_id=1,
                process_name="クグシ",
                qty=100,
                assigned_on=date(2026, 11, 2),
            )
        ]

        result = allocate_actuals(entries, orders, ROUTINGS, assignments)

        # 受注日より後の 70 が通常の割り付けで先に入り、残り 30 だけ作り置きから
        assert _progress(result, 1)["クグシ"].good_qty == 100
        assert [(u.entry_id, u.qty, u.reason) for u in result.unallocated] == [
            (1, 20, "before_order_date")
        ]

    def test_assignment_is_capped_by_order_quantity(self):
        orders = [_order(1, 100, date(2026, 11, 1), order_date=date(2026, 10, 21))]
        entries = [_entry(1, 300, "クグシ", date(2026, 10, 14))]
        assignments = [
            StockAssignment(
                order_id=1,
                process_name="クグシ",
                qty=500,
                assigned_on=date(2026, 11, 2),
            )
        ]

        result = allocate_actuals(entries, orders, ROUTINGS, assignments)

        assert _progress(result, 1)["クグシ"].good_qty == 100
        assert [(u.qty, u.reason) for u in result.unallocated] == [
            (200, "before_order_date")
        ]

    def test_assignment_with_insufficient_entries_assigns_what_exists(self):
        orders = [_order(1, 100, date(2026, 11, 1), order_date=date(2026, 10, 21))]
        entries = [_entry(1, 30, "クグシ", date(2026, 10, 14))]
        assignments = [
            StockAssignment(
                order_id=1,
                process_name="クグシ",
                qty=100,
                assigned_on=date(2026, 11, 2),
            )
        ]

        result = allocate_actuals(entries, orders, ROUTINGS, assignments)

        progress = _progress(result, 1)["クグシ"]
        assert progress.good_qty == 30
        assert progress.status == "in_progress"
        assert result.unallocated == []

    def test_assignment_to_non_candidate_order_or_unknown_process_is_ignored(self):
        orders = [_order(1, 100, date(2026, 11, 1), order_date=date(2026, 10, 21))]
        entries = [_entry(1, 100, "クグシ", date(2026, 10, 14))]
        assignments = [
            # 割り付けの候補でない受注（出荷済み等）
            StockAssignment(
                order_id=9,
                process_name="クグシ",
                qty=100,
                assigned_on=date(2026, 11, 2),
            ),
            # 製品の工程ルートに無い工程
            StockAssignment(
                order_id=1, process_name="研磨", qty=100, assigned_on=date(2026, 11, 2)
            ),
        ]

        result = allocate_actuals(entries, orders, ROUTINGS, assignments)

        assert _progress(result, 1)["クグシ"].good_qty == 0
        assert [(u.qty, u.reason) for u in result.unallocated] == [
            (100, "before_order_date")
        ]

    def test_assignment_does_not_use_other_product_or_process(self):
        orders = [_order(1, 100, date(2026, 11, 1), order_date=date(2026, 10, 21))]
        entries = [
            _entry(1, 100, "クグシ", date(2026, 10, 14), product_id=OTHER_PRODUCT),
            _entry(2, 100, "カシメ", date(2026, 10, 14)),
        ]
        assignments = [
            StockAssignment(
                order_id=1,
                process_name="クグシ",
                qty=100,
                assigned_on=date(2026, 11, 2),
            )
        ]

        result = allocate_actuals(entries, orders, ROUTINGS, assignments)

        assert _progress(result, 1)["クグシ"].good_qty == 0
        assert result.allocations == []


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
