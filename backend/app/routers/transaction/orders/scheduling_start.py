# routers/transaction/orders/scheduling_start.py
"""作業開始日（scheduling_start_date）の検証・過去日監査ヘルパー（Issue #372）。

crud（create/update）と simulation の両方から共用する。
"""

from fastapi import HTTPException, status

from app.dependencies import get_current_user_role
from app.repositories.supa_infra.transaction.order_scheduling_start_backdate_log_repo import (
    OrderSchedulingStartBackdateLogRepository,
)
from app.services.scheduling_start_service import (
    PastSchedulingStartDateError,
    is_backdated,
    validate_scheduling_start_date,
)
from app.utils.logger import get_logger
from supabase import Client

logger = get_logger(__name__)


def _assert_scheduling_start_date_allowed(
    raw: str | None, tenant_id: str, user_id: str, client: Client
) -> bool:
    """作業開始日の形式・過去日権限を検証し、過去日だったかどうかを返す（Issue #372）。

    過去日 かつ 非権限ロールなら 403、形式不正なら 422 を送出する（Issue #374）。
    未来日・当日・未指定の場合はロール問い合わせを行わず False を返す
    （過去日でなければ権限チェック不要のため、無駄な organization_members 参照を避ける）。
    """
    if not raw:
        return False
    try:
        backdated = is_backdated(raw)
    except ValueError as e:
        logger.warning("invalid scheduling_start_date value=%r: %s", raw, e)
        raise HTTPException(
            status_code=422, detail={"error": "invalid_scheduling_start_date"}
        ) from None
    if not backdated:
        return False
    role = get_current_user_role(tenant_id, user_id, client)
    try:
        validate_scheduling_start_date(raw, role)
    except PastSchedulingStartDateError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=str(e)
        ) from None
    return True


def _log_scheduling_start_backdate_safely(
    repo: OrderSchedulingStartBackdateLogRepository,
    tenant_id: str,
    order_id: int,
    scheduling_start_date: str,
    actor_user_id: str,
    context: str,
) -> None:
    """過去日の作業開始日設定の監査記録はベストエフォートとする（Issue #372）。

    受注の作成／更新自体は既に成功しているため、監査ログの記録失敗で
    業務操作をエラー扱いにはしない。
    """
    try:
        repo.log_backdate(
            tenant_id, order_id, scheduling_start_date, actor_user_id, context
        )
    except Exception:
        logger.exception(
            f"Failed to record scheduling_start backdate log: order_id={order_id}"
        )
