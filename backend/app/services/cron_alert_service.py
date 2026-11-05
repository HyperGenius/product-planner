"""cron の失敗・復旧を Slack に通知する（Issue #636）。

cron は10〜15分間隔で回るので、失敗のたびに送るとスパムになる。cron ごとに「失敗中か」を
`cron_alert_state` に持ち、**失敗し始めた回に1回**と**復旧した回に1回**だけ通知する。

* 送信に成功してから状態を書く（失敗したら書かず、次回の cron で再送する）
* 通知に載せるのは cron 名と件数だけ。例外文言・顧客名・webhook URL は載せない
* 通知の失敗・状態の読み書きの失敗が cron 本体を壊さないよう、例外は呼び出し元へ出さない
* `SLACK_WEBHOOK_URL` が未設定なら何もしない（DB にも触れない）
* バックエンド自体が落ちているときは通知できない（Edge Function 側の検知は対象外）
"""

import os
from datetime import UTC, datetime
from typing import Any, cast

from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.services.slack_notify_service import escape_slack_text, post_to_slack
from app.utils.calendar import JST
from app.utils.logger import get_logger
from supabase import Client

logger = get_logger(__name__)


def is_alerting_enabled() -> bool:
    return bool(os.environ.get("SLACK_WEBHOOK_URL"))


def _is_failing(db: Client, cron_name: str) -> bool:
    result = (
        db.table(SupabaseTableName.CRON_ALERT_STATE.value)
        .select("is_failing")
        .eq("cron_name", cron_name)
        .execute()
    )
    rows = cast(list[dict[str, Any]], result.data or [])
    return bool(rows and rows[0].get("is_failing"))


def _save_state(db: Client, cron_name: str, *, is_failing: bool, now: datetime) -> None:
    db.table(SupabaseTableName.CRON_ALERT_STATE.value).upsert(
        {
            "cron_name": cron_name,
            "is_failing": is_failing,
            "failing_since": now.isoformat() if is_failing else None,
            "last_notified_at": now.isoformat(),
            "updated_at": now.isoformat(),
        },
        on_conflict="cron_name",
    ).execute()


def build_failure_message(
    cron_name: str, failed_count: int | None, now: datetime
) -> str:
    detail = f"（失敗 {failed_count}件）" if failed_count else ""
    return (
        f"🚨 cron が失敗しました（{now.astimezone(JST):%m/%d %H:%M}）\n"
        f"・{escape_slack_text(cron_name)}{detail}\n"
        "失敗が続く間は通知を繰り返しません。復旧したらお知らせします。"
        "詳細はバックエンドのログを確認してください。"
    )


def build_recovery_message(cron_name: str, now: datetime) -> str:
    return (
        f"✅ cron が復旧しました（{now.astimezone(JST):%m/%d %H:%M}）\n"
        f"・{escape_slack_text(cron_name)}"
    )


def report_cron_failure(
    db: Client,
    cron_name: str,
    failed_count: int | None = None,
    now: datetime | None = None,
) -> bool:
    """cron の失敗を記録し、失敗し始めたときだけ Slack に通知する。通知したら True。"""
    webhook_url = os.environ.get("SLACK_WEBHOOK_URL")
    if not webhook_url:
        return False
    now = now or datetime.now(UTC)
    try:
        if _is_failing(db, cron_name):
            return False
        post_to_slack(webhook_url, build_failure_message(cron_name, failed_count, now))
        _save_state(db, cron_name, is_failing=True, now=now)
        return True
    except Exception as exc:
        # 例外文言に URL 等が入りうるので型名だけ残す。cron 本体は壊さない。
        logger.error(
            "cron_alert: failure report for %s failed (%s)",
            cron_name,
            type(exc).__name__,
        )
        return False


def report_cron_success(
    db: Client, cron_name: str, now: datetime | None = None
) -> bool:
    """cron の成功を記録し、失敗中だったときだけ復旧を Slack に通知する。通知したら True。"""
    webhook_url = os.environ.get("SLACK_WEBHOOK_URL")
    if not webhook_url:
        return False
    now = now or datetime.now(UTC)
    try:
        if not _is_failing(db, cron_name):
            return False
        post_to_slack(webhook_url, build_recovery_message(cron_name, now))
        _save_state(db, cron_name, is_failing=False, now=now)
        return True
    except Exception as exc:
        logger.error(
            "cron_alert: recovery report for %s failed (%s)",
            cron_name,
            type(exc).__name__,
        )
        return False
