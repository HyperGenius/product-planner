from fastapi import APIRouter, HTTPException, Request

from app.dependencies import get_supabase_admin_client
from app.routers.cron._auth import validate_cron_secret
from app.services.daily_report_parsing_service import parse_pending_daily_reports
from app.utils.logger import get_logger

parse_daily_reports_router = APIRouter(prefix="/api/cron", tags=["Cron"])
logger = get_logger(__name__)


@parse_daily_reports_router.get("/parse-daily-reports")
def parse_daily_reports(request: Request):
    """未処理の日報ファイルをパースし、明細を保存する（Issue #487）。

    `daily_report_files.parse_status = 'pending'` のファイルだけを処理する（冪等）。
    明細は (テナント, シート名) 単位で最新のファイルの内容に置き換える。
    Supabase Edge Function `parse-order-pdfs-trigger` から `CRON_SECRET` 付きで呼ばれる。
    """
    validate_cron_secret(request)
    try:
        db_client = get_supabase_admin_client()
        return parse_pending_daily_reports(db_client)
    except Exception as exc:
        # 例外の詳細はログにのみ残し、レスポンスは固定文言にする（内部情報の露出防止）。
        logger.error(f"parse-daily-reports failed: {exc}", exc_info=True)
        raise HTTPException(
            status_code=502, detail="parse-daily-reports failed"
        ) from exc
