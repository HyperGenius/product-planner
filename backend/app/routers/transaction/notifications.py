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
from app.services.attachment_service import create_signed_urls
from app.utils.logger import get_logger
from supabase import Client

notifications_router = APIRouter(
    prefix="/notifications", tags=["Transaction (Notifications)"]
)

logger = get_logger(__name__)

# order_parse_log 経由の通知（PDF照合失敗・格下げ/重複スキップ・複数受注疑い）
_PARSE_LOG_NOTIF_TYPES = {
    "no_product_match",
    "downgrade_skipped",
    "draft_conflict_skipped",
    "multi_order_suspected",
    "no_order_created",
}


def _fetch_parse_log_attachment_ids(
    admin_client: Client, tenant_id: str, parse_log_ids: set[str]
) -> dict[str, str]:
    """order_parse_log.id -> order_attachment_id の対応をまとめて取得する。"""
    if not parse_log_ids:
        return {}
    log_result = (
        admin_client.table(SupabaseTableName.ORDER_PARSE_LOG.value)
        .select("id, order_attachment_id")
        .in_("id", list(parse_log_ids))
        .eq("tenant_id", tenant_id)
        .execute()
    )
    return {
        log_row["id"]: log_row["order_attachment_id"]
        for log_row in cast(list[dict[str, Any]], log_result.data or [])
        if log_row.get("order_attachment_id")
    }


def _fetch_attachment_storage_paths(
    admin_client: Client, tenant_id: str, attachment_ids: set[str]
) -> dict[str, str]:
    """order_attachments.id -> storage_path の対応をまとめて取得する。"""
    if not attachment_ids:
        return {}
    attachment_result = (
        admin_client.table(SupabaseTableName.ORDER_ATTACHMENTS.value)
        .select("id, storage_path")
        .in_("id", list(attachment_ids))
        .eq("tenant_id", tenant_id)
        .execute()
    )
    return {
        att_row["id"]: att_row["storage_path"]
        for att_row in cast(list[dict[str, Any]], attachment_result.data or [])
        if att_row.get("storage_path")
    }


def _collect_parse_log_ids(
    rows: list[dict[str, Any]], link_urls: dict[str, str | None]
) -> set[str]:
    """order_parse_log 経由で attachment_id を解決すべき通知の source_id を集める。
    non_order_email はこの場でリンクを確定させ link_urls に書き込む。"""
    parse_log_ids: set[str] = set()
    for row in rows:
        source_id = row.get("source_id")
        if source_id is None:
            continue
        if row["notif_type"] == "non_order_email":
            link_urls[row["id"]] = f"https://mail.google.com/mail/u/0/#all/{source_id}"
        elif row["notif_type"] == "approval_requested":
            # source_id はRLS側で数値かつ自テナントの注文であることを検証しているが
            # （20260812000000_...migration）、アプリ層でも念のため数値のみ許可し、
            # 不正な相対パス（/orders/../..等）が生成されないようにする。
            link_urls[row["id"]] = (
                f"/orders/{source_id}" if source_id.isdigit() else None
            )
        elif (
            row["source_table"] == "order_parse_log"
            and row["notif_type"] in _PARSE_LOG_NOTIF_TYPES
        ):
            parse_log_ids.add(source_id)
    return parse_log_ids


def _collect_row_attachment_ids(
    rows: list[dict[str, Any]],
    link_urls: dict[str, str | None],
    parse_log_to_attachment: dict[str, str],
) -> dict[str, str]:
    """通知id -> attachment_id の対応を組み立てる（既にリンク確定済みの行は除外）。"""
    row_attachment_id: dict[str, str] = {}
    for row in rows:
        if row["id"] in link_urls:
            continue
        source_id = row.get("source_id")
        if source_id is None:
            continue
        attachment_id: str | None = None
        if row["source_table"] == "order_attachments":
            attachment_id = source_id
        elif (
            row["source_table"] == "order_parse_log"
            and row["notif_type"] in _PARSE_LOG_NOTIF_TYPES
        ):
            attachment_id = parse_log_to_attachment.get(source_id)
        if attachment_id is not None:
            row_attachment_id[row["id"]] = attachment_id
    return row_attachment_id


def _resolve_link_urls(
    admin_client: Client,
    tenant_id: str,
    rows: list[dict[str, Any]],
) -> dict[str, str | None]:
    """
    通知一覧の遷移先URLをまとめて解決する。notification id をキーとした辞書を返す。

    以前は通知1件ごとに order_parse_log / order_attachments への問い合わせと
    署名付きURL生成APIを呼び出しており、通知件数に比例してレスポンスが遅延していた
    （N+1）。ここではまとめて .in_() で取得し、署名付きURLもバッチ生成する。

    admin_client（Service Role Key、RLSバイパス）を使うため、参照先クエリには
    必ず notifications 行自身の tenant_id を条件に含める。source_id は notifications
    行の値をそのまま使っているため、これを怠ると他テナントの order_parse_log /
    order_attachments 行を参照でき、他テナントの添付ファイルの署名付きURLが
    生成できてしまう（IDOR）。
    """
    link_urls: dict[str, str | None] = {}

    parse_log_ids = _collect_parse_log_ids(rows, link_urls)
    parse_log_to_attachment = _fetch_parse_log_attachment_ids(
        admin_client, tenant_id, parse_log_ids
    )

    row_attachment_id = _collect_row_attachment_ids(
        rows, link_urls, parse_log_to_attachment
    )
    attachment_to_storage_path = _fetch_attachment_storage_paths(
        admin_client, tenant_id, set(row_attachment_id.values())
    )

    signed_url_map: dict[str, str] = {}
    storage_paths = sorted(set(attachment_to_storage_path.values()))
    if storage_paths:
        try:
            signed_url_map = create_signed_urls(admin_client, storage_paths)
        except Exception:
            logger.warning(
                f"Failed to generate signed URLs for {len(storage_paths)} paths"
            )

    for notif_id, attachment_id in row_attachment_id.items():
        storage_path = attachment_to_storage_path.get(attachment_id)
        link_urls[notif_id] = signed_url_map.get(storage_path) if storage_path else None

    return link_urls


@notifications_router.get("", response_model=list[NotificationResponse])
def get_notifications(
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
    admin_client: Client = Depends(get_supabase_admin_client),
):
    """通知を新着順に全件取得（各通知の遷移先URL付き）

    RLS の is_tenant_member(tenant_id) は所属する全テナントの行を許可するため、
    複数テナントに所属するユーザーが他テナントの通知を受け取らないよう
    x-tenant-id ヘッダーの tenant_id で明示的に絞り込む
    （PATCH /notifications/read と同じ絞り込みに揃える）。
    """
    logger.info("Fetching notifications")
    result = (
        client.table(SupabaseTableName.NOTIFICATIONS.value)
        .select("*")
        .eq("tenant_id", tenant_id)
        .order("created_at", desc=True)
        .execute()
    )
    rows = cast(list[dict[str, Any]], result.data or [])
    link_urls = _resolve_link_urls(admin_client, tenant_id, rows)
    return [
        NotificationResponse(
            id=str(row["id"]),
            notif_type=row["notif_type"],
            source_table=row["source_table"],
            source_id=row.get("source_id"),
            detail=row.get("detail"),
            read_at=row.get("read_at"),
            created_at=str(row["created_at"]),
            link_url=link_urls.get(row["id"]),
        )
        for row in rows
    ]


@notifications_router.patch("/read")
def mark_notifications_read(
    tenant_id: str = Depends(get_current_tenant_id),
    admin_client: Client = Depends(get_supabase_admin_client),
):
    """
    未読の通知を全件既読化する。

    notifications は認証ユーザーに SELECT のみ許可しており（他テナントの
    行を経由した情報漏えいを避けるため）、UPDATE は admin_client 経由で行う。
    x-tenant-id ヘッダー由来の tenant_id で対象を絞り込む
    （他の admin_client 使用箇所と同じパターン）。
    """
    logger.info("Marking notifications as read")
    now = datetime.now(UTC).isoformat()
    admin_client.table(SupabaseTableName.NOTIFICATIONS.value).update(
        {"read_at": now}
    ).eq("tenant_id", tenant_id).is_("read_at", "null").execute()
    return {"status": "read"}
