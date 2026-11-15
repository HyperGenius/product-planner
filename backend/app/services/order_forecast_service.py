"""注文書の内示（Issue #676）。

注文書の内示・内々示の明細（確度 `forecast` / `forecast_tentative`）は受注として起票せず、
`order_forecasts` に注文書（ステージング行）ごとに保存する。内示は月単位の見込みで、その月の初旬に
改めて注文が来るため起票は要らないが、前もって着手・材料を手配するために数量を見せる。

このモジュールは抽出スキーマの項目定義と、抽出結果の解釈（純粋関数）だけを持つ。
保存は取り込み（`pdf_order_parsing_service`）が RPC `replace_order_forecasts` で行う。
"""

import re
from datetime import date
from typing import Any

# 受注にせず内示として保存する確度
FORECAST_CERTAINTIES = frozenset({"forecast", "forecast_tentative"})

# order_parse_log.reason（受信メール処理結果では「スキップ」に分類する）
FORECAST_PARSE_LOG_REASON = "forecast_recorded"

# 抽出スキーマの明細に足す項目。PDF（テキスト・画像）とメール本文で共有する。
# strict な構造化出力では全項目を required にし、値が無いときは null を返させる
FORECAST_PERIOD_PROPERTIES: dict[str, Any] = {
    "forecast_period_start": {
        "type": ["string", "null"],
        "description": (
            "確度が forecast / forecast_tentative の明細が対象とする期間の最初の月（YYYY-MM）。"
            "「11月 内示」なら 11月、「1月〜3月 内示」なら 1月。年が書かれていなければ文書の"
            "作成日・受信日から補う。confirmed の明細は null。"
        ),
    },
    "forecast_period_end": {
        "type": ["string", "null"],
        "description": (
            "forecast_period_start と同じ明細の期間の最後の月（YYYY-MM）。1か月だけの内示は"
            "forecast_period_start と同じ月。confirmed の明細は null。"
        ),
    },
}

# 抽出の指示に足す文。内示は月単位の数量で日付を持たないことが多い
FORECAST_INSTRUCTION = (
    "内示・内々示の明細は、対象の月を forecast_period_start / forecast_period_end に入れてください"
    "（複数の月をまとめた内示は最初と最後の月）。月単位で日付が無ければ delivery_date は null にします。"
    "内示・内々示は数量が0でも明細として返してください。"
)

_MONTH_PATTERN = re.compile(r"^\s*(\d{4})-(\d{1,2})(?:-(\d{1,2}))?\s*$")


def is_forecast_line(line: dict[str, Any]) -> bool:
    """抽出した明細が内示（受注にしない明細）か。"""
    return line.get("certainty") in FORECAST_CERTAINTIES


def parse_forecast_month(value: Any) -> date | None:
    """`YYYY-MM`（`YYYY-MM-DD` も可）をその月の1日にする。読めなければ None。"""
    if not isinstance(value, str):
        return None
    match = _MONTH_PATTERN.match(value)
    if not match:
        return None
    year, month = int(match.group(1)), int(match.group(2))
    if not 1 <= month <= 12:
        return None
    if match.group(3) is not None:
        try:
            date(year, month, int(match.group(3)))
        except ValueError:
            return None
    return date(year, month, 1)


def forecast_period(line: dict[str, Any]) -> tuple[date | None, date | None]:
    """内示の明細の期間（開始月, 終了月）。どちらも月の1日。

    - 期間の項目が無ければ納期（delivery_date）の月を1か月の期間とする
    - 片方しか読めなければ、もう片方も同じ月にする
    - 開始が終了より後なら期間は分からないものとして (None, None) にする
    """
    start = parse_forecast_month(line.get("forecast_period_start"))
    end = parse_forecast_month(line.get("forecast_period_end"))
    if start is None and end is None:
        start = end = parse_forecast_month(line.get("delivery_date"))
    elif start is None:
        start = end
    elif end is None:
        end = start
    if start is not None and end is not None and start > end:
        return None, None
    return start, end


def forecast_quantity(value: Any) -> int | None:
    """内示の数量。0以上の整数以外（読めない値・負の値）は None（数量不明）にする。"""
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if value >= 0 else None
