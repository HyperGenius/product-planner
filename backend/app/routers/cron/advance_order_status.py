from fastapi import APIRouter, HTTPException, Request

from app.dependencies import get_supabase_admin_client
from app.routers.cron._auth import validate_cron_secret
from app.services.order_auto_transition_service import advance_order_statuses
from app.utils.logger import get_logger

advance_order_status_router = APIRouter(prefix="/api/cron", tags=["Cron"])
logger = get_logger(__name__)


@advance_order_status_router.get("/advance-order-status")
def advance_order_status(request: Request):
    """着手日の到来に応じて受注ステータスを自動遷移させる（Issue #400）。

    * `confirmed`   かつ 着手日 <= today  -> `in_progress`
    * `in_progress` かつ 着手日 >  today  -> `confirmed`（巻き戻し）

    全テナント横断・冪等。Supabase Edge Function `parse-order-pdfs-trigger` から
    `CRON_SECRET` 付きで日次相当に呼ばれる。
    """
    validate_cron_secret(request)
    try:
        db_client = get_supabase_admin_client()
        return advance_order_statuses(db_client)
    except Exception as exc:
        logger.error(f"advance-order-status failed: {exc}", exc_info=True)
        raise HTTPException(
            status_code=502, detail=f"advance-order-status error: {exc}"
        ) from exc
