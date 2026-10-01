# routers/daily_reports/progress.py
"""日報の実績による受注の進捗と未割当の実績の参照 (Issue #490)。

割り付け・進捗の計算は cron（`GET /api/cron/compute-daily-report-progress`）が
テナント単位で全量を再計算して保存する（`services/daily_report_allocation_service.py`）。
ここでは保存済みの結果をユーザー JWT（RLS）で返すだけ。受注1件分は
`GET /orders/{order_id}/progress`（`routers/transaction/orders/progress.py`）。
"""

from fastapi import APIRouter, Depends, Query

from app.dependencies import get_current_tenant_id, get_supabase_client
from app.models.daily_report_progress import (
    OrderProgressListResponse,
    UnallocatedActualResponse,
)
from app.services.daily_report_allocation_service import (
    fetch_last_computed_at,
    fetch_order_progress,
    fetch_unallocated_actuals,
)
from supabase import Client  # type: ignore

daily_report_progress_router = APIRouter(
    prefix="/daily-reports", tags=["Daily Reports (Progress)"]
)

# ガントチャートの表示範囲の受注をまとめて引く想定。URL の長さを抑えるため上限を設ける
_MAX_ORDER_IDS = 500


@daily_report_progress_router.get(
    "/order-progress", response_model=OrderProgressListResponse
)
def get_order_progress(
    order_id: list[int] | None = Query(default=None, max_length=_MAX_ORDER_IDS),
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
):
    """受注×工程の進捗（`?order_id=1&order_id=2` で受注を絞り込む。省略時は全件）。"""
    return {
        "computed_at": fetch_last_computed_at(client, tenant_id),
        "items": fetch_order_progress(client, tenant_id, order_id),
    }


@daily_report_progress_router.get(
    "/unallocated-actuals", response_model=list[UnallocatedActualResponse]
)
def get_unallocated_actuals(
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
):
    """どの受注にも充当できなかった実績（加工日の新しい順）。"""
    return fetch_unallocated_actuals(client, tenant_id)
