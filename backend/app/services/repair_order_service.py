"""修理注文（orders.order_type='repair'）の共通ルール（Issue #493）。

修理は製品・工程・設備を持たず、受注担当者が実施開始日（scheduling_start_date）と
完了予定日（simulated_deadline）を手で入れ、承認時に完了予定日を confirmed_deadline へ
コピーする。ルーター（受注の作成・更新・承認）と cron の取り込み（pdf_order_parsing_service）
の両方から使うため、DB・FastAPI に依存しない純粋関数だけを置く。
"""

from datetime import date
from typing import Any

REPAIR_ORDER_TYPE = "repair"


def is_repair_order(order: dict[str, Any] | None) -> bool:
    return order is not None and order.get("order_type") == REPAIR_ORDER_TYPE


def parse_order_date(raw: Any) -> date | None:
    """YYYY-MM-DD の文字列を date にする。None・空文字は None。

    Raises:
        ValueError: 日付として解釈できない値。
    """
    if raw is None or raw == "":
        return None
    if isinstance(raw, date):
        return raw
    if not isinstance(raw, str):
        raise ValueError(f"invalid date: {raw!r}")
    return date.fromisoformat(raw)


def has_repair_dates(order: dict[str, Any]) -> bool:
    """承認依頼・承認に必要な実施開始日と完了予定日が揃っているか。"""
    return bool(order.get("scheduling_start_date")) and bool(
        order.get("simulated_deadline")
    )


def repair_dates_in_order(start: Any, end: Any) -> bool:
    """完了予定日が実施開始日より前でないか（どちらかが未入力なら True）。

    Raises:
        ValueError: どちらかが日付として解釈できない値。
    """
    start_date = parse_order_date(start)
    end_date = parse_order_date(end)
    if start_date is None or end_date is None:
        return True
    return end_date >= start_date


def build_repair_work_description(
    subject: str | None, line_items: list[dict[str, Any]]
) -> str | None:
    """注文書の件名と明細（品名・数量）から修理の作業内容テキストを組み立てる。

    明細は「・品名 ×数量」の箇条書きにする（例:「・補修部1〜3ヶ所 ×11」）。
    品名・数量とも無い明細は飛ばす。件名も明細も無ければ None。
    """
    lines: list[str] = []
    if subject and subject.strip():
        lines.append(subject.strip())
    for item in line_items:
        name = item.get("product_name_raw") or item.get("product_number_raw")
        name = name.strip() if isinstance(name, str) else ""
        quantity = item.get("quantity")
        quantity_text = (
            f"×{quantity}"
            if isinstance(quantity, int) and not isinstance(quantity, bool)
            else ""
        )
        text = " ".join(part for part in (name, quantity_text) if part)
        if text:
            lines.append(f"・{text}")
    return "\n".join(lines) if lines else None
