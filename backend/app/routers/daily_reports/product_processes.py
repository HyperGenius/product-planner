# routers/daily_reports/product_processes.py
"""日報の工程の名寄せ（製品単位）: 製品の工程ルートと日報の工程の突き合わせ (Issue #708, Epic #701)。

日報の実績のハブの② 製品の工程を日報に合わせる。照合結果は保存せず参照のたびに求める
（`services/daily_report_product_process_service.py`）ので、工程の別名・工程ルート・日報で追わない工程を
変えると次の参照で反映される（割り付けの再計算を待たない）。参照はテナントメンバー全員。
書き込みは既存の API（工程の別名 `POST /daily-reports/name-aliases/process`・対象外
`POST /daily-reports/ignored-names`・工程ルート `PUT /process-routings`・日報で追わない工程
`POST /untracked-process-names`）を使う。
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.dependencies import get_current_tenant_id, get_supabase_client
from app.models.daily_report_names import (
    ProductProcessComparisonResponse,
    ProductProcessMismatchResponse,
)
from app.services.daily_report_coverage import period_start
from app.services.daily_report_product_process_service import (
    get_product_process_comparison,
    list_mismatched_product_processes,
)
from app.utils.calendar import JST
from supabase import Client  # type: ignore

daily_report_product_process_router = APIRouter(
    prefix="/daily-reports", tags=["Daily Reports (Product Processes)"]
)

# 期間（直近 N か月）の上限。照合状況（`GET /daily-reports/coverage`）と揃える
_MAX_MONTHS = 36


@daily_report_product_process_router.get(
    "/product-processes", response_model=list[ProductProcessMismatchResponse]
)
def get_product_processes(
    months: int | None = Query(default=None, ge=1, le=_MAX_MONTHS),
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
):
    """工程ルートと日報の工程が合わない製品（合わない工程の明細の多い順）。

    `months` は加工日が直近何か月（今月を含む、JST）の明細で数えるか。省略時はすべての期間。
    加工日の無い明細は期間にかかわらず含める。
    """
    return list_mismatched_product_processes(
        client, tenant_id, period_start(datetime.now(JST).date(), months)
    )


@daily_report_product_process_router.get(
    "/product-processes/{product_id}",
    response_model=ProductProcessComparisonResponse,
)
def get_product_process_detail(
    product_id: int,
    months: int | None = Query(default=None, ge=1, le=_MAX_MONTHS),
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
):
    """製品1つの工程ルート（左）と日報に出てくるその製品の工程（右）の比較。"""
    comparison = get_product_process_comparison(
        client, tenant_id, product_id, period_start(datetime.now(JST).date(), months)
    )
    if comparison is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="製品が見つかりません"
        )
    return comparison
