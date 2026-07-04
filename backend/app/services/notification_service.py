from typing import Any

from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.utils.logger import get_logger
from supabase import Client

logger = get_logger(__name__)


def create_notification(
    db: Client,
    tenant_id: str,
    notif_type: str,
    source_table: str,
    source_id: str | None,
    detail: dict[str, Any] | None = None,
) -> None:
    """
    自動処理パイプラインのイベントを担当者向け通知として記録する。

    order_parse_log / order_attachments.parse_status は詳細の一次情報として
    別途残る前提で、notifications は横断的な「担当者に見せる通知」専用の薄い記録。
    """
    db.table(SupabaseTableName.NOTIFICATIONS.value).insert(
        {
            "tenant_id": tenant_id,
            "notif_type": notif_type,
            "source_table": source_table,
            "source_id": str(source_id) if source_id is not None else None,
            "detail": detail,
        }
    ).execute()
    logger.info(
        f"notification: created {notif_type} for tenant {tenant_id} "
        f"(source={source_table}:{source_id})"
    )
