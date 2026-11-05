# routers/transaction/orders/delivery_requests.py
"""顧客からの督促・分割納入の依頼（Issue #619）。

- GET   /orders/delivery-requests?status=open: 未対応の依頼の一覧（紐づけ済み・未紐づけ。Issue #622）
- GET   /orders/delivery-requests/open-counts: 受注ごとの未対応の依頼件数（一覧の印用）
- PATCH /orders/delivery-requests/{request_id}: 対応済みにする／戻す
- GET   /orders/{order_id}/delivery-requests: 受注に紐づく依頼

依頼の作成はメール取り込み（cron）だけが行う。受注の納期・数量・ステータスはここから変えない。
"""

from collections import Counter
from datetime import UTC, datetime
from typing import Any, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Query

from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_supabase_client,
)
from app.models.transaction.delivery_request_schema import (
    DeliveryRequestResolveRequest,
    OpenDeliveryRequestCount,
    OpenDeliveryRequestListItem,
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


@router.get("/delivery-requests", response_model=list[OpenDeliveryRequestListItem])
def list_delivery_requests(
    status: Literal["open"] = Query("open"),
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
):
    """未対応の依頼の一覧（新しい順）。受注に紐づかない依頼も含め、受注番号・顧客名を付ける。

    未紐づけの依頼の顧客は、依頼元の受信メール（order_attachments）の顧客から引く。
    """
    result = (
        client.table(_TABLE)
        .select(_COLUMNS + ", order_attachment_id")
        .eq("tenant_id", tenant_id)
        .is_("resolved_at", "null")
        .order("created_at", desc=True)
        .execute()
    )
    rows = cast(list[dict[str, Any]], result.data or [])
    if not rows:
        return []

    order_ids = sorted({int(r["order_id"]) for r in rows if r.get("order_id")})
    order_info: dict[int, dict[str, Any]] = {}
    if order_ids:
        orders = (
            client.table(SupabaseTableName.ORDERS.value)
            .select(
                "id, order_number, customer_id, quantity, deadline_date, "
                "confirmed_deadline, simulated_deadline"
            )
            .eq("tenant_id", tenant_id)
            .in_("id", order_ids)
            .execute()
        )
        order_info = {
            int(o["id"]): o for o in cast(list[dict[str, Any]], orders.data or [])
        }

    attachment_ids = sorted(
        {
            str(r["order_attachment_id"])
            for r in rows
            if not r.get("order_id") and r.get("order_attachment_id")
        }
    )
    attachment_customer: dict[str, int | None] = {}
    if attachment_ids:
        atts = (
            client.table(SupabaseTableName.ORDER_ATTACHMENTS.value)
            .select("id, customer_id")
            .eq("tenant_id", tenant_id)
            .in_("id", attachment_ids)
            .execute()
        )
        attachment_customer = {
            str(a["id"]): a.get("customer_id")
            for a in cast(list[dict[str, Any]], atts.data or [])
        }

    def _customer_id(row: dict[str, Any]) -> int | None:
        if row.get("order_id"):
            return cast(
                "int | None",
                order_info.get(int(row["order_id"]), {}).get("customer_id"),
            )
        return attachment_customer.get(str(row.get("order_attachment_id")))

    customer_ids = sorted({c for r in rows if (c := _customer_id(r)) is not None})
    customer_names: dict[int, str] = {}
    if customer_ids:
        customers = (
            client.table(SupabaseTableName.CUSTOMERS.value)
            .select("id, name")
            .eq("tenant_id", tenant_id)
            .in_("id", customer_ids)
            .execute()
        )
        customer_names = {
            int(c["id"]): c["name"]
            for c in cast(list[dict[str, Any]], customers.data or [])
        }

    items = []
    for r in rows:
        order = order_info.get(int(r["order_id"])) if r.get("order_id") else None
        customer_id = _customer_id(r)
        items.append(
            {
                **r,
                "order_number": order.get("order_number") if order else None,
                "order_quantity": order.get("quantity") if order else None,
                # 受注の希望納期の DB 列は deadline_date（API では desired_deadline）
                "desired_deadline": order.get("deadline_date") if order else None,
                "confirmed_deadline": (
                    order.get("confirmed_deadline") if order else None
                ),
                "simulated_deadline": (
                    order.get("simulated_deadline") if order else None
                ),
                "customer_name": (
                    customer_names.get(int(customer_id)) if customer_id else None
                ),
            }
        )
    return items


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
