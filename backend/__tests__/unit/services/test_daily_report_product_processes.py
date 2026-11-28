"""製品ごとの工程ルートと日報の工程の突き合わせ（純粋関数）のテスト (Issue #708)。

実データは使わず、表記のパターンだけをダミー値で再現する。
"""

from datetime import date

import app.repositories.supa_infra  # noqa: F401  既存の循環 import を避けるため先に読む
import pytest
from app.services.daily_report_name_matcher import (
    CustomerRef,
    DailyReportNameMatcher,
    NameMatchingSnapshot,
    ProductRef,
)
from app.services.daily_report_product_processes import (
    ProcessRaw,
    ProcessStat,
    RoutingProcess,
    aggregate_product_raws,
    compare_all_products,
    compare_product_processes,
    count_products_by_unmatched_raw,
    mismatched_products,
)

PIN = 10
BOLT = 11
NUT = 12


def _matcher() -> DailyReportNameMatcher:
    return DailyReportNameMatcher(
        NameMatchingSnapshot(
            customers=[CustomerRef(id=1, name="顧客A")],
            products=[
                ProductRef(id=PIN, name="ピン"),
                ProductRef(id=BOLT, name="ボルト"),
                ProductRef(id=NUT, name="ナット"),
            ],
            process_names=["プレス", "カシメ", "仕上げ", "検査", "研磨"],
            process_aliases={
                "ﾌﾟﾚｽ加工": ["プレス"],
                "カシメ、仕上げ加工": ["カシメ", "仕上げ"],
            },
            product_aliases={(1, "短いピン"): PIN},
        )
    )


def _stat(
    product_raw: str,
    process_raw: str,
    entry_count: int = 1,
    last_work_date: date | None = None,
    customer_raw: str | None = "顧客A",
) -> ProcessStat:
    return ProcessStat(
        customer_raw=customer_raw,
        product_raw=product_raw,
        process_raw=process_raw,
        entry_count=entry_count,
        last_work_date=last_work_date,
    )


def _routing(id: int, product_id: int, seq: int, name: str | None) -> RoutingProcess:
    return RoutingProcess(
        id=id, product_id=product_id, sequence_order=seq, process_name=name
    )


@pytest.mark.unit
class TestAggregateProductRaws:
    def test_matches_product_and_process_and_sums_same_raw(self):
        stats = [
            # 製品の別名（顧客単位）と製品名の一致は同じ製品にまとまる
            _stat("短いピン", "ﾌﾟﾚｽ加工", 3, date(2026, 11, 1)),
            _stat("ピン", " ﾌﾟﾚｽ加工 ", 2, date(2026, 11, 20)),
            _stat("ピン", "バレル", 4),
        ]
        by_product = aggregate_product_raws(stats, _matcher())

        assert set(by_product) == {PIN}
        press = by_product[PIN]["ﾌﾟﾚｽ加工"]
        assert (press.entry_count, press.last_work_date, press.process_names) == (
            5,
            date(2026, 11, 20),
            ("プレス",),
        )
        assert by_product[PIN]["バレル"].process_names is None

    def test_skips_entries_whose_product_is_not_matched(self):
        # 日報の品名が製品に結び付いていない明細はハブの①に置く
        by_product = aggregate_product_raws([_stat("知らない品", "プレス")], _matcher())
        assert by_product == {}

    def test_skips_ignored_raw_only_when_not_matched(self):
        stats = [_stat("ピン", "社内作業"), _stat("ピン", "プレス")]
        by_product = aggregate_product_raws(
            stats, _matcher(), frozenset({"社内作業", "プレス"})
        )
        assert set(by_product[PIN]) == {"プレス"}

    def test_product_alias_needs_customer(self):
        # 製品の別名は顧客単位。顧客先が空欄なら別名では結び付かない
        by_product = aggregate_product_raws(
            [_stat("短いピン", "プレス", customer_raw=None)], _matcher()
        )
        assert by_product == {}


@pytest.mark.unit
class TestCompareProductProcesses:
    def _raws(self) -> dict[str, ProcessRaw]:
        return aggregate_product_raws(
            [
                _stat("ピン", "ﾌﾟﾚｽ加工", 5, date(2026, 11, 1)),
                _stat("ピン", "プレス", 1, date(2026, 11, 2)),
                # 1つの表記が2つの工程を指す。カシメは工程ルートにあり、仕上げは無い
                _stat("ピン", "カシメ、仕上げ加工", 4),
                _stat("ピン", "研磨", 2),
                _stat("ピン", "バレル", 7),
                _stat("ボルト", "バレル", 1),
                _stat("ナット", "バレル", 1),
            ],
            _matcher(),
        )[PIN]

    def test_places_raws_on_routing_rows_off_routing_and_unmatched(self):
        routings = [
            _routing(2, PIN, 2, "カシメ"),
            _routing(1, PIN, 1, "プレス"),
            _routing(3, PIN, 3, "検査"),
            # 他の製品の行は混ざっていても使わない
            _routing(9, BOLT, 1, "研磨"),
        ]
        comparison = compare_product_processes(
            PIN, self._raws(), routings, ["検査"], {"バレル": 3}
        )

        assert comparison.has_routings
        assert [
            (r.process_name, r.untracked, [raw.raw_text for raw in r.raws])
            for r in comparison.routings
        ] == [
            # 明細の多い順
            ("プレス", False, ["ﾌﾟﾚｽ加工", "プレス"]),
            ("カシメ", False, ["カシメ、仕上げ加工"]),
            # 左だけの工程（日報で追わない）
            ("検査", True, []),
        ]
        assert [
            (r.process_name, [raw.raw_text for raw in r.raws])
            for r in comparison.off_routing
        ] == [("仕上げ", ["カシメ、仕上げ加工"]), ("研磨", ["研磨"])]
        assert [
            (u.raw.raw_text, u.other_product_count) for u in comparison.unmatched
        ] == [("バレル", 2)]
        # 右だけの工程名2つ＋結び付かない表記1つ。左だけの工程は数えない
        assert comparison.mismatch_count == 3
        # 「カシメ、仕上げ加工」は2つの工程を指しても1回だけ数える
        assert comparison.mismatch_entry_count == 4 + 2 + 7

    def test_aligned_product_has_no_mismatch(self):
        raws = aggregate_product_raws([_stat("ピン", "ﾌﾟﾚｽ加工")], _matcher())[PIN]
        comparison = compare_product_processes(
            PIN,
            raws,
            [_routing(1, PIN, 1, "プレス"), _routing(2, PIN, 2, "検査")],
        )
        assert comparison.mismatch_count == 0
        assert comparison.mismatch_entry_count == 0

    def test_untracked_routing_with_actuals_is_mismatch(self):
        raws = aggregate_product_raws([_stat("ピン", "検査", 3)], _matcher())[PIN]
        comparison = compare_product_processes(
            PIN, raws, [_routing(1, PIN, 1, " 検査 ")], ["検査"]
        )
        assert comparison.routings[0].untracked
        assert comparison.mismatch_count == 1
        assert comparison.mismatch_entry_count == 3

    def test_product_without_routings(self):
        comparison = compare_product_processes(PIN, self._raws(), [])
        assert not comparison.has_routings
        assert comparison.routings == []
        assert {r.process_name for r in comparison.off_routing} == {
            "プレス",
            "カシメ",
            "仕上げ",
            "研磨",
        }

    def test_duplicate_process_name_goes_to_first_sequence(self):
        raws = aggregate_product_raws([_stat("ピン", "プレス")], _matcher())[PIN]
        comparison = compare_product_processes(
            PIN, raws, [_routing(5, PIN, 3, "プレス"), _routing(4, PIN, 1, "プレス")]
        )
        assert [(r.routing_id, len(r.raws)) for r in comparison.routings] == [
            (4, 1),
            (5, 0),
        ]


@pytest.mark.unit
class TestMismatchedProducts:
    def test_lists_only_mismatched_products_by_entry_count(self):
        by_product = aggregate_product_raws(
            [
                _stat("ピン", "バレル", 2),
                _stat("ボルト", "研磨", 5),
                # ナットは工程ルートと揃っている
                _stat("ナット", "プレス", 9),
            ],
            _matcher(),
        )
        routings = [_routing(1, NUT, 1, "プレス")]
        rows = mismatched_products(compare_all_products(by_product, routings))
        assert [(r.product_id, r.mismatch_entry_count) for r in rows] == [
            (BOLT, 5),
            (PIN, 2),
        ]

    def test_counts_products_by_unmatched_raw(self):
        by_product = aggregate_product_raws(
            [
                _stat("ピン", "バレル"),
                _stat("ボルト", "バレル"),
                _stat("ボルト", "プレス"),
            ],
            _matcher(),
        )
        assert count_products_by_unmatched_raw(by_product) == {"バレル": 2}
