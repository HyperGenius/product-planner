"""顧客からの督促・分割納入の依頼メールを、既存の受注に紐づけて記録する（Issue #619）。

督促は注文ではないので起票せず、`order_delivery_requests` に残して受注詳細に表示する。
受注の納期・数量・ステータスは書き換えない（納期変更はホワイトボード、送品は弥生が正典）。
取り込み（cron）は service role で書くため、`tenant_id` で明示的に絞り込む。
"""

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, cast

from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.utils.calendar import JST
from app.utils.logger import get_logger
from supabase import Client

logger = get_logger(__name__)

DELIVERY_REQUEST_PARSE_LOG_REASON = "delivery_request"

# 督促を受ける受注。出荷済み・完了・取消は対象外。下書きのまま納期超過している受注への督促が
# 多いので draft も含める。
_OPEN_ORDER_STATUSES = ("draft", "pending_approval", "confirmed", "in_progress")

BODY_SNIPPET_LENGTH = 200


@dataclass(frozen=True)
class DeliveryRequestEntry:
    """メール本文が言及している1明細（依頼の対象）。"""

    line_index: int
    extracted_product_name: str | None
    quantity: int | None
    requested_date: date | None
    product_id: int | None
    # メールが言及している顧客の注文番号（明細の注文No.、無ければ文書の注文番号）。
    # 同じ顧客・製品の受注が複数あるとき、受注を絞り込むのに使う
    customer_order_no: str | None = None


def parse_requested_date(raw: Any) -> date | None:
    """抽出した日付文字列を date にする。読めない値は None。"""
    if not isinstance(raw, str):
        return None
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        return None


def pick_target_order_id(
    candidates: list[dict[str, Any]],
    today: date,
    customer_order_no: str | None = None,
) -> int | None:
    """候補の受注から督促の対象を1件に決める。決まらなければ None（未紐づけ）。

    メールが注文番号に触れていて、同じ番号の受注が候補にあれば、その受注に絞る
    （当たる受注が無いときは、番号の書き方が違うだけかもしれないので絞らない）。

    複数当たるときは、督促は納期超過の受注に来るものなので、希望納期が今日以前の受注が
    1件だけならそれを選ぶ。それでも1件に定まらなければ確定しない。
    """
    order_no = (customer_order_no or "").strip()
    if order_no:
        same_no = [
            c
            for c in candidates
            if str(c.get("customer_order_no") or "").strip() == order_no
        ]
        candidates = same_no or candidates
    if len(candidates) == 1:
        return int(candidates[0]["id"])
    overdue = [
        c
        for c in candidates
        if (d := parse_requested_date(c.get("deadline_date"))) is not None
        and d <= today
    ]
    return int(overdue[0]["id"]) if len(overdue) == 1 else None


def find_target_order_id(
    db: Client,
    tenant_id: str,
    customer_id: int | None,
    product_id: int | None,
    customer_order_no: str | None = None,
) -> int | None:
    """顧客と製品で、督促の対象になる未出荷の受注を探す。顧客不明・製品不明は紐づけない。"""
    if customer_id is None or product_id is None:
        return None
    result = (
        db.table(SupabaseTableName.ORDERS.value)
        .select("id, deadline_date, customer_order_no")
        .eq("tenant_id", tenant_id)
        .eq("customer_id", customer_id)
        .eq("product_id", product_id)
        .eq("order_type", "production")
        .in_("status", list(_OPEN_ORDER_STATUSES))
        .is_("superseded_at", "null")
        .execute()
    )
    candidates = cast(list[dict[str, Any]], result.data or [])
    return pick_target_order_id(candidates, datetime.now(JST).date(), customer_order_no)


def record_delivery_requests(
    db: Client,
    tenant_id: str,
    attachment_id: str,
    customer_id: int | None,
    kind: str,
    entries: list[DeliveryRequestEntry],
    body: str,
) -> list[int | None]:
    """督促・分納依頼を明細ごとに記録し、記録した行の紐づけ先（order_id。未紐づけは None）を返す。

    同じメールを再処理しても二重に記録しない（既に記録済みの明細は飛ばす）。
    明細が1件も無いメールは、本文の抜粋だけの未紐づけの1行として残す。
    """
    table = SupabaseTableName.ORDER_DELIVERY_REQUESTS.value
    snippet = body[:BODY_SNIPPET_LENGTH]
    if not entries:
        entries = [DeliveryRequestEntry(0, None, None, None, None)]

    existing = (
        db.table(table)
        .select("line_index")
        .eq("tenant_id", tenant_id)
        .eq("order_attachment_id", attachment_id)
        .execute()
    )
    done = {
        int(r["line_index"]) for r in cast(list[dict[str, Any]], existing.data or [])
    }

    linked: list[int | None] = []
    seen: set[tuple[Any, ...]] = set()
    for entry in entries:
        if entry.line_index in done:
            continue
        # 同じメールに同じ内容の明細が重複して読み取られても1行にする（Issue #635）
        content = (
            entry.extracted_product_name,
            entry.quantity,
            entry.requested_date,
            entry.product_id,
        )
        if content in seen:
            continue
        seen.add(content)
        order_id = find_target_order_id(
            db, tenant_id, customer_id, entry.product_id, entry.customer_order_no
        )
        db.table(table).insert(
            {
                "tenant_id": tenant_id,
                "order_id": order_id,
                "order_attachment_id": attachment_id,
                "line_index": entry.line_index,
                "kind": kind,
                "extracted_product_name": entry.extracted_product_name,
                "quantity": entry.quantity,
                "requested_date": (
                    entry.requested_date.isoformat() if entry.requested_date else None
                ),
                "body_snippet": snippet,
            }
        ).execute()
        linked.append(order_id)
    logger.info(
        f"order_delivery_request: attachment {attachment_id} kind={kind} "
        f"recorded={len(linked)} linked={sum(1 for o in linked if o is not None)}"
    )
    return linked
