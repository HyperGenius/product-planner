# routers/daily_reports/stock.py
"""日報からの作り置き（先行着手）の推定の参照と、現場の「ここは違う」の指摘 (Issue #591)。

推定は cron（`GET /api/cron/compute-daily-report-progress`）が割り付けと一緒にテナント単位で全量を
再計算して保存する（`services/daily_report_stock_estimator.py`）。ここでは保存済みの推定をユーザー JWT（RLS）で
返し、指摘を登録・取り消しする。指摘は次の再計算で推定に反映される（画面から再計算しない。Issue #490 の方針）。

参照はテナントメンバー全員、指摘の書き込みは別名辞書と同じロール（`_ALIAS_EDITOR_ROLES`）に限る。
"""

from datetime import UTC, datetime
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_supabase_client,
)
from app.models.daily_report_stock import (
    StockEstimatesResponse,
    StockFeedbackResponse,
    StockFeedbackUpsert,
)
from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.routers.daily_reports.name_matching import _require_alias_editor
from app.services.daily_report_allocation_service import fetch_last_computed_at
from app.services.daily_report_name_matching_service import fetch_all_rows
from app.utils.calendar import JST
from supabase import Client  # type: ignore

daily_report_stock_router = APIRouter(
    prefix="/daily-reports", tags=["Daily Reports (Stock)"]
)

_FEEDBACK_COLUMNS = (
    "product_id, kind, process_name, baseline_qty, baseline_date, note, "
    "updated_by, updated_at"
)


def _product_names(client: Client, tenant_id: str) -> dict[int, dict[str, Any]]:
    rows = fetch_all_rows(
        lambda: (
            client.table(SupabaseTableName.PRODUCTS.value)
            .select("id, name, code")
            .eq("tenant_id", tenant_id)
            .order("id")
        )
    )
    return {int(r["id"]): r for r in rows}


def _with_product(row: dict[str, Any], products: dict[int, dict[str, Any]]) -> dict:
    product = products.get(int(row["product_id"])) or {}
    return {
        **row,
        "product_name": product.get("name"),
        "product_code": product.get("code"),
    }


def _require_product(client: Client, tenant_id: str, product_id: int) -> None:
    result = (
        client.table(SupabaseTableName.PRODUCTS.value)
        .select("id")
        .eq("tenant_id", tenant_id)
        .eq("id", product_id)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="製品が見つかりません")


def _require_product_process(
    client: Client, tenant_id: str, product_id: int, process_name: str
) -> None:
    """工程名がその製品の工程ルートにあることを確かめる。"""
    result = (
        client.table(SupabaseTableName.PROCESS_ROUTINGS.value)
        .select("id")
        .eq("tenant_id", tenant_id)
        .eq("product_id", product_id)
        .eq("process_name", process_name)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"この製品の工程に「{process_name}」がありません",
        )


@daily_report_stock_router.get(
    "/stock-estimates", response_model=StockEstimatesResponse
)
def get_stock_estimates(
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
):
    """作り置きの推定数（多い順）と、現場の指摘。"""
    estimates = fetch_all_rows(
        lambda: (
            client.table(SupabaseTableName.DAILY_REPORT_STOCK_ESTIMATES.value)
            .select(
                "product_id, process_name, next_process_name, qty, last_movement_date"
            )
            .eq("tenant_id", tenant_id)
            .order("product_id")
            .order("process_name")
        )
    )
    feedback = fetch_all_rows(
        lambda: (
            client.table(SupabaseTableName.DAILY_REPORT_STOCK_FEEDBACK.value)
            .select(_FEEDBACK_COLUMNS)
            .eq("tenant_id", tenant_id)
            .order("product_id")
        )
    )
    products = _product_names(client, tenant_id)
    estimates.sort(
        key=lambda r: (-int(r["qty"]), int(r["product_id"]), r["process_name"])
    )
    feedback.sort(key=lambda r: str(r["updated_at"]), reverse=True)
    return {
        "computed_at": fetch_last_computed_at(client, tenant_id),
        "items": [_with_product(r, products) for r in estimates],
        "feedback": [_with_product(r, products) for r in feedback],
    }


@daily_report_stock_router.put(
    "/stock-feedback/{product_id}", response_model=StockFeedbackResponse
)
def put_stock_feedback(
    product_id: int,
    payload: StockFeedbackUpsert,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    """製品の作り置きについての指摘を登録する（既にあれば上書き）。次の集計で推定に反映される。"""
    _require_alias_editor(tenant_id, user_id, client)
    _require_product(client, tenant_id, product_id)
    if payload.process_name is not None:
        _require_product_process(client, tenant_id, product_id, payload.process_name)
    if (
        payload.baseline_date is not None
        and payload.baseline_date > datetime.now(JST).date()
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="基準日に未来の日付は指定できません",
        )

    result = (
        client.table(SupabaseTableName.DAILY_REPORT_STOCK_FEEDBACK.value)
        .upsert(
            {
                "tenant_id": tenant_id,
                "product_id": product_id,
                "kind": payload.kind,
                "process_name": payload.process_name,
                "baseline_qty": payload.baseline_qty,
                "baseline_date": payload.baseline_date.isoformat()
                if payload.baseline_date
                else None,
                "note": payload.note,
                "updated_by": user_id,
                # set_updated_at() のトリガーは付けていない（統合で付け替えても指摘日時を残すため）
                "updated_at": datetime.now(UTC).isoformat(),
            },
            on_conflict="tenant_id,product_id",
        )
        .execute()
    )
    row = cast(list[dict[str, Any]], result.data)[0]
    return _with_product(row, _product_names(client, tenant_id))


@daily_report_stock_router.delete("/stock-feedback/{product_id}")
def delete_stock_feedback(
    product_id: int,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    """製品の作り置きについての指摘を取り消す（次の集計から推定に戻る）。"""
    _require_alias_editor(tenant_id, user_id, client)
    result = (
        client.table(SupabaseTableName.DAILY_REPORT_STOCK_FEEDBACK.value)
        .delete()
        .eq("tenant_id", tenant_id)
        .eq("product_id", product_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="指摘が見つかりません")
    return {"status": "deleted"}
