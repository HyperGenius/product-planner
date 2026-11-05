from fastapi import APIRouter, HTTPException, Request

from app.dependencies import get_supabase_admin_client
from app.routers.cron._alert import alert_cron_failure, alert_cron_success
from app.routers.cron._auth import validate_cron_secret
from app.services.gmail_service import poll_unread_emails
from app.utils.logger import get_logger

cron_router = APIRouter(prefix="/api/cron", tags=["Cron"])
logger = get_logger(__name__)


@cron_router.get("/gmail-poll")
def gmail_poll(request: Request):
    validate_cron_secret(request)
    try:
        db_client = get_supabase_admin_client()
        result = poll_unread_emails(db_client)
        alert_cron_success("gmail-poll")
        return result
    except ValueError as exc:
        alert_cron_failure("gmail-poll")
        logger.error(f"Gmail poll config error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        alert_cron_failure("gmail-poll")
        logger.error(f"Gmail poll failed: {exc}")
        raise HTTPException(status_code=502, detail=f"Gmail API error: {exc}") from exc
