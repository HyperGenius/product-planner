from fastapi import APIRouter, HTTPException, Request

from app.dependencies import get_supabase_admin_client
from app.routers.cron._alert import alert_cron_failure, alert_cron_success
from app.routers.cron._auth import validate_cron_secret
from app.services.shipment_parsing_service import parse_pending_shipment_files
from app.utils.logger import get_logger

parse_shipment_files_router = APIRouter(prefix="/api/cron", tags=["Cron"])
logger = get_logger(__name__)


@parse_shipment_files_router.get("/parse-shipment-files")
def parse_shipment_files(request: Request):
    """未処理の弥生のエクスポートを解析し、明細を保存する（Issue #667）。

    `shipment_files.parse_status = 'pending'` のファイルだけを処理する（冪等）。
    明細はファイルの期間の日ごとに、その日を含む最新のファイルの内容へ置き換える。
    Supabase Edge Function `parse-order-pdfs-trigger` から `CRON_SECRET` 付きで呼ばれる。
    """
    validate_cron_secret(request)
    try:
        db_client = get_supabase_admin_client()
        result = parse_pending_shipment_files(db_client)
        alert_cron_success("parse-shipment-files")
        return result
    except Exception as exc:
        alert_cron_failure("parse-shipment-files")
        # 例外の詳細はログにのみ残し、レスポンスは固定文言にする（内部情報の露出防止）。
        logger.error(f"parse-shipment-files failed: {exc}", exc_info=True)
        raise HTTPException(
            status_code=502, detail="parse-shipment-files failed"
        ) from exc
