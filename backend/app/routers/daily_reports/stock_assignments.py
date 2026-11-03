# routers/daily_reports/stock_assignments.py
"""日報の作り置きを受注へ手で引き当てる (Issue #624)。

割り付け（#490）は加工日が受注日より前の実績を充当しないので、作り置き（#591）から出した受注は進捗が
付かない。受注に「この工程まで済んだ作り置きを何個充てた」を登録すると、次の割り付けの再計算で、未割当に
残った同じ製品・同じ工程の実績を顧客・受注日を問わず充当する（`daily_report_allocator._apply_stock_assignments()`）。
画面から再計算しない（Issue #490 の方針。書き込みは cron の service role のみ）。

参照はテナントメンバー全員、登録・取り消しは別名辞書・作り置きの指摘と同じロール（`_ALIAS_EDITOR_ROLES`）。
"""

from datetime import UTC, datetime
from typing import Any, cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_supabase_client,
)
from app.models.daily_report_stock import (
    OrderStockAssignmentsResponse,
    StockAssignmentResponse,
    StockAssignmentUpsert,
)
from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.routers.daily_reports.name_matching import _require_alias_editor
from app.services.daily_report_allocation_service import (
    CANDIDATE_ORDER_STATUSES,
    fetch_last_computed_at,
)
from app.utils.calendar import JST
from supabase import Client  # type: ignore

daily_report_stock_assignment_router = APIRouter(
    prefix="/daily-reports", tags=["Daily Reports (Stock)"]
)

_ASSIGNMENT_COLUMNS = (
    "id, order_id, process_name, qty, assigned_on, note, updated_by, updated_at"
)


def _load_order(client: Client, tenant_id: str, order_id: int) -> dict[str, Any]:
    result = (
        client.table(SupabaseTableName.ORDERS.value)
        .select("id, product_id, quantity, status, order_type")
        .eq("tenant_id", tenant_id)
        .eq("id", order_id)
        .limit(1)
        .execute()
    )
    rows = cast(list[dict[str, Any]], result.data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="受注が見つかりません")
    return rows[0]


def _is_assignable(order: dict[str, Any]) -> bool:
    """割り付けの候補になる受注（確定済み・生産中の、製品のある生産の受注）か。"""
    return (
        order.get("order_type", "production") == "production"
        and order.get("product_id") is not None
        and order.get("status") in CANDIDATE_ORDER_STATUSES
    )


def _process_names(client: Client, tenant_id: str, product_id: int) -> list[str]:
    """製品の工程名（工程ルートの順、重複なし）。"""
    result = (
        client.table(SupabaseTableName.PROCESS_ROUTINGS.value)
        .select("sequence_order, process_name")
        .eq("tenant_id", tenant_id)
        .eq("product_id", product_id)
        .order("sequence_order")
        .execute()
    )
    rows = cast(list[dict[str, Any]], result.data or [])
    names = ((row.get("process_name") or "").strip() for row in rows)
    return list(dict.fromkeys(name for name in names if name))


def _load_assignments(
    client: Client, tenant_id: str, order_id: int
) -> list[dict[str, Any]]:
    result = (
        client.table(SupabaseTableName.DAILY_REPORT_STOCK_ASSIGNMENTS.value)
        .select(_ASSIGNMENT_COLUMNS)
        .eq("tenant_id", tenant_id)
        .eq("order_id", order_id)
        .order("process_name")
        .execute()
    )
    return cast(list[dict[str, Any]], result.data or [])


@daily_report_stock_assignment_router.get(
    "/orders/{order_id}/stock-assignments",
    response_model=OrderStockAssignmentsResponse,
)
def get_order_stock_assignments(
    order_id: int,
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
):
    """受注に引き当てた作り置きと、その製品の工程・作り置きの推定。"""
    order = _load_order(client, tenant_id, order_id)
    product_id = order.get("product_id")
    process_names: list[str] = []
    estimates: list[dict[str, Any]] = []
    if product_id is not None:
        process_names = _process_names(client, tenant_id, int(product_id))
        estimates_result = (
            client.table(SupabaseTableName.DAILY_REPORT_STOCK_ESTIMATES.value)
            .select("process_name, next_process_name, qty, last_movement_date")
            .eq("tenant_id", tenant_id)
            .eq("product_id", product_id)
            .execute()
        )
        estimates = cast(list[dict[str, Any]], estimates_result.data or [])
        # 工程ルートの順に並べる（工程ルートに無い工程は最後）
        position = {name: i for i, name in enumerate(process_names)}
        estimates.sort(
            key=lambda r: (
                position.get(r["process_name"], len(position)),
                r["process_name"],
            )
        )
    return {
        "computed_at": fetch_last_computed_at(client, tenant_id),
        "assignable": _is_assignable(order),
        "process_names": process_names,
        "stock_estimates": estimates,
        "assignments": _load_assignments(client, tenant_id, order_id),
    }


@daily_report_stock_assignment_router.put(
    "/orders/{order_id}/stock-assignments",
    response_model=StockAssignmentResponse,
)
def put_order_stock_assignment(
    order_id: int,
    payload: StockAssignmentUpsert,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    """受注に作り置きを引き当てる（同じ工程の引き当てがあれば上書き）。次の集計で進捗に反映される。"""
    _require_alias_editor(tenant_id, user_id, client)
    order = _load_order(client, tenant_id, order_id)
    if not _is_assignable(order):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="作り置きを引き当てられるのは確定済み・生産中の受注だけです",
        )
    if payload.process_name not in _process_names(
        client, tenant_id, int(order["product_id"])
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"この製品の工程に「{payload.process_name}」がありません",
        )
    quantity = int(order.get("quantity") or 0)
    if payload.qty > quantity:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"引き当てる数は受注数量（{quantity}）以下にしてください",
        )

    result = (
        client.table(SupabaseTableName.DAILY_REPORT_STOCK_ASSIGNMENTS.value)
        .upsert(
            {
                "tenant_id": tenant_id,
                "order_id": order_id,
                "process_name": payload.process_name,
                "qty": payload.qty,
                # 引き当てた日以前の日報だけを充てるので、登録し直したら日付も更新する
                "assigned_on": datetime.now(JST).date().isoformat(),
                "note": payload.note,
                "updated_by": user_id,
                "updated_at": datetime.now(UTC).isoformat(),
            },
            on_conflict="order_id,process_name",
        )
        .execute()
    )
    return cast(list[dict[str, Any]], result.data)[0]


@daily_report_stock_assignment_router.delete(
    "/orders/{order_id}/stock-assignments/{assignment_id}"
)
def delete_order_stock_assignment(
    order_id: int,
    assignment_id: UUID,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    """引き当てを取り消す（次の集計から作り置きに戻る）。"""
    _require_alias_editor(tenant_id, user_id, client)
    result = (
        client.table(SupabaseTableName.DAILY_REPORT_STOCK_ASSIGNMENTS.value)
        .delete()
        .eq("tenant_id", tenant_id)
        .eq("order_id", order_id)
        .eq("id", str(assignment_id))
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="引き当てが見つかりません")
    return {"status": "deleted"}
