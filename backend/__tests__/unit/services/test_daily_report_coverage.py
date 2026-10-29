"""日報の照合状況と未割当の集約のテスト (Issue #542)。"""

from datetime import date

import pytest
from app.services.daily_report_allocator import ActualEntry
from app.services.daily_report_coverage import (
    CategoryTotal,
    MonthlyCoverage,
    UnallocatedRow,
    UnmatchedEntry,
    build_summary,
    group_unallocated,
    in_period,
    period_start,
    summarize_coverage,
    unallocated_category,
)


def _entry(
    entry_id: int,
    qty: int,
    work_date: date | None,
    processes: tuple[str, ...] = ("プレス",),
) -> ActualEntry:
    return ActualEntry(
        entry_id=entry_id,
        work_date=work_date,
        product_id=100,
        customer_id=None,
        process_names=processes,
        good_qty=qty,
    )


def _row(
    qty: int,
    reason: str = "no_candidate_order",
    *,
    product_id: int = 100,
    process_name: str = "プレス",
    work_date: date | None = date(2026, 9, 10),
    customer_id: int | None = None,
) -> UnallocatedRow:
    return UnallocatedRow(
        product_id=product_id,
        customer_id=customer_id,
        process_name=process_name,
        work_date=work_date,
        qty=qty,
        reason=reason,  # type: ignore[arg-type]
    )


class TestSummarizeCoverage:
    def test_groups_by_work_month_and_counts_each_process(self):
        entries = [
            _entry(1, 10, date(2026, 9, 1)),
            # 1行が2工程に対応する明細は2回数える
            _entry(2, 5, date(2026, 9, 30), ("カシメ", "クグシ")),
            _entry(3, 7, date(2026, 10, 2)),
            _entry(4, 3, None),
        ]
        unmatched = [
            UnmatchedEntry(work_date=date(2026, 10, 5), good_qty=4),
            UnmatchedEntry(work_date=None, good_qty=2),
        ]

        result = summarize_coverage(entries, unmatched)

        assert result == [
            MonthlyCoverage(date(2026, 9, 1), matched_rows=3, matched_qty=20),
            MonthlyCoverage(
                date(2026, 10, 1),
                matched_rows=1,
                matched_qty=7,
                unmatched_rows=1,
                unmatched_qty=4,
            ),
            MonthlyCoverage(
                None, matched_rows=1, matched_qty=3, unmatched_rows=1, unmatched_qty=2
            ),
        ]

    def test_json_round_trip(self):
        months = [
            MonthlyCoverage(date(2026, 9, 1), 1, 2, 3, 4),
            MonthlyCoverage(None, 0, 0, 1, 5),
        ]

        assert [MonthlyCoverage.from_json(m.to_json()) for m in months] == months
        assert months[0].to_json()["work_month"] == "2026-09-01"


class TestPeriod:
    @pytest.mark.parametrize(
        ("today", "months", "expected"),
        [
            (date(2026, 10, 21), 1, date(2026, 10, 1)),
            (date(2026, 10, 21), 3, date(2026, 8, 1)),
            # 年をまたぐ
            (date(2026, 2, 5), 3, date(2025, 12, 1)),
            (date(2026, 10, 21), 12, date(2025, 11, 1)),
            (date(2026, 10, 21), None, None),
        ],
    )
    def test_period_start(self, today, months, expected):
        assert period_start(today, months) == expected

    def test_undated_rows_are_always_in_period(self):
        since = date(2026, 9, 1)

        assert in_period(date(2026, 9, 1), since)
        assert not in_period(date(2026, 8, 31), since)
        assert in_period(None, since)
        assert in_period(date(2000, 1, 1), None)


class TestUnallocatedCategory:
    @pytest.mark.parametrize(
        ("statuses", "expected"),
        [
            (set(), "no_order"),
            ({"shipped"}, "closed_order_only"),
            ({"completed", "shipped"}, "closed_order_only"),
            ({"draft"}, "unapproved_order"),
            # 承認前の受注があれば出荷済みより優先する
            ({"pending_approval", "shipped"}, "unapproved_order"),
            # 取消は数えない
            ({"canceled"}, "no_order"),
        ],
    )
    def test_no_candidate_order_is_split_by_other_orders(self, statuses, expected):
        assert unallocated_category("no_candidate_order", statuses) == expected

    @pytest.mark.parametrize(
        "reason",
        [
            "no_routing_process",
            "before_order_date",
            "exceeds_order_qty",
            "no_work_date",
        ],
    )
    def test_other_reasons_are_kept(self, reason):
        assert unallocated_category(reason, {"draft", "shipped"}) == reason

    def test_before_order_date_of_stocked_product_is_stocked(self):
        """作り置きの推定（#591）が出ている製品の受注日より前の実績は作り置きとして要確認から外す。"""
        assert (
            unallocated_category("before_order_date", set(), stocked=True) == "stocked"
        )
        # 他の理由は作り置きの推定があっても変えない
        assert (
            unallocated_category("exceeds_order_qty", set(), stocked=True)
            == "exceeds_order_qty"
        )
        assert (
            unallocated_category("no_candidate_order", set(), stocked=True)
            == "no_order"
        )


class TestGroupUnallocated:
    def test_groups_by_product_process_reason_sorted_by_qty(self):
        rows = [
            _row(10, work_date=date(2026, 9, 10), customer_id=20),
            _row(5, work_date=date(2026, 9, 2), customer_id=10),
            _row(1, work_date=None, customer_id=20),
            _row(30, "before_order_date"),
            _row(8, process_name="カシメ"),
            _row(50, "no_routing_process", product_id=200, process_name="溶接"),
        ]

        groups = group_unallocated(rows, {100: {"shipped"}})

        assert [
            (g.product_id, g.process_name, g.reason, g.category, g.qty) for g in groups
        ] == [
            (200, "溶接", "no_routing_process", "no_routing_process", 50),
            (100, "プレス", "before_order_date", "before_order_date", 30),
            (100, "プレス", "no_candidate_order", "closed_order_only", 16),
            (100, "カシメ", "no_candidate_order", "closed_order_only", 8),
        ]
        press = groups[2]
        assert press.row_count == 3
        # 加工日の無い行は範囲に影響しない
        assert (press.first_work_date, press.last_work_date) == (
            date(2026, 9, 2),
            date(2026, 9, 10),
        )
        assert press.customer_ids == [10, 20]

    def test_stocked_products_are_categorized_per_product(self):
        rows = [
            _row(30, "before_order_date"),
            _row(20, "before_order_date", product_id=200),
        ]

        groups = group_unallocated(rows, {}, stocked_product_ids=[200])

        assert [(g.product_id, g.category) for g in groups] == [
            (100, "before_order_date"),
            (200, "stocked"),
        ]


class TestBuildSummary:
    def test_allocated_is_matched_minus_unallocated(self):
        coverage = [
            MonthlyCoverage(date(2026, 9, 1), 10, 100, 2, 15),
            MonthlyCoverage(None, 1, 5, 1, 3),
        ]
        groups = group_unallocated(
            [
                _row(20, "no_routing_process"),
                _row(10, "no_routing_process", process_name="溶接"),
                _row(25),
            ],
            {},
        )

        summary = build_summary(coverage, groups)

        assert summary.total_qty == 123
        assert summary.allocated_qty == 50
        assert summary.unallocated_qty == 55
        assert (summary.unmatched_rows, summary.unmatched_qty) == (3, 18)
        assert summary.unallocated == [
            CategoryTotal("no_routing_process", row_count=2, qty=30),
            CategoryTotal("no_order", row_count=1, qty=25),
        ]

    def test_allocated_is_not_negative(self):
        summary = build_summary([], group_unallocated([_row(5)], {}))

        assert summary.allocated_qty == 0
        assert summary.total_qty == 0
