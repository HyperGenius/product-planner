# routers/daily_reports/progress.py
"""日報の実績による受注の進捗・未割当の実績・照合状況の参照 (Issue #490 / #542)。

割り付け・進捗の計算は cron（`GET /api/cron/compute-daily-report-progress`）が
テナント単位で全量を再計算して保存する（`services/daily_report_allocation_service.py`）。
ここでは保存済みの結果をユーザー JWT（RLS）で返すだけ。受注1件分は
`GET /orders/{order_id}/progress`（`routers/transaction/orders/progress.py`）。
"""

from datetime import datetime

from fastapi import APIRouter, Depends, Query

from app.dependencies import get_current_tenant_id, get_supabase_client
from app.models.daily_report_progress import (
    DailyReportCoverageResponse,
    OrderProgressListResponse,
    UnallocatedActualResponse,
    UnallocatedReason,
)
from app.services.daily_report_allocation_service import (
    fetch_last_computed_at,
    fetch_order_progress,
    fetch_unallocated_actuals,
)
from app.services.daily_report_coverage import period_start
from app.services.daily_report_coverage_service import get_coverage
from app.utils.calendar import JST
from supabase import Client  # type: ignore

daily_report_progress_router = APIRouter(
    prefix="/daily-reports", tags=["Daily Reports (Progress)"]
)

# ガントチャートの表示範囲の受注をまとめて引く想定。URL の長さを抑えるため上限を設ける
_MAX_ORDER_IDS = 500

# 照合状況の期間（直近 N か月）の上限
_MAX_MONTHS = 36


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
    product_id: int | None = None,
    process_name: str | None = None,
    reason: UnallocatedReason | None = None,
    months: int | None = Query(default=None, ge=1, le=_MAX_MONTHS),
    limit: int | None = Query(default=None, ge=1, le=1000),
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
):
    """どの受注にも充当できなかった実績（加工日の新しい順）。

    照合状況の画面（#542）では、まとめた1行の元の日報の行を製品・工程名・理由と期間
    （直近 `months` か月。加工日の無い行は常に含める）で絞り込んで引く。
    """
    return fetch_unallocated_actuals(
        client,
        tenant_id,
        product_id=product_id,
        process_name=process_name,
        reason=reason,
        since=period_start(datetime.now(JST).date(), months),
        limit=limit,
    )


@daily_report_progress_router.get(
    "/coverage", response_model=DailyReportCoverageResponse
)
def get_daily_report_coverage(
    months: int | None = Query(default=None, ge=1, le=_MAX_MONTHS),
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
):
    """日報の照合状況のサマリと、未割当の (製品, 工程名, 理由) ごとのまとめ（Issue #542）。

    `months` は直近何か月（今月を含む、JST）の加工日で絞り込むか。省略時はすべての期間。
    """
    return get_coverage(client, tenant_id, months)
