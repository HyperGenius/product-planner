# routers/transaction/orders/attachments.py
"""注文に紐づく添付ファイル一覧: GET /orders/{order_id}/attachments（Issue #376）。"""

from typing import Any, cast

from fastapi import APIRouter, Depends

from app.dependencies import get_supabase_admin_client, get_supabase_client
from app.models.transaction.order_schema import OrderAttachmentResponse
from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.services.attachment_service import create_signed_url
from app.utils.logger import get_logger
from supabase import Client

router = APIRouter()

logger = get_logger(__name__)


@router.get("/{order_id}/attachments", response_model=list[OrderAttachmentResponse])
def get_order_attachments(
    order_id: int,
    client: Client = Depends(get_supabase_client),
    admin_client: Client = Depends(get_supabase_admin_client),
):
    """注文に紐づく添付ファイル一覧を署名付きURLと共に返す"""
    logger.info(f"Fetching attachments for order {order_id}")
    result = (
        client.table(SupabaseTableName.ORDER_ATTACHMENTS.value)
        .select("*")
        .eq("order_id", order_id)
        .order("created_at")
        .execute()
    )
    rows = cast(list[dict[str, Any]], result.data or [])
    attachments = []
    for row in rows:
        signed_url = ""
        if row.get("storage_path"):
            try:
                signed_url = create_signed_url(admin_client, row["storage_path"])
            except Exception:
                logger.warning(
                    f"Failed to generate signed URL for {row['storage_path']}"
                )
        attachments.append(
            OrderAttachmentResponse(
                id=str(row["id"]),
                order_id=row["order_id"],
                storage_path=row.get("storage_path", ""),
                original_filename=row.get("original_filename", ""),
                content_type=row.get("content_type"),
                size_bytes=row.get("size_bytes"),
                parse_status=row["parse_status"],
                signed_url=signed_url,
                created_at=str(row["created_at"]),
            )
        )
    return attachments
