# routers/transaction/orders/progress.py
"""受注の工程ごとの進捗（日報の実績から算出）: GET /orders/{order_id}/progress（Issue #490）。

計算は cron が行い、ここでは保存済みの結果を返すだけ
（`services/daily_report_allocation_service.py`）。複数受注をまとめて引くときは
`GET /daily-reports/order-progress`。
"""

from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import get_current_tenant_id, get_supabase_client
from app.models.daily_report_progress import OrderProgressResponse
from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.services.daily_report_allocation_service import (
    fetch_last_computed_at,
    fetch_order_progress,
)
from supabase import Client  # type: ignore

router = APIRouter()


@router.get("/{order_id}/progress", response_model=OrderProgressResponse)
def get_order_progress(
    order_id: int,
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
):
    """受注の工程ごとの進捗。割り付けの対象外（確定済み・生産中以外）の受注は `processes` が空。"""
    order = (
        client.table(SupabaseTableName.ORDERS.value)
        .select("id")
        .eq("tenant_id", tenant_id)
        .eq("id", order_id)
        .limit(1)
        .execute()
    )
    if not order.data:
        raise HTTPException(status_code=404, detail="Order not found")
    return {
        "order_id": order_id,
        "computed_at": fetch_last_computed_at(client, tenant_id),
        "processes": fetch_order_progress(client, tenant_id, [order_id]),
    }
