"""Slack Incoming Webhook への送信の共通部分（Issue #574 / #636）。

メール起票の通知（`email_intake_slack_service`）と運用アラート（`cron_alert_service`）が使う。
送り先は環境変数 `SLACK_WEBHOOK_URL`。
"""

import httpx

from app.utils.logger import get_logger

logger = get_logger(__name__)

_SLACK_TIMEOUT_SECONDS = 5.0


class SlackNotifyError(Exception):
    """Slack への送信に失敗した。

    httpx の例外文言には webhook URL が含まれるため、元の例外は連鎖させない。
    """


def escape_slack_text(text: str) -> str:
    """Slack の mrkdwn で制御文字として扱われる & < > をエスケープする。"""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def post_to_slack(webhook_url: str, text: str) -> None:
    try:
        response = httpx.post(
            webhook_url, json={"text": text}, timeout=_SLACK_TIMEOUT_SECONDS
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        logger.error(
            "slack_notify: webhook returned status %s", exc.response.status_code
        )
        raise SlackNotifyError("Slack webhook request failed") from None
    except httpx.HTTPError as exc:
        logger.error("slack_notify: webhook request failed (%s)", type(exc).__name__)
        raise SlackNotifyError("Slack webhook request failed") from None
