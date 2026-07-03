# routers/transaction/notifications.py
from datetime import UTC, datetime
from typing import Any, cast

from fastapi import APIRouter, Depends

from app.dependencies import (
    get_current_tenant_id,
    get_supabase_admin_client,
    get_supabase_client,
)
from app.models.transaction.notification_schema import NotificationResponse
from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.services.attachment_service import create_signed_url
from app.utils.logger import get_logger
from supabase import Client

notifications_router = APIRouter(
    prefix="/notifications", tags=["Transaction (Notifications)"]
)

logger = get_logger(__name__)

# order_parse_log 経由の通知（PDF照合失敗・格下げ/重複スキップ）
_PARSE_LOG_NOTIF_TYPES = {
    "no_product_match",
    "downgrade_skipped",
    "draft_conflict_skipped",
}


def _resolve_link_url(
    admin_client: Client, notif_type: str, source_table: str, source_id: str | None
) -> str | None:
    """通知の遷移先URLを解決する。取得できない場合は None。"""
    if source_id is None:
        return None

    if notif_type == "non_order_email":
        return f"https://mail.google.com/mail/u/0/#all/{source_id}"

    attachment_id: str | None = None
    if source_table == "order_attachments":
        attachment_id = source_id
    elif source_table == "order_parse_log" and notif_type in _PARSE_LOG_NOTIF_TYPES:
        log_result = (
            admin_client.table(SupabaseTableName.ORDER_PARSE_LOG.value)
            .select("order_attachment_id")
            .eq("id", source_id)
            .limit(1)
            .execute()
        )
        log_rows = cast(list[dict[str, Any]], log_result.data or [])
        attachment_id = log_rows[0]["order_attachment_id"] if log_rows else None

    if attachment_id is None:
        return None

    attachment_result = (
        admin_client.table(SupabaseTableName.ORDER_ATTACHMENTS.value)
        .select("storage_path")
        .eq("id", attachment_id)
        .limit(1)
        .execute()
    )
    attachment_rows = cast(list[dict[str, Any]], attachment_result.data or [])
    storage_path = attachment_rows[0].get("storage_path") if attachment_rows else None
    if not storage_path:
        return None

    try:
        return create_signed_url(admin_client, storage_path)
    except Exception:
        logger.warning(f"Failed to generate signed URL for {storage_path}")
        return None


@notifications_router.get("", response_model=list[NotificationResponse])
def get_notifications(
    client: Client = Depends(get_supabase_client),
    admin_client: Client = Depends(get_supabase_admin_client),
):
    """通知を新着順に全件取得（各通知の遷移先URL付き）"""
    logger.info("Fetching notifications")
    result = (
        client.table(SupabaseTableName.NOTIFICATIONS.value)
        .select("*")
        .order("created_at", desc=True)
        .execute()
    )
    rows = cast(list[dict[str, Any]], result.data or [])
    return [
        NotificationResponse(
            id=str(row["id"]),
            notif_type=row["notif_type"],
            source_table=row["source_table"],
            source_id=row.get("source_id"),
            detail=row.get("detail"),
            read_at=row.get("read_at"),
            created_at=str(row["created_at"]),
            link_url=_resolve_link_url(
                admin_client,
                row["notif_type"],
                row["source_table"],
                row.get("source_id"),
            ),
        )
        for row in rows
    ]


@notifications_router.patch("/read")
def mark_notifications_read(
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
):
    """未読の通知を全件既読化する"""
    logger.info("Marking notifications as read")
    now = datetime.now(UTC).isoformat()
    client.table(SupabaseTableName.NOTIFICATIONS.value).update({"read_at": now}).eq(
        "tenant_id", tenant_id
    ).is_("read_at", "null").execute()
    return {"status": "read"}
