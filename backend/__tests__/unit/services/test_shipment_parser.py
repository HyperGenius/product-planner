# __tests__/unit/services/test_shipment_parser.py
"""弥生の得意先別売上明細表のパーサーのテスト (Issue #667)。

実物のファイルは使わず、同じ形のダミーのブックを openpyxl で作る（値はすべて架空）。
"""

from datetime import date, datetime
from io import BytesIO
from typing import Any

import pytest
from app.services.shipment_parser import (
    ShipmentParseError,
    parse_period,
    parse_shipment_rows,
    parse_shipment_workbook,
)
from openpyxl import Workbook

HEADERS = [
    None,
    "得意先コード",
    "得意先名",
    "税転嫁",
    "売上日",
    "伝票番号",
    "取引区分",
    "内訳",
    "商品コード",
    "商品名/摘要",
    "単位",
    "数量",
    "原単価",
    "単価",
    "粗利益",
    "金額",
    "備考",
]


def _row(**values: Any) -> list[Any]:
    by_header = {
        "得意先コード": values.get("customer_code"),
        "得意先名": values.get("customer_name"),
        "売上日": values.get("sales_date"),
        "伝票番号": values.get("slip_no"),
        "取引区分": "掛売上",
        "内訳": values.get("kind", "通常"),
        "商品コード": values.get("product_code"),
        "商品名/摘要": values.get("product_name"),
        "単位": values.get("unit"),
        "数量": values.get("quantity"),
        "原単価": 100,
        "単価": 200,
        "粗利益": 1000,
        "金額": 2000,
        "備考": values.get("note"),
    }
    return [by_header.get(h) if h else None for h in HEADERS]


def _sheet_rows(
    body: list[list[Any]], period: str = "期間:2026年10月01日 ～ 2026年10月31日"
) -> list[list[Any]]:
    return [
        [None, "得意先別売上明細表"],
        [],
        [None, period],
        [],
        HEADERS,
        *body,
        [None, "<<総合計>>"] + [None] * 14,
    ]


def _workbook_bytes(rows: list[list[Any]]) -> bytes:
    wb = Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


PRODUCT_ROW = _row(
    customer_code="00012",
    customer_name="株式会社サンプル商事",
    sales_date=datetime(2026, 10, 5),
    slip_no="10001",
    product_code="AB123",
    product_name="フィルター 23.6φ×20L SUS 150",
    unit="個",
    quantity=50,
    note="10/20納期分",
)
TAX_ROW = _row(
    customer_code="00012",
    customer_name="株式会社サンプル商事",
    sales_date=datetime(2026, 10, 5),
    slip_no="10001",
    kind="《消費税》",
)


class TestParsePeriod:
    def test_reads_period_line(self):
        assert parse_period("期間:2026年10月01日 ～ 2026年10月31日") == (
            date(2026, 10, 1),
            date(2026, 10, 31),
        )

    def test_full_width_and_wave_dash(self):
        assert parse_period("期間：２０２６年１１月１日〜２０２６年１１月３０日") == (
            date(2026, 11, 1),
            date(2026, 11, 30),
        )

    def test_reversed_or_invalid_period_is_none(self):
        assert parse_period("期間:2026年10月31日 ～ 2026年10月01日") is None
        assert parse_period("期間:2026年02月30日 ～ 2026年03月01日") is None
        assert parse_period("得意先別売上明細表") is None


class TestParseShipmentRows:
    def test_reads_product_rows_and_skips_tax_and_total_rows(self):
        parsed = parse_shipment_rows(_sheet_rows([PRODUCT_ROW, TAX_ROW]))

        assert parsed.period_start == date(2026, 10, 1)
        assert parsed.period_end == date(2026, 10, 31)
        assert parsed.skipped_count == 0
        assert parsed.entries == [
            {
                "row_no": 6,
                "sales_date": "2026-10-05",
                "slip_no": "10001",
                "customer_code": "00012",
                "customer_name": "株式会社サンプル商事",
                "product_code": "AB123",
                "product_name": "フィルター 23.6φ×20L SUS 150",
                "quantity": 50,
                "unit": "個",
                "note": "10/20納期分",
                "parse_issues": [],
            }
        ]

    def test_does_not_keep_amount_columns(self):
        parsed = parse_shipment_rows(_sheet_rows([PRODUCT_ROW]))

        keys = set(parsed.entries[0])
        assert not keys & {"unit_price", "cost", "gross_profit", "amount"}
        assert 2000 not in parsed.entries[0].values()

    def test_columns_are_looked_up_by_header_name(self):
        # 列の並びが変わっても見出しの名前で引く
        reordered = list(reversed(HEADERS))
        row = list(reversed(PRODUCT_ROW))
        rows = [[None, "期間:2026年10月01日 ～ 2026年10月31日"], reordered, row]

        parsed = parse_shipment_rows(rows)

        assert parsed.entries[0]["product_code"] == "AB123"
        assert parsed.entries[0]["quantity"] == 50
        assert parsed.entries[0]["row_no"] == 3

    def test_keeps_negative_quantity_for_red_slips(self):
        red = _row(
            customer_code="00012",
            sales_date=datetime(2026, 10, 6),
            product_code="AB123",
            quantity=-10,
        )

        parsed = parse_shipment_rows(_sheet_rows([PRODUCT_ROW, red]))

        assert [e["quantity"] for e in parsed.entries] == [50, -10]

    def test_keeps_identical_rows_separately(self):
        parsed = parse_shipment_rows(_sheet_rows([PRODUCT_ROW, PRODUCT_ROW]))

        assert [e["row_no"] for e in parsed.entries] == [6, 7]

    def test_rows_without_date_or_outside_period_are_skipped(self):
        no_date = _row(customer_code="00012", product_code="AB123", quantity=1)
        outside = _row(
            customer_code="00012",
            sales_date=datetime(2026, 11, 1),
            product_code="AB123",
            quantity=1,
        )

        parsed = parse_shipment_rows(_sheet_rows([PRODUCT_ROW, no_date, outside]))

        assert len(parsed.entries) == 1
        assert parsed.skipped_count == 2

    def test_text_dates_and_invalid_quantity(self):
        row = _row(
            customer_code="00012",
            sales_date="2026/10/07",
            product_code="AB123",
            quantity="abc",
        )

        parsed = parse_shipment_rows(_sheet_rows([row]))

        assert parsed.entries[0]["sales_date"] == "2026-10-07"
        assert parsed.entries[0]["quantity"] is None
        assert parsed.entries[0]["parse_issues"] == [
            {"field": "quantity", "code": "invalid"}
        ]

    def test_missing_header_raises(self):
        rows = _sheet_rows([PRODUCT_ROW])
        rows[4] = [h if h != "商品コード" else "品番" for h in HEADERS]

        with pytest.raises(ShipmentParseError) as exc:
            parse_shipment_rows(rows)
        assert exc.value.code == "header_not_found"

    def test_missing_period_raises(self):
        with pytest.raises(ShipmentParseError) as exc:
            parse_shipment_rows(_sheet_rows([PRODUCT_ROW], period="期間:不明"))
        assert exc.value.code == "period_not_found"


class TestParseShipmentWorkbook:
    def test_reads_first_sheet(self):
        parsed = parse_shipment_workbook(
            _workbook_bytes(_sheet_rows([PRODUCT_ROW, TAX_ROW]))
        )

        assert len(parsed.entries) == 1
        assert parsed.entries[0]["customer_code"] == "00012"

    def test_invalid_file_raises(self):
        with pytest.raises(ShipmentParseError) as exc:
            parse_shipment_workbook(b"not a workbook")
        assert exc.value.code == "invalid_workbook"
