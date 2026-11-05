"""cron ルーターから失敗・復旧の通知を呼ぶ薄いヘルパー（Issue #636）。

通知の仕組み自体の失敗で cron を失敗させないよう、例外はここで握る。
"""

from app.dependencies import get_supabase_admin_client
from app.services.cron_alert_service import (
    is_alerting_enabled,
    report_cron_failure,
    report_cron_success,
)
from app.utils.logger import get_logger

logger = get_logger(__name__)


def alert_cron_failure(cron_name: str, failed_count: int | None = None) -> None:
    if not is_alerting_enabled():
        return
    try:
        report_cron_failure(get_supabase_admin_client(), cron_name, failed_count)
    except Exception as exc:
        logger.error(
            "cron_alert: could not report %s (%s)", cron_name, type(exc).__name__
        )


def alert_cron_success(cron_name: str) -> None:
    if not is_alerting_enabled():
        return
    try:
        report_cron_success(get_supabase_admin_client(), cron_name)
    except Exception as exc:
        logger.error(
            "cron_alert: could not report %s (%s)", cron_name, type(exc).__name__
        )
