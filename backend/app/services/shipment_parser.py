# backend/app/services/shipment_parser.py
"""弥生の「得意先別売上明細表」（.xlsx）のパーサー (Issue #667, #662 フェーズ2)。

Storage・DB から切り離した純粋関数。ブックのバイト列から期間と商品の行を読み、
`shipment_entries` に保存する形の dict にする。名寄せ（得意先・商品とマスタの照合）は行わず、
弥生の値をそのまま（前後の空白除去・数値セルの文字列化のみ）持つ。

帳票の形（実物の確認結果。docs/features/shipment-file-import.md）:
* シートは1枚。1行目は帳票名、3行目は `期間:YYYY年MM月DD日 ～ YYYY年MM月DD日`、
  5行目は見出し、6行目から明細、最終行は `<<総合計>>`
* 明細には商品の行（商品コードあり）と、伝票ごとの `《消費税》` 行（商品コードが空）がある
* 列は位置ではなく見出しの名前で引く（弥生の設定で列の並びが変わりうる）
* 単価・原単価・粗利益・金額の列は読まない（請求の情報はアプリに置かない）
"""

import re
import unicodedata
import warnings
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from io import BytesIO
from typing import Any
from zipfile import BadZipFile

from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException

from app.services.daily_report_parser import _normalize_header, _to_int, _to_text

# 期間・見出しを探す範囲（帳票の上部の行数が弥生の版で多少ずれても読めるよう余裕を持たせる）
_HEADER_SEARCH_ROWS = 20
_PERIOD_PATTERN = re.compile(
    r"期間[:：]?\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s*[～〜~\-－]\s*(\d{4})年(\d{1,2})月(\d{1,2})日"
)
_SLASH_DATE_PATTERN = re.compile(r"^(\d{4})[/.\-年](\d{1,2})[/.\-月](\d{1,2})日?$")

# 明細の列 → 帳票の見出し（NFKC・空白除去後に完全一致）
_REQUIRED_HEADERS: dict[str, str] = {
    "customer_code": "得意先コード",
    "customer_name": "得意先名",
    "sales_date": "売上日",
    "slip_no": "伝票番号",
    "product_code": "商品コード",
    "product_name": "商品名/摘要",
    "quantity": "数量",
}
_OPTIONAL_HEADERS: dict[str, str] = {
    "unit": "単位",
    "note": "備考",
}


class ShipmentParseError(Exception):
    """ブックとして読めない・帳票の形が違う（期間・見出しが見つからない）。

    `code` は shipment_files.parse_error に入れる固定の分類（例外の文言は入れない）。
    """

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass
class ParsedShipmentFile:
    period_start: date
    period_end: date
    entries: list[dict[str, Any]] = field(default_factory=list)
    # 商品の行なのに保存しなかった行（売上日が無い・期間の外）
    skipped_count: int = 0


def parse_period(text: str) -> tuple[date, date] | None:
    """`期間:2026年10月01日 ～ 2026年10月31日` → (2026-10-01, 2026-10-31)。"""
    m = _PERIOD_PATTERN.search(unicodedata.normalize("NFKC", text))
    if not m:
        return None
    try:
        start = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        end = date(int(m.group(4)), int(m.group(5)), int(m.group(6)))
    except ValueError:
        return None
    return (start, end) if start <= end else None


def _to_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if value is None:
        return None
    text = re.sub(r"\s+", "", unicodedata.normalize("NFKC", str(value)))
    m = _SLASH_DATE_PATTERN.fullmatch(text)
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def _find_period(rows: Sequence[Sequence[Any]]) -> tuple[date, date] | None:
    for row in rows[:_HEADER_SEARCH_ROWS]:
        text = " ".join(str(v) for v in row if v is not None)
        period = parse_period(text)
        if period is not None:
            return period
    return None


def _find_header(rows: Sequence[Sequence[Any]]) -> tuple[int, dict[str, int]] | None:
    """(見出し行の index, 列名 → 列 index)。必須の見出しが揃っていなければ None。"""
    for row_index, row in enumerate(rows[:_HEADER_SEARCH_ROWS]):
        headers = [_normalize_header(v) for v in row]
        if not all(name in headers for name in _REQUIRED_HEADERS.values()):
            continue
        columns = {
            key: headers.index(name)
            for key, name in {**_REQUIRED_HEADERS, **_OPTIONAL_HEADERS}.items()
            if name in headers
        }
        return row_index, columns
    return None


def _cell(row: Sequence[Any], columns: dict[str, int], key: str) -> Any:
    col = columns.get(key)
    if col is None or col >= len(row):
        return None
    return row[col]


def parse_shipment_rows(rows: Sequence[Sequence[Any]]) -> ParsedShipmentFile:
    """1シート分のセルの値（`iter_rows(values_only=True)` の結果）を明細にする。

    `row_no` は Excel の行番号（1始まり）。
    """
    all_rows = [tuple(r) for r in rows]
    period = _find_period(all_rows)
    if period is None:
        raise ShipmentParseError("period_not_found")
    header = _find_header(all_rows)
    if header is None:
        raise ShipmentParseError("header_not_found")
    header_index, columns = header
    period_start, period_end = period

    parsed = ParsedShipmentFile(period_start=period_start, period_end=period_end)
    for row_index in range(header_index + 1, len(all_rows)):
        row = all_rows[row_index]
        product_code = _to_text(_cell(row, columns, "product_code"))
        customer_code = _to_text(_cell(row, columns, "customer_code"))
        # 《消費税》行・<<総合計>> 行・空行は商品コードが空
        if product_code is None or customer_code is None:
            continue
        sales_date = _to_date(_cell(row, columns, "sales_date"))
        # 置き換えは売上日の単位なので、売上日が無い・期間の外の行は保存できない
        if sales_date is None or not period_start <= sales_date <= period_end:
            parsed.skipped_count += 1
            continue

        issues: list[dict[str, str]] = []
        quantity, quantity_ok = _to_int(_cell(row, columns, "quantity"))
        if not quantity_ok:
            issues.append({"field": "quantity", "code": "invalid"})
        elif quantity is None:
            issues.append({"field": "quantity", "code": "missing"})

        parsed.entries.append(
            {
                "row_no": row_index + 1,
                "sales_date": sales_date.isoformat(),
                "slip_no": _to_text(_cell(row, columns, "slip_no")),
                "customer_code": customer_code,
                "customer_name": _to_text(_cell(row, columns, "customer_name")),
                "product_code": product_code,
                "product_name": _to_text(_cell(row, columns, "product_name")),
                "quantity": quantity,
                "unit": _to_text(_cell(row, columns, "unit")),
                "note": _to_text(_cell(row, columns, "note")),
                "parse_issues": issues,
            }
        )
    return parsed


def parse_shipment_workbook(content: bytes) -> ParsedShipmentFile:
    """ブックの先頭のシートを解析する。読めない・帳票の形が違うときは `ShipmentParseError`。"""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            workbook = load_workbook(BytesIO(content), read_only=True, data_only=True)
    except (BadZipFile, InvalidFileException, KeyError, OSError) as exc:
        raise ShipmentParseError("invalid_workbook") from exc

    try:
        if not workbook.worksheets:
            raise ShipmentParseError("header_not_found")
        worksheet = workbook.worksheets[0]
        # read_only モードはファイルに記録された使用範囲（dimensions）だけを読むため、
        # 作成元によって範囲が実データより狭いことがある。範囲を捨てて全行を読む。
        worksheet.reset_dimensions()
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            rows = list(worksheet.iter_rows(values_only=True))
        return parse_shipment_rows(rows)
    finally:
        workbook.close()
