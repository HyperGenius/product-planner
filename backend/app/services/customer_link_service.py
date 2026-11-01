"""顧客不明の注文を既存の顧客へ紐づける（Issue #609）。

未登録のアドレスから届いた注文は下書き顧客を作らず `customer_id=NULL`（顧客不明）で起票される。
受注担当者が既存の顧客を選ぶと、元のメールの差出人アドレスをその顧客の担当者（customer_contacts）に
登録し、次回から自動で同じ顧客に解決されるようにする。注文・ステージング行・担当者の更新は
RPC `link_customer_to_unknown_orders` が1トランザクションで行う。
"""

from typing import Any, cast

from postgrest.exceptions import APIError

from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.utils.logger import get_logger
from supabase import Client

logger = get_logger(__name__)


class LinkOrderNotFoundError(Exception):
    """注文が無い（RPC の P0002）。"""


class LinkOrderNotUnknownError(Exception):
    """注文が顧客不明ではない（RPC の 55000）。"""


class LinkCustomerNotFoundError(Exception):
    """紐づけ先の顧客が無い（RPC の 23503）。"""


class LinkContactConflictError(Exception):
    """差出人アドレスが別の顧客の担当者として登録済み（RPC の P0001）。上書きしない。"""


class LinkOrderDuplicateError(Exception):
    """紐づけると指定した注文が他の注文と重複する（RPC の 23505）。"""

    def __init__(self, constraint: str | None) -> None:
        super().__init__("duplicate order")
        self.constraint = constraint


class LinkForbiddenError(Exception):
    """テナントのメンバーではない（RPC の 42501）。"""


def email_domain(email: str | None) -> str | None:
    """アドレスのドメイン部（小文字）。形式が不正なら None。"""
    if not email or "@" not in email:
        return None
    domain = email.rsplit("@", 1)[1].strip().lower()
    return domain or None


def find_domain_candidate_customer_ids(
    db: Client, tenant_id: str, sender_email: str
) -> list[int]:
    """差出人と同じドメインの担当者を持つ顧客 ID を、該当する担当者の多い順に返す。

    候補として先頭に出すだけで、自動では確定しない（フリーメール・共有ドメインの誤確定を避ける）。
    """
    domain = email_domain(sender_email)
    if domain is None:
        return []
    result = (
        db.table(SupabaseTableName.CUSTOMER_CONTACTS.value)
        .select("customer_id, email")
        .eq("tenant_id", tenant_id)
        .ilike("email", f"%@{domain}")
        .execute()
    )
    counts: dict[int, int] = {}
    for row in cast(list[dict[str, Any]], result.data or []):
        # ilike の `_` はワイルドカードなので、ドメインが一致する行だけに絞る
        if email_domain(row.get("email")) != domain:
            continue
        cid = int(row["customer_id"])
        counts[cid] = counts.get(cid, 0) + 1
    return sorted(counts, key=lambda cid: (-counts[cid], cid))


def get_link_context(
    db: Client, tenant_id: str, order: dict[str, Any]
) -> dict[str, Any]:
    """紐づけ画面に出す情報（差出人・担当者の登録状況・同じドメインの候補・まとめ直しの対象数）。"""
    sender_email: str | None = None
    source_attachment_id = order.get("source_attachment_id")
    if source_attachment_id:
        rows = cast(
            list[dict[str, Any]],
            db.table(SupabaseTableName.ORDER_ATTACHMENTS.value)
            .select("sender_email")
            .eq("tenant_id", tenant_id)
            .eq("id", source_attachment_id)
            .limit(1)
            .execute()
            .data
            or [],
        )
        sender_email = rows[0].get("sender_email") if rows else None

    context: dict[str, Any] = {
        "sender_email": sender_email,
        "contact_owner_customer_id": None,
        "candidate_customer_ids": [],
        "same_sender_order_count": 0,
    }
    if not sender_email:
        return context

    owner = cast(
        list[dict[str, Any]],
        db.table(SupabaseTableName.CUSTOMER_CONTACTS.value)
        .select("customer_id")
        .eq("tenant_id", tenant_id)
        .eq("email", sender_email)
        .limit(1)
        .execute()
        .data
        or [],
    )
    if owner:
        context["contact_owner_customer_id"] = int(owner[0]["customer_id"])
    context["candidate_customer_ids"] = find_domain_candidate_customer_ids(
        db, tenant_id, sender_email
    )

    sibling_attachments = cast(
        list[dict[str, Any]],
        db.table(SupabaseTableName.ORDER_ATTACHMENTS.value)
        .select("id")
        .eq("tenant_id", tenant_id)
        .eq("sender_email", sender_email)
        .is_("customer_id", "null")
        .is_("order_id", "null")
        .execute()
        .data
        or [],
    )
    attachment_ids = [a["id"] for a in sibling_attachments]
    if attachment_ids:
        siblings = (
            db.table(SupabaseTableName.ORDERS.value)
            .select("id", count="exact")  # type: ignore[arg-type]
            .eq("tenant_id", tenant_id)
            .eq("status", "draft")
            .is_("customer_id", "null")
            .neq("id", order["id"])
            .in_("source_attachment_id", attachment_ids)
            .execute()
        )
        context["same_sender_order_count"] = siblings.count or 0
    return context


def link_customer(
    db: Client,
    tenant_id: str,
    order_id: int,
    customer_id: int,
    register_contact: bool,
    apply_to_same_sender: bool,
) -> dict[str, Any]:
    """RPC を呼んで紐づける。失敗は専用の例外へ変換する（生の DB 例外文言は外へ出さない）。"""
    try:
        result = db.rpc(
            "link_customer_to_unknown_orders",
            {
                "p_tenant_id": tenant_id,
                "p_order_id": order_id,
                "p_customer_id": customer_id,
                "p_register_contact": register_contact,
                "p_apply_to_same_sender": apply_to_same_sender,
            },
        ).execute()
    except APIError as exc:
        logger.error(
            "link_customer_to_unknown_orders failed (order=%s, code=%s)",
            order_id,
            exc.code,
            exc_info=True,
        )
        if exc.code == "42501":
            raise LinkForbiddenError from exc
        if exc.code == "P0002":
            raise LinkOrderNotFoundError from exc
        if exc.code == "55000":
            raise LinkOrderNotUnknownError from exc
        if exc.code == "23503":
            raise LinkCustomerNotFoundError from exc
        if exc.code == "P0001":
            raise LinkContactConflictError from exc
        if exc.code == "23505":
            raise LinkOrderDuplicateError(exc.message) from exc
        raise
    return cast(dict[str, Any], result.data)
