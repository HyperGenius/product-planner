# routers/transaction/orders/repair_conversion.py
"""生産の下書きを修理等へ変更する: POST /orders/{order_id}/convert-to-repair（Issue #568）。"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_order_approval_log_repo,
    get_order_repo,
    get_order_scheduling_start_backdate_log_repo,
    get_supabase_client,
)
from app.models.transaction.order_schema import OrderConvertToRepairRequest
from app.repositories.supa_infra.common import DuplicateRecordError
from app.repositories.supa_infra.transaction.order_approval_log_repo import (
    OrderApprovalLogRepository,
)
from app.repositories.supa_infra.transaction.order_repo import OrderRepository
from app.repositories.supa_infra.transaction.order_scheduling_start_backdate_log_repo import (
    OrderSchedulingStartBackdateLogRepository,
)
from app.services.repair_order_service import is_repair_order
from app.utils.logger import get_logger
from supabase import Client

from ._shared import _duplicate_order_conflict_exception, _map_order_response
from .approval_workflow import _log_approval_action_safely
from .crud import _assert_repair_dates_valid
from .scheduling_start import (
    _assert_scheduling_start_date_allowed,
    _log_scheduling_start_backdate_safely,
)

router = APIRouter()

logger = get_logger(__name__)

_NOT_CONVERTIBLE_DETAIL = "修理等に変更できるのは生産の下書き注文だけです"


@router.post("/{order_id}/convert-to-repair")
def convert_order_to_repair(
    order_id: int,
    body: OrderConvertToRepairRequest,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    order_repo: OrderRepository = Depends(get_order_repo),
    approval_log_repo: OrderApprovalLogRepository = Depends(
        get_order_approval_log_repo
    ),
    backdate_log_repo: OrderSchedulingStartBackdateLogRepository = Depends(
        get_order_scheduling_start_backdate_log_repo
    ),
):
    """取り込みで生産として起票された下書きを修理等（order_type='repair'）へ変更する。

    `order_type` は作成後に変えない前提（`OrderUpdate` に持たせない）なので、PATCH ではなく
    この専用の操作だけで変える。対象は生産の draft に限る（承認依頼後は差し戻してから）。
    修理は製品を持たないので product_id / quantity / extracted_product_name /
    product_candidates を消し、修理等の編集ダイアログと同じ項目を入力値で置き換える。
    draft には実スケジュール（production_schedules）が無い（承認で初めて作られ、確定後に
    draft へ戻る遷移も無い）ため、スケジュールの削除は要らない。操作は承認ログへ記録する。
    """
    logger.info(f"Converting order {order_id} to repair")
    work_description = body.work_description.strip()
    if not work_description:
        raise HTTPException(
            status_code=422, detail={"error": "work_description_required"}
        )
    backdated = _assert_scheduling_start_date_allowed(
        body.scheduling_start_date, tenant_id, user_id, client
    )
    _assert_repair_dates_valid(body.scheduling_start_date, body.simulated_deadline)

    order = order_repo.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if is_repair_order(order) or order.get("status") != "draft":
        raise HTTPException(status_code=400, detail=_NOT_CONVERTIBLE_DETAIL)

    payload: dict[str, Any] = {
        "order_number": body.order_number,
        "customer_id": body.customer_id,
        "deadline_date": body.deadline_date,
        "work_description": work_description,
        "scheduling_start_date": body.scheduling_start_date,
        "scheduling_start_date_auto": False,
        "simulated_deadline": body.simulated_deadline,
        # 修理は実施開始日と完了予定日が揃えば承認依頼できる（起票・PATCH と同じ規則）
        "is_scheduled": bool(body.scheduling_start_date and body.simulated_deadline),
        "product_id": None,
        "quantity": None,
        "extracted_product_name": None,
        "product_candidates": None,
    }
    try:
        result = order_repo.convert_draft_to_repair(order_id, payload)
    except DuplicateRecordError as e:
        raise _duplicate_order_conflict_exception(
            e,
            client=client,
            order_repo=order_repo,
            tenant_id=tenant_id,
            customer_id=body.customer_id,
            product_id=None,
            deadline_date=body.deadline_date,
            extracted_product_name=None,
            exclude_order_id=order_id,
        ) from None
    if result is None:
        # 確認後に承認依頼された等で、更新時点では生産の draft でなくなっていた
        raise HTTPException(status_code=400, detail=_NOT_CONVERTIBLE_DETAIL)

    _log_approval_action_safely(
        approval_log_repo, tenant_id, order_id, "convert_to_repair", user_id
    )
    if backdated and body.scheduling_start_date:
        _log_scheduling_start_backdate_safely(
            backdate_log_repo,
            tenant_id,
            order_id,
            body.scheduling_start_date,
            user_id,
            "update",
        )
    return _map_order_response(result)
