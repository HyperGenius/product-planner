from fastapi import APIRouter, HTTPException, Request

from app.dependencies import get_supabase_admin_client
from app.routers.cron._auth import validate_cron_secret
from app.services.daily_report_allocation_service import recompute_all_tenants
from app.utils.logger import get_logger

compute_daily_report_progress_router = APIRouter(prefix="/api/cron", tags=["Cron"])
logger = get_logger(__name__)


@compute_daily_report_progress_router.get("/compute-daily-report-progress")
def compute_daily_report_progress(request: Request):
    """日報の実績を受注に割り付け、受注×工程の進捗を再計算する（Issue #490）。

    明細のあるテナントごとに全量を再計算して置き換える（冪等。差分更新しない）。
    別名辞書の変更・受注の追加・明細の置き換えは次の実行で反映される。
    Supabase Edge Function `parse-order-pdfs-trigger` から `parse-daily-reports` の直後に
    `CRON_SECRET` 付きで呼ばれる。
    """
    validate_cron_secret(request)
    try:
        db_client = get_supabase_admin_client()
        return recompute_all_tenants(db_client)
    except Exception as exc:
        # 例外の詳細はログにのみ残し、レスポンスは固定文言にする（内部情報の露出防止）。
        logger.error(f"compute-daily-report-progress failed: {exc}", exc_info=True)
        raise HTTPException(
            status_code=502, detail="compute-daily-report-progress failed"
        ) from exc
