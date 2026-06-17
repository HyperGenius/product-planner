import os
import secrets

from fastapi import APIRouter, HTTPException, Request, status

from app.services.gmail_service import poll_unread_emails
from app.utils.logger import get_logger

cron_router = APIRouter(prefix="/api/cron", tags=["Cron"])
logger = get_logger(__name__)


def _validate_cron_secret(request: Request) -> None:
    cron_secret = os.environ.get("CRON_SECRET")
    if not cron_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="CRON_SECRET not configured.",
        )
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header.",
        )
    token = auth_header.removeprefix("Bearer ")
    if not secrets.compare_digest(token.encode(), cron_secret.encode()):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid CRON_SECRET.",
        )


@cron_router.get("/gmail-poll")
def gmail_poll(request: Request):
    _validate_cron_secret(request)
    try:
        return poll_unread_emails()
    except ValueError as exc:
        logger.error(f"Gmail poll config error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        logger.error(f"Gmail poll failed: {exc}")
        raise HTTPException(status_code=502, detail=f"Gmail API error: {exc}") from exc
