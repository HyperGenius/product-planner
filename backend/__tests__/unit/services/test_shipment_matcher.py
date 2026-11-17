# __tests__/unit/services/test_shipment_matcher.py
"""弥生の売上明細の名寄せ・受注への突合のテスト (Issue #667, #680)。値はすべて架空。"""

from datetime import date
from typing import Any

from app.services.shipment_matcher import (
    SHIPPED_ORDER_GRACE_DAYS,
    CustomerInfo,
    OrderInfo,
    ProductInfo,
    ShipmentMatcher,
    ShipmentSnapshot,
    group_unmatched_entries,
    normalize_code,
    parse_note_deadlines,
    parse_note_order_nos,
    summarize_by_order,
)

CUSTOMER_A = CustomerInfo(id=1, name="株式会社サンプル工業")
CUSTOMER_B = CustomerInfo(id=2, name="テスト産業株式会社")
TRADER = CustomerInfo(id=3, name="商社データ株式会社")

FILTER = ProductInfo(id=101, name="φ23.6×20L SUS150")
DRAWING = ProductInfo(id=102, name="ブラケット", code="DW-123456")
OTHER = ProductInfo(id=103, name="φ10×5L SUS")


def _order(
    order_id: int,
    customer_id: int = 1,
    product_id: int = 101,
    quantity: int | None = 100,
    status: str = "confirmed",
    deadline: date | None = date(2026, 10, 20),
    order_date: date | None = date(2026, 9, 1),
    order_no: str | None = None,
    shipped_on: date | None = None,
) -> OrderInfo:
    return OrderInfo(
        id=order_id,
        customer_id=customer_id,
        product_id=product_id,
        quantity=quantity,
        status=status,
        deadline_date=deadline,
        order_date=order_date,
        customer_order_no=order_no,
        shipped_on=shipped_on,
    )


def _snapshot(**kwargs: Any) -> ShipmentSnapshot:
    defaults: dict[str, Any] = {
        "customers": [CUSTOMER_A, CUSTOMER_B, TRADER],
        "products": [FILTER, DRAWING, OTHER],
        "orders": [_order(1)],
    }
    defaults.update(kwargs)
    return ShipmentSnapshot(**defaults)


def _entry(**values: Any) -> dict[str, Any]:
    entry = {
        "id": 1,
        "sales_date": "2026-10-10",
        "slip_no": "10001",
        "customer_code": "00012",
        "customer_name": "(株)サンプル工業",
        "product_code": "ab123",
        "product_name": "ﾌｨﾙﾀｰ 23.6φ×20L sus 150",
        "quantity": 40,
        "note": "10/20納期分",
    }
    entry.update(values)
    return entry


class TestNormalizeCode:
    def test_ignores_width_case_and_spaces(self):
        assert normalize_code(" ａｂ １２３ ") == "AB123"
        assert normalize_code(None) == ""


class TestParseNote:
    def test_deadline_day(self):
        assert parse_note_deadlines("10/20納期分", date(2026, 10, 10)) == [
            date(2026, 10, 20)
        ]

    def test_deadline_year_is_inferred_from_sales_date(self):
        # 1月の売上の 12/20納期分 は前年
        assert parse_note_deadlines("12/20納期分", date(2027, 1, 8)) == [
            date(2026, 12, 20)
        ]
        # 12月の売上の 1/10納期分 は翌年
        assert parse_note_deadlines("１/１０納期分", date(2026, 12, 25)) == [
            date(2027, 1, 10)
        ]

    def test_month_end(self):
        assert parse_note_deadlines("11月末納期分", date(2026, 11, 5)) == [
            date(2026, 11, 30)
        ]

    def test_order_numbers_exclude_deadline(self):
        assert parse_note_order_nos("ABC-20260101") == ["ABC-20260101"]
        assert parse_note_order_nos("10/20納期分") == []
        assert parse_note_order_nos("1234-5678 10/20納期分") == ["1234-5678"]
        assert parse_note_order_nos("送料") == []


class TestResolveCustomer:
    def test_name_match_ignores_corporate_affix_and_hyphens(self):
        matcher = ShipmentMatcher(
            _snapshot(customers=[CustomerInfo(id=9, name="株式会社サンプルーテック")])
        )

        result = matcher.resolve_customer("00099", "(株)サンプル－テック")

        assert result.customer_ids == {9}
        assert result.method == "name"

    def test_links_take_precedence_and_allow_many_customers(self):
        matcher = ShipmentMatcher(_snapshot(customer_links={"00012": {1, 2}}))

        result = matcher.resolve_customer("00012", "全然違う名前")

        assert result.customer_ids == {1, 2}
        assert result.method == "link"

    def test_no_match_when_ambiguous(self):
        matcher = ShipmentMatcher(
            _snapshot(
                customers=[
                    CustomerInfo(id=1, name="株式会社サンプル"),
                    CustomerInfo(id=2, name="サンプル有限会社"),
                ]
            )
        )

        assert matcher.resolve_customer("1", "サンプル").customer_ids == frozenset()

    def test_name_candidates_are_partial_matches(self):
        matcher = ShipmentMatcher(_snapshot())

        assert matcher.suggest_customers_by_name("サンプル") == [1]


class TestResolveProduct:
    def test_product_code_is_not_matched_against_drawing_number(self):
        matcher = ShipmentMatcher(
            _snapshot(
                products=[ProductInfo(id=101, name="別の名前", code="AB123")],
                orders=[_order(1)],
            )
        )

        result = matcher.resolve_product("00012", "AB123", "何かの品名", frozenset({1}))

        assert result.product_id is None

    def test_link_first(self):
        matcher = ShipmentMatcher(_snapshot(product_links={("00012", "AB123"): 103}))

        result = matcher.resolve_product("00012", "ab123", "x", frozenset({1}))

        assert (result.product_id, result.method) == (103, "link")

    def test_drawing_number_in_name_within_customer_orders(self):
        matcher = ShipmentMatcher(_snapshot(orders=[_order(1, product_id=102)]))

        result = matcher.resolve_product(
            "00012", "X1", "ブラケット 図番123456", frozenset({1})
        )

        assert (result.product_id, result.method) == (102, "drawing_no")

    def test_drawing_number_only_among_customer_orders(self):
        # 図番の製品が別の顧客の受注にしか無ければ照合しない
        matcher = ShipmentMatcher(
            _snapshot(orders=[_order(1), _order(2, customer_id=2, product_id=102)])
        )

        result = matcher.resolve_product("00012", "X1", "図番123456", frozenset({1}))

        assert result.product_id is None

    def test_spec_with_material_prefix(self):
        matcher = ShipmentMatcher(_snapshot())

        result = matcher.resolve_product(
            "00012", "AB123", "ﾌｨﾙﾀｰ 23.6φ×20L sus 150", frozenset({1})
        )

        assert (result.product_id, result.method) == (101, "spec")

    def test_multiple_candidates_are_not_matched(self):
        twin = ProductInfo(id=104, name="23.6φ×20 SUS150")
        matcher = ShipmentMatcher(
            _snapshot(
                products=[FILTER, twin],
                orders=[_order(1), _order(2, product_id=104)],
            )
        )

        result = matcher.resolve_product(
            "00012", "AB123", "23.6φ×20L SUS150", frozenset({1})
        )

        assert result.product_id is None
        assert result.candidate_ids == (101, 104)

    def test_cross_customer_candidates_suggest_commercial_flow(self):
        matcher = ShipmentMatcher(
            _snapshot(orders=[_order(1, customer_id=2, product_id=102)])
        )

        candidates = matcher.cross_customer_candidates("図番123456", frozenset({3}))

        assert [(c.product_id, c.customer_ids) for c in candidates] == [(102, (2,))]


class TestMatchEntry:
    def test_matches_by_deadline(self):
        matcher = ShipmentMatcher(
            _snapshot(orders=[_order(1), _order(2, deadline=date(2026, 11, 20))])
        )

        match = matcher.match_entry(_entry())

        assert (match.status, match.order_id, match.method) == (
            "matched",
            1,
            "deadline",
        )

    def test_order_number_takes_precedence(self):
        matcher = ShipmentMatcher(
            _snapshot(
                orders=[
                    _order(1),
                    _order(2, deadline=date(2026, 11, 20), order_no="po-0001"),
                ]
            )
        )

        match = matcher.match_entry(_entry(note="PO-0001 10/20納期分"))

        assert (match.order_id, match.method) == (2, "order_no")

    def test_deadline_without_order_is_no_order(self):
        matcher = ShipmentMatcher(_snapshot())

        match = matcher.match_entry(_entry(note="12/1納期分"))

        assert match.status == "no_order"

    def test_multiple_orders_with_same_deadline_are_ambiguous(self):
        matcher = ShipmentMatcher(_snapshot(orders=[_order(1), _order(2)]))

        match = matcher.match_entry(_entry())

        assert match.status == "ambiguous"
        assert match.candidate_order_ids == (1, 2)

    def test_single_open_order_without_note(self):
        matcher = ShipmentMatcher(
            _snapshot(orders=[_order(1), _order(2, status="shipped")])
        )

        match = matcher.match_entry(_entry(note=None))

        assert (match.order_id, match.method) == (1, "single_open_order")

    def test_single_open_order_ignores_sales_before_order_date(self):
        matcher = ShipmentMatcher(
            _snapshot(orders=[_order(1, order_date=date(2026, 10, 15))])
        )

        match = matcher.match_entry(_entry(note=None))

        assert match.status == "no_order"

    def test_orders_of_all_linked_customers_are_candidates(self):
        # 商流: 得意先（商社）→ 注文元の顧客の受注に当たる
        matcher = ShipmentMatcher(
            _snapshot(
                customer_links={"00077": {3, 2}},
                orders=[_order(5, customer_id=2)],
            )
        )

        match = matcher.match_entry(
            _entry(customer_code="00077", customer_name="商社データ")
        )

        assert (match.status, match.order_id) == ("matched", 5)

    def test_ignored_entries(self):
        matcher = ShipmentMatcher(
            _snapshot(ignored_products={("00012", "SHIP")}, ignored_customers={"00099"})
        )

        assert matcher.match_entry(_entry(product_code="ship")).status == "ignored"
        assert matcher.match_entry(_entry(customer_code="00099")).status == "ignored"

    def test_unmatched_customer_and_product(self):
        matcher = ShipmentMatcher(_snapshot())

        assert (
            matcher.match_entry(_entry(customer_name="未登録の会社")).status
            == "unmatched_customer"
        )
        assert (
            matcher.match_entry(_entry(product_name="不明な品名")).status
            == "unmatched_product"
        )


class TestShippedOrders:
    """送品済みにした受注も突合の候補に残す (Issue #680)。"""

    def test_entries_keep_matching_after_order_is_shipped(self):
        entries = [
            _entry(id=1, sales_date="2026-10-05", note="10/20納期分"),
            _entry(id=2, sales_date="2026-10-09", note=None),
        ]
        before = ShipmentMatcher(_snapshot(orders=[_order(1)]))
        after = ShipmentMatcher(
            _snapshot(
                orders=[_order(1, status="shipped", shipped_on=date(2026, 10, 12))]
            )
        )

        for entry in entries:
            b, a = before.match_entry(entry), after.match_entry(entry)
            assert (a.status, a.order_id, a.method) == (b.status, b.order_id, b.method)
            assert a.order_id == 1

    def test_completed_order_is_a_candidate(self):
        matcher = ShipmentMatcher(
            _snapshot(
                orders=[_order(1, status="completed", shipped_on=date(2026, 10, 12))]
            )
        )

        assert matcher.match_entry(_entry()).order_id == 1

    def test_shipped_order_without_shipped_at(self):
        # 列を足す前に送品した受注。備考の納期分で特定できれば当て、手がかりが無ければ当てない
        matcher = ShipmentMatcher(_snapshot(orders=[_order(1, status="shipped")]))

        assert matcher.match_entry(_entry()).order_id == 1
        assert matcher.match_entry(_entry(note=None)).status == "no_order"

    def test_canceled_order_is_not_a_candidate(self):
        matcher = ShipmentMatcher(_snapshot(orders=[_order(1, status="canceled")]))

        assert matcher.match_entry(_entry()).status == "no_order"

    def test_note_deadline_matches_shipped_order_regardless_of_sales_date(self):
        # 備考の納期分で特定できれば、送品日から日が経った売上（残りの分納の入力遅れ等）も当てる
        matcher = ShipmentMatcher(
            _snapshot(
                orders=[_order(1, status="shipped", shipped_on=date(2026, 10, 1))]
            )
        )

        match = matcher.match_entry(_entry(sales_date="2026-11-10"))

        assert (match.status, match.order_id, match.method) == (
            "matched",
            1,
            "deadline",
        )

    def test_fallback_keeps_shipped_order_within_grace_days(self):
        shipped_on = date(2026, 10, 12)
        last_day = date.fromordinal(shipped_on.toordinal() + SHIPPED_ORDER_GRACE_DAYS)
        matcher = ShipmentMatcher(
            _snapshot(orders=[_order(1, status="shipped", shipped_on=shipped_on)])
        )

        match = matcher.match_entry(_entry(sales_date=last_day.isoformat(), note=None))

        assert (match.order_id, match.method) == (1, "single_open_order")

    def test_fallback_drops_shipped_order_after_grace_days(self):
        # 繰り返しの注文: 送品済みの前の受注と次の受注が並ぶ。送品日から日が経った
        # 手がかりの無い売上は次の受注の分とみなす（区別できない扱いにしない）
        shipped_on = date(2026, 10, 12)
        after_grace = date.fromordinal(
            shipped_on.toordinal() + SHIPPED_ORDER_GRACE_DAYS + 1
        )
        matcher = ShipmentMatcher(
            _snapshot(
                orders=[
                    _order(1, status="shipped", shipped_on=shipped_on),
                    _order(
                        2, deadline=date(2026, 11, 20), order_date=date(2026, 10, 1)
                    ),
                ]
            )
        )

        match = matcher.match_entry(
            _entry(sales_date=after_grace.isoformat(), note=None)
        )

        assert (match.status, match.order_id) == ("matched", 2)

    def test_fallback_is_ambiguous_with_recently_shipped_order(self):
        # 送品済みにする前（両方が未送品）と同じく、区別できない
        matcher = ShipmentMatcher(
            _snapshot(
                orders=[
                    _order(1, status="shipped", shipped_on=date(2026, 10, 12)),
                    _order(
                        2, deadline=date(2026, 11, 20), order_date=date(2026, 10, 1)
                    ),
                ]
            )
        )

        match = matcher.match_entry(_entry(note=None))

        assert match.status == "ambiguous"
        assert match.candidate_order_ids == (1, 2)

    def test_order_number_shared_by_split_orders(self):
        # 同じ注文番号の受注（分割）で納期の手がかりが無いとき、送品日から日が経った
        # 送品済みの受注は外す
        orders = [
            _order(1, status="shipped", shipped_on=date(2026, 10, 1), order_no="PO-1"),
            _order(2, deadline=date(2026, 11, 20), order_no="PO-1"),
        ]
        matcher = ShipmentMatcher(_snapshot(orders=orders))

        late = matcher.match_entry(_entry(sales_date="2026-11-10", note="PO-1"))
        early = matcher.match_entry(_entry(sales_date="2026-09-28", note="PO-1"))

        assert (late.status, late.order_id, late.method) == ("matched", 2, "order_no")
        assert early.status == "ambiguous"


class TestSummarizeByOrder:
    def test_partial_shipments_are_summed(self):
        matcher = ShipmentMatcher(_snapshot())
        entries = [
            _entry(id=1, sales_date="2026-10-10", quantity=40),
            _entry(id=2, sales_date="2026-10-15", quantity=60),
            _entry(id=3, sales_date="2026-10-16", quantity=-10),
        ]

        shipments = summarize_by_order(matcher.match_entry(e) for e in entries)

        assert shipments[1].shipped_qty == 90
        assert shipments[1].last_sales_date == date(2026, 10, 16)
        assert len(shipments[1].entries) == 3

    def test_ambiguous_entries_are_listed_on_each_candidate(self):
        matcher = ShipmentMatcher(_snapshot(orders=[_order(1), _order(2)]))

        shipments = summarize_by_order([matcher.match_entry(_entry())])

        assert shipments[1].shipped_qty == 0
        assert len(shipments[1].ambiguous_entries) == 1
        assert len(shipments[2].ambiguous_entries) == 1


class TestGroupUnmatchedEntries:
    """送品の消し込みの「要確認」: 受注に当たらない明細のまとめ (Issue #682)。"""

    def _groups(self, matcher: ShipmentMatcher, entries, since=None):
        return group_unmatched_entries(
            (matcher.match_entry(e) for e in entries), since=since
        )

    def test_groups_by_customer_product_and_status(self):
        matcher = ShipmentMatcher(
            _snapshot(
                orders=[],
                product_links={("00012", "AB123"): 101, ("00012", "CD999"): 103},
            )
        )
        entries = [
            _entry(id=1, sales_date="2026-10-01", quantity=40, note="10/20納期分"),
            # 同じ得意先・商品コード（表記ゆれ）は1行にまとめ、表記は最新の明細の値を採る
            _entry(
                id=2,
                sales_date="2026-10-05",
                product_code="AB123 ",
                quantity=-10,
                note="10月末納期分",
            ),
            _entry(id=3, sales_date="2026-10-03", product_code="CD999", quantity=5),
        ]

        groups = self._groups(matcher, entries)

        assert [(g.status, g.product_code_key, g.entry_count) for g in groups] == [
            ("no_order", "AB123", 2),
            ("no_order", "CD999", 1),
        ]
        first = groups[0]
        assert first.total_qty == 30
        assert first.last_sales_date == date(2026, 10, 5)
        assert first.latest["id"] == 2
        assert first.customer_ids == {1}
        assert first.product_ids == {101}
        assert first.note_deadlines == {date(2026, 10, 20), date(2026, 10, 31)}

    def test_excludes_matched_and_ignored(self):
        matcher = ShipmentMatcher(
            _snapshot(ignored_products={("00012", "SHIP")}, ignored_customers={"00099"})
        )
        entries = [
            _entry(id=1),  # 受注 1 に当たる
            _entry(id=2, product_code="ship"),
            _entry(id=3, customer_code="00099", customer_name="未登録の会社"),
        ]

        assert self._groups(matcher, entries) == []

    def test_entries_of_shipped_order_are_not_listed(self):
        # 送品済みにした受注の明細は「受注が無い」に出さない (#680)
        matcher = ShipmentMatcher(
            _snapshot(
                orders=[_order(1, status="shipped", shipped_on=date(2026, 10, 12))]
            )
        )

        assert self._groups(matcher, [_entry(), _entry(id=2, note=None)]) == []

    def test_orders_statuses_and_keeps_candidates(self):
        matcher = ShipmentMatcher(_snapshot(orders=[_order(1), _order(2)]))
        entries = [
            _entry(id=1, sales_date="2026-10-01"),  # ambiguous（受注 1・2）
            _entry(id=2, sales_date="2026-10-02", note="12/1納期分"),  # no_order
            _entry(id=3, sales_date="2026-10-03", product_name="不明な品名"),
            _entry(id=4, sales_date="2026-10-04", customer_name="未登録の会社"),
        ]

        groups = self._groups(matcher, entries)

        assert [g.status for g in groups] == [
            "unmatched_customer",
            "unmatched_product",
            "no_order",
            "ambiguous",
        ]
        assert groups[0].customer_ids == set()
        assert groups[1].customer_ids == {1}
        assert groups[1].product_ids == set()
        assert groups[3].candidate_order_ids == {1, 2}

    def test_newer_groups_first_within_status(self):
        matcher = ShipmentMatcher(_snapshot(orders=[]))
        entries = [
            _entry(id=1, sales_date="2026-10-01", product_code="OLD"),
            _entry(id=2, sales_date="2026-10-09", product_code="NEW"),
        ]

        groups = self._groups(matcher, entries)

        assert [g.product_code_key for g in groups] == ["NEW", "OLD"]

    def test_entries_before_since_are_skipped(self):
        matcher = ShipmentMatcher(_snapshot(orders=[]))
        entries = [
            _entry(id=1, sales_date="2026-08-01", quantity=10),
            _entry(id=2, sales_date="2026-10-01", quantity=20),
        ]

        [group] = self._groups(matcher, entries, since=date(2026, 9, 1))

        assert (group.entry_count, group.total_qty) == (1, 20)
