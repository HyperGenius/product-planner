from fastapi import APIRouter, HTTPException, Request

from app.dependencies import get_supabase_admin_client
from app.routers.cron._auth import validate_cron_secret
from app.services.pdf_order_parsing_service import parse_pending_order_pdfs
from app.utils.logger import get_logger

parse_order_pdfs_router = APIRouter(prefix="/api/cron", tags=["Cron"])
logger = get_logger(__name__)


@parse_order_pdfs_router.get("/parse-order-pdfs")
def parse_order_pdfs(request: Request):
    validate_cron_secret(request)
    try:
        db_client = get_supabase_admin_client()
        return parse_pending_order_pdfs(db_client)
    except Exception as exc:
        logger.error(f"PDF order parsing failed: {exc}", exc_info=True)
        raise HTTPException(
            status_code=502, detail=f"PDF order parsing error: {exc}"
        ) from exc
