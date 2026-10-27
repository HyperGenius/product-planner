# routers/transaction/orders/schedule_shift.py
"""工程の前倒し・後ろ倒し: POST /orders/{order_id}/processes/{process_routing_id}/shift（Issue #582）。

計算と保存は `services/schedule_shift_service.py`。`dry_run=true` はプレビュー、`false` で保存する。
"""

from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_current_user_role,
    get_supabase_client,
)
from app.models.transaction.schedule_shift import (
    ProcessShiftRequest,
    ProcessShiftResponse,
)
from app.services.schedule_shift_service import (
    SCHEDULE_EDITOR_ROLES,
    ShiftConflictError,
    ShiftForbiddenError,
    ShiftOrderNotAdjustableError,
    ShiftOrderNotFoundError,
    shift_process,
)
from supabase import Client  # type: ignore

router = APIRouter()

_FORBIDDEN_MESSAGE = (
    f"スケジュールの変更は {'/'.join(SCHEDULE_EDITOR_ROLES)} のみ操作できます"
)


@router.post(
    "/{order_id}/processes/{process_routing_id}/shift",
    response_model=ProcessShiftResponse,
)
def shift_order_process(
    order_id: int,
    process_routing_id: int,
    body: ProcessShiftRequest,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    """工程を稼働日単位でずらし、同じ注文の後工程を連動させる。

    同じ設備の他の注文との重なり・完了済みの工程・希望納期の超過は警告として返し、保存は妨げない。
    `SCHEDULE_EDITOR_ROLES` 以外は 403。確定済み・生産中以外の受注は 409 `order_not_adjustable`、
    計算の後に計画が変わった場合は 409 `schedule_changed`。
    """
    role = get_current_user_role(tenant_id, user_id, client)
    if role not in SCHEDULE_EDITOR_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=_FORBIDDEN_MESSAGE
        )
    try:
        return shift_process(
            client,
            tenant_id,
            order_id,
            process_routing_id,
            body.working_days,
            dry_run=body.dry_run,
        )
    except ShiftOrderNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="受注、またはこの工程の計画が見つかりません",
        ) from None
    except ShiftOrderNotAdjustableError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "order_not_adjustable",
                "message": "確定済み・生産中の注文だけ計画をずらせます",
            },
        ) from None
    except ShiftForbiddenError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=_FORBIDDEN_MESSAGE
        ) from None
    except ShiftConflictError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "schedule_changed",
                "message": "計画が他の操作で変わりました。もう一度プレビューしてください",
            },
        ) from None
