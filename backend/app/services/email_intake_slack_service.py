"""メール起票の処理結果をプラットフォーム管理者の Slack に件数で通知する（Issue #574）。

cron (`GET /api/cron/notify-email-intake-slack`) が `parse-order-pdfs` の直後に呼ばれ、
Gmail から受信したステージング行（`order_attachments`、`order_id IS NULL`）のうち
未通知のものを全テナント横断で集計して、Incoming Webhook へ1通にまとめて送る。

* 処理が終わった行（`parse_status <> 'pending'`）は、受信メール処理結果の画面と同じ
  `derive_email_intake_outcome()` で分類し、起票・要確認・失敗の件数を出す（スキップは出さない）
* 受信から `STALLED_AFTER` 以上 `pending` のままの行は「処理待ちの滞留」として出す
* 送信に成功したときだけ `slack_notified_at` / `slack_stalled_notified_at` を書く。
  失敗したら書かず、次回の cron でまとめて再送する
* 件数とリンクだけを載せ、顧客名・品名などの中身は載せない（詳細はアプリで確認する）

ベルの通知（`notifications`）とは切り離している。送り先はプラットフォーム管理者の Slack だけなので、
設定は環境変数 `SLACK_WEBHOOK_URL` / `APP_BASE_URL` に持ち、どちらか未設定なら何もしない。
"""

import os
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import httpx

from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.services.email_intake_outcome import derive_email_intake_outcome
from app.utils.calendar import JST
from app.utils.logger import get_logger
from supabase import Client

logger = get_logger(__name__)

# 受信からこの時間を過ぎても pending の行を「処理待ちの滞留」とする
STALLED_AFTER = timedelta(hours=1)
# 1回の cron で集計する行数の上限（残りは次回に回る）
_BATCH_LIMIT = 500
_SLACK_TIMEOUT_SECONDS = 5.0
# リンク先（受信メール処理結果）
EMAIL_INTAKE_RESULTS_PATH = "/orders/email-intake"


class SlackNotifyError(Exception):
    """Slack への送信に失敗した。

    httpx の例外文言には webhook URL が含まれるため、元の例外は連鎖させない。
    """


@dataclass
class TenantIntakeCounts:
    """1テナント分の通知する件数。"""

    created_emails: int = 0
    created_orders: int = 0
    needs_attention: int = 0
    failed: int = 0
    stalled: int = 0

    def has_any(self) -> bool:
        return bool(self.created_emails or self.failed or self.stalled)


def summarize_email_intakes(
    finished_rows: list[dict[str, Any]],
    stalled_rows: list[dict[str, Any]],
    order_counts: dict[str, int],
    reasons_by_attachment: dict[str, list[str]],
) -> dict[str, TenantIntakeCounts]:
    """未通知の行をテナントごとの件数に集計する。載せる件数が無いテナントは含めない。"""
    counts: dict[str, TenantIntakeCounts] = {}
    for row in finished_rows:
        created_count = order_counts.get(row["id"], 0)
        outcome, needs_attention, _ = derive_email_intake_outcome(
            row["parse_status"],
            created_count,
            reasons_by_attachment.get(row["id"], []),
        )
        tenant_counts = counts.setdefault(row["tenant_id"], TenantIntakeCounts())
        if outcome == "created":
            tenant_counts.created_emails += 1
            tenant_counts.created_orders += created_count
            if needs_attention:
                tenant_counts.needs_attention += 1
        elif outcome == "failed":
            tenant_counts.failed += 1
    for row in stalled_rows:
        counts.setdefault(row["tenant_id"], TenantIntakeCounts()).stalled += 1
    return {tenant_id: c for tenant_id, c in counts.items() if c.has_any()}


def _escape_slack_text(text: str) -> str:
    """Slack の mrkdwn で制御文字として扱われる & < > をエスケープする。"""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def build_slack_message(
    counts_by_tenant: dict[str, TenantIntakeCounts],
    tenant_names: dict[str, str],
    app_base_url: str,
    now: datetime,
) -> str:
    """テナントごとに1行の件数と、受信メール処理結果へのリンクを組み立てる。"""
    lines = [f"📨 メール起票（{now.astimezone(JST):%m/%d %H:%M}）"]
    for tenant_id, c in sorted(
        counts_by_tenant.items(),
        key=lambda item: tenant_names.get(item[0]) or item[0],
    ):
        parts: list[str] = []
        if c.created_emails:
            parts.append(f"起票 {c.created_emails}通（受注 {c.created_orders}件）")
        if c.needs_attention:
            parts.append(f"うち要確認 {c.needs_attention}通")
        if c.failed:
            parts.append(f"失敗 {c.failed}通")
        if c.stalled:
            parts.append(f"処理待ちの滞留 {c.stalled}通")
        name = _escape_slack_text(tenant_names.get(tenant_id) or tenant_id)
        lines.append(f"・{name}：" + "／".join(parts))
    lines.append(f"詳細 → {app_base_url.rstrip('/')}{EMAIL_INTAKE_RESULTS_PATH}")
    return "\n".join(lines)


def _received_staging_rows_query(db: Client) -> Any:
    """Gmail から受信したステージング行（手入力の「メール起票」は除く）。"""
    return (
        db.table(SupabaseTableName.ORDER_ATTACHMENTS.value)
        .select("id, tenant_id, parse_status")
        .is_("order_id", "null")
        .not_.is_("gmail_message_id", "null")
    )


def _fetch_unnotified_finished_rows(db: Client) -> list[dict[str, Any]]:
    result = (
        _received_staging_rows_query(db)
        .neq("parse_status", "pending")
        .is_("slack_notified_at", "null")
        .order("created_at")
        .limit(_BATCH_LIMIT)
        .execute()
    )
    return cast(list[dict[str, Any]], result.data or [])


def _fetch_unnotified_stalled_rows(
    db: Client, received_before: datetime
) -> list[dict[str, Any]]:
    result = (
        _received_staging_rows_query(db)
        .eq("parse_status", "pending")
        .is_("slack_stalled_notified_at", "null")
        .lt("created_at", received_before.isoformat())
        .order("created_at")
        .limit(_BATCH_LIMIT)
        .execute()
    )
    return cast(list[dict[str, Any]], result.data or [])


def _count_orders_by_attachment(
    db: Client, attachment_ids: list[str]
) -> dict[str, int]:
    if not attachment_ids:
        return {}
    result = (
        db.table(SupabaseTableName.ORDERS.value)
        .select("id, source_attachment_id")
        .in_("source_attachment_id", attachment_ids)
        .execute()
    )
    counts: dict[str, int] = {}
    for row in cast(list[dict[str, Any]], result.data or []):
        attachment_id = row["source_attachment_id"]
        counts[attachment_id] = counts.get(attachment_id, 0) + 1
    return counts


def _fetch_reasons_by_attachment(
    db: Client, attachment_ids: list[str]
) -> dict[str, list[str]]:
    if not attachment_ids:
        return {}
    result = (
        db.table(SupabaseTableName.ORDER_PARSE_LOG.value)
        .select("order_attachment_id, reason")
        .in_("order_attachment_id", attachment_ids)
        .execute()
    )
    reasons: dict[str, list[str]] = {}
    for row in cast(list[dict[str, Any]], result.data or []):
        reasons.setdefault(row["order_attachment_id"], []).append(row["reason"])
    return reasons


def _fetch_tenant_names(db: Client, tenant_ids: list[str]) -> dict[str, str]:
    result = (
        db.table(SupabaseTableName.TENANTS.value)
        .select("id, name")
        .in_("id", tenant_ids)
        .execute()
    )
    return {
        row["id"]: row["name"]
        for row in cast(list[dict[str, Any]], result.data or [])
        if row.get("name")
    }


def _post_to_slack(webhook_url: str, text: str) -> None:
    try:
        response = httpx.post(
            webhook_url, json={"text": text}, timeout=_SLACK_TIMEOUT_SECONDS
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        logger.error(
            "email_intake_slack: webhook returned status %s",
            exc.response.status_code,
        )
        raise SlackNotifyError("Slack webhook request failed") from None
    except httpx.HTTPError as exc:
        logger.error(
            "email_intake_slack: webhook request failed (%s)", type(exc).__name__
        )
        raise SlackNotifyError("Slack webhook request failed") from None


def _mark_notified(
    db: Client, column: str, attachment_ids: list[str], now: datetime
) -> None:
    if not attachment_ids:
        return
    (
        db.table(SupabaseTableName.ORDER_ATTACHMENTS.value)
        .update({column: now.isoformat()})
        .in_("id", attachment_ids)
        .is_(column, "null")
        .execute()
    )


def notify_email_intake_slack(
    db: Client, now: datetime | None = None
) -> dict[str, Any]:
    """未通知の受信メールを集計して Slack に送り、送った行を通知済みにする。"""
    webhook_url = os.environ.get("SLACK_WEBHOOK_URL")
    app_base_url = os.environ.get("APP_BASE_URL")
    if not webhook_url or not app_base_url:
        return {"enabled": False, "sent": False, "finished": 0, "stalled": 0}

    now = now or datetime.now(UTC)
    finished_rows = _fetch_unnotified_finished_rows(db)
    stalled_rows = _fetch_unnotified_stalled_rows(db, now - STALLED_AFTER)
    finished_ids = [row["id"] for row in finished_rows]
    counts = summarize_email_intakes(
        finished_rows,
        stalled_rows,
        _count_orders_by_attachment(db, finished_ids),
        _fetch_reasons_by_attachment(db, finished_ids),
    )

    # 載せる件数が無い（スキップだけ等）ときは送らずに通知済みにする
    if counts:
        tenant_names = _fetch_tenant_names(db, list(counts))
        _post_to_slack(
            webhook_url, build_slack_message(counts, tenant_names, app_base_url, now)
        )

    _mark_notified(db, "slack_notified_at", finished_ids, now)
    _mark_notified(
        db, "slack_stalled_notified_at", [row["id"] for row in stalled_rows], now
    )
    logger.info(
        f"email_intake_slack: sent={bool(counts)} finished={len(finished_rows)} "
        f"stalled={len(stalled_rows)} tenants={len(counts)}"
    )
    return {
        "enabled": True,
        "sent": bool(counts),
        "finished": len(finished_rows),
        "stalled": len(stalled_rows),
    }
