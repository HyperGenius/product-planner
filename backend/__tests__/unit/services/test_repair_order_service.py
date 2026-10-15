"""repair_order_service のユニットテスト（Issue #493）。"""

from datetime import date

import pytest
from app.services.repair_order_service import (
    build_repair_work_description,
    has_repair_dates,
    is_repair_order,
    parse_order_date,
    repair_dates_in_order,
)


@pytest.mark.unit
class TestIsRepairOrder:
    def test_repair(self):
        assert is_repair_order({"order_type": "repair"}) is True

    @pytest.mark.parametrize("order", [None, {}, {"order_type": "production"}])
    def test_not_repair(self, order):
        assert is_repair_order(order) is False


@pytest.mark.unit
class TestRepairDates:
    def test_has_repair_dates_requires_both(self):
        assert has_repair_dates(
            {"scheduling_start_date": "2026-10-20", "simulated_deadline": "2026-10-22"}
        )
        assert not has_repair_dates({"scheduling_start_date": "2026-10-20"})
        assert not has_repair_dates({"simulated_deadline": "2026-10-22"})

    @pytest.mark.parametrize(
        ("start", "end", "expected"),
        [
            ("2026-10-20", "2026-10-22", True),
            # 1日で終わる修理（開始日 = 完了予定日）は許可する
            ("2026-10-20", "2026-10-20", True),
            ("2026-10-20", "2026-10-19", False),
            # どちらかが未入力なら前後関係は判定しない
            (None, "2026-10-19", True),
            ("2026-10-20", None, True),
        ],
    )
    def test_repair_dates_in_order(self, start, end, expected):
        assert repair_dates_in_order(start, end) is expected

    def test_invalid_date_raises(self):
        with pytest.raises(ValueError):
            repair_dates_in_order("2026-10-20", "2026/10/22")

    def test_parse_order_date(self):
        assert parse_order_date("2026-10-20") == date(2026, 10, 20)
        assert parse_order_date(None) is None
        assert parse_order_date("") is None
        with pytest.raises(ValueError):
            parse_order_date(20261020)


@pytest.mark.unit
class TestBuildRepairWorkDescription:
    def test_subject_and_line_items(self):
        description = build_repair_work_description(
            " 基板 はんだ補修 ",
            [
                {"product_name_raw": "補修部1〜3ヶ所", "quantity": 11},
                {"product_name_raw": "補修部4〜6ヶ所", "quantity": 1},
            ],
        )
        assert (
            description == "基板 はんだ補修\n・補修部1〜3ヶ所 ×11\n・補修部4〜6ヶ所 ×1"
        )

    def test_falls_back_to_product_number_and_skips_empty_lines(self):
        description = build_repair_work_description(
            None,
            [
                {
                    "product_name_raw": None,
                    "product_number_raw": "R-1",
                    "quantity": None,
                },
                {
                    "product_name_raw": None,
                    "product_number_raw": None,
                    "quantity": None,
                },
                {"product_name_raw": "", "quantity": 3},
            ],
        )
        assert description == "・R-1\n・×3"

    def test_nothing_returns_none(self):
        assert build_repair_work_description(None, []) is None
        assert build_repair_work_description("  ", []) is None
