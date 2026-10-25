from fastapi import APIRouter, HTTPException, Request

from app.dependencies import get_supabase_admin_client
from app.routers.cron._auth import validate_cron_secret
from app.services.email_intake_slack_service import notify_email_intake_slack
from app.utils.logger import get_logger

notify_email_intake_slack_router = APIRouter(prefix="/api/cron", tags=["Cron"])
logger = get_logger(__name__)


@notify_email_intake_slack_router.get("/notify-email-intake-slack")
def notify_email_intake_slack_endpoint(request: Request):
    """メール起票の処理結果をプラットフォーム管理者の Slack に件数で通知する（Issue #574）。

    Supabase Edge Function `parse-order-pdfs-trigger` から `parse-order-pdfs` の直後に
    `CRON_SECRET` 付きで呼ばれる。未通知の行だけを送るので毎回叩いても重複しない。
    `SLACK_WEBHOOK_URL` / `APP_BASE_URL` が未設定なら何もしない。
    """
    validate_cron_secret(request)
    try:
        db_client = get_supabase_admin_client()
        return notify_email_intake_slack(db_client)
    except Exception as exc:
        # 例外の詳細はログにのみ残し、レスポンスは固定文言にする（内部情報の露出防止）。
        logger.error(f"notify-email-intake-slack failed: {exc}", exc_info=True)
        raise HTTPException(
            status_code=502, detail="notify-email-intake-slack failed"
        ) from exc
