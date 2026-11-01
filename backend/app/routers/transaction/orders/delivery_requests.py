# routers/transaction/orders/delivery_requests.py
"""顧客からの督促・分割納入の依頼（Issue #619）。

- GET   /orders/delivery-requests/open-counts: 受注ごとの未対応の依頼件数（一覧の印用）
- PATCH /orders/delivery-requests/{request_id}: 対応済みにする／戻す
- GET   /orders/{order_id}/delivery-requests: 受注に紐づく依頼

依頼の作成はメール取り込み（cron）だけが行う。受注の納期・数量・ステータスはここから変えない。
"""

from collections import Counter
from datetime import UTC, datetime
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_supabase_client,
)
from app.models.transaction.delivery_request_schema import (
    DeliveryRequestResolveRequest,
    OpenDeliveryRequestCount,
    OrderDeliveryRequestResponse,
)
from app.repositories.supa_infra.common.table_name import SupabaseTableName
from supabase import Client

router = APIRouter()

_TABLE = SupabaseTableName.ORDER_DELIVERY_REQUESTS.value
_COLUMNS = (
    "id, order_id, kind, extracted_product_name, quantity, requested_date, "
    "body_snippet, resolved_at, created_at"
)


@router.get(
    "/delivery-requests/open-counts", response_model=list[OpenDeliveryRequestCount]
)
def list_open_delivery_request_counts(
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
):
    """未対応で受注に紐づいている依頼の件数（受注ごと）。"""
    result = (
        client.table(_TABLE)
        .select("order_id")
        .eq("tenant_id", tenant_id)
        .is_("resolved_at", "null")
        .not_.is_("order_id", "null")
        .execute()
    )
    rows = cast(list[dict[str, Any]], result.data or [])
    counts = Counter(int(r["order_id"]) for r in rows)
    return [
        OpenDeliveryRequestCount(order_id=order_id, count=count)
        for order_id, count in sorted(counts.items())
    ]


@router.patch(
    "/delivery-requests/{request_id}", response_model=OrderDeliveryRequestResponse
)
def resolve_delivery_request(
    request_id: str,
    body: DeliveryRequestResolveRequest,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    """依頼を対応済みにする（`resolved=false` で未対応に戻す）。"""
    update = {
        "resolved_at": datetime.now(UTC).isoformat() if body.resolved else None,
        "resolved_by": user_id if body.resolved else None,
    }
    result = (
        client.table(_TABLE)
        .update(update)
        .eq("tenant_id", tenant_id)
        .eq("id", request_id)
        .execute()
    )
    rows = cast(list[dict[str, Any]], result.data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="Not found")
    return rows[0]


@router.get(
    "/{order_id}/delivery-requests",
    response_model=list[OrderDeliveryRequestResponse],
)
def list_order_delivery_requests(
    order_id: int,
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
):
    """受注に紐づく督促・分納依頼（新しい順）。"""
    result = (
        client.table(_TABLE)
        .select(_COLUMNS)
        .eq("tenant_id", tenant_id)
        .eq("order_id", order_id)
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []
