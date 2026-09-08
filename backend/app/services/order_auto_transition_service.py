"""着手日の到来に応じた orders.status の自動遷移 (Issue #400)。

現場メンバーはアプリを操作する余裕がないため、受注が「生産中」に入ったことを
手動で記録できない。そこで着手日（`scheduling_start_date`、無ければ最早工程の
`production_schedules.start_datetime` の日付）を基準に、cron
(`GET /api/cron/advance-order-status`) が以下の遷移を自動で行う。

* `confirmed`   かつ 着手日 <= today  -> `in_progress`
* `in_progress` かつ 着手日 >  today  -> `confirmed`   （着手日が未来へ戻ったときの巻き戻し）

着手日が解決できない（`scheduling_start_date` も紐づくスケジュールも無い）受注は
対象外。証跡ログは残さない（承認ワークフローではないため `order_approval_log` には
混ぜない。必要になったら別テーブルを追加する）。
"""

from datetime import date, datetime
from typing import Any

from app.repositories.supa_infra.transaction.order_repo import OrderRepository
from app.repositories.supa_infra.transaction.schedule_repo import ScheduleRepository
from app.services.scheduling_start_service import parse_scheduling_start_date
from app.utils.logger import get_logger
from supabase import Client  # type: ignore

logger = get_logger(__name__)

# 自動遷移の対象となる現在ステータス。
_TARGET_STATUSES = ("confirmed", "in_progress")


def _parse_schedule_start_date(value: str | datetime | None) -> date | None:
    """`production_schedules.start_datetime`（timestamptz）を date へ変換する。"""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date()
    except ValueError:
        logger.warning("invalid schedule start_datetime value=%r", value)
        return None


def resolve_effective_start_date(
    scheduling_start_date: str | date | None,
    earliest_schedule_start: str | datetime | None,
) -> date | None:
    """着手日を解決する。

    `scheduling_start_date`（明示指定の作業開始日）を最優先し、未指定なら
    最早工程の `start_datetime` の日付にフォールバックする。どちらも無ければ None。
    """
    try:
        explicit = parse_scheduling_start_date(scheduling_start_date)
    except ValueError:
        logger.warning("invalid scheduling_start_date value=%r", scheduling_start_date)
        explicit = None
    if explicit is not None:
        return explicit
    return _parse_schedule_start_date(earliest_schedule_start)


def classify_status_transitions(
    candidates: list[dict[str, Any]],
    earliest_start_by_order: dict[int, str],
    today: date,
) -> tuple[list[int], list[int]]:
    """遷移対象の受注IDを (in_progress にする, confirmed に戻す) に振り分ける。

    Args:
        candidates: `id` / `status` / `scheduling_start_date` を持つ受注の一覧
            （status は `confirmed` / `in_progress` のいずれか）。
        earliest_start_by_order: order_id -> 最早工程の start_datetime（ISO文字列）。
        today: 判定基準日。

    Returns:
        (to_in_progress, to_confirmed): それぞれ更新対象の order_id リスト。
    """
    to_in_progress: list[int] = []
    to_confirmed: list[int] = []

    for order in candidates:
        order_id = order.get("id")
        status = order.get("status")
        if order_id is None or status not in _TARGET_STATUSES:
            continue

        effective_start = resolve_effective_start_date(
            order.get("scheduling_start_date"),
            earliest_start_by_order.get(order_id),
        )
        if effective_start is None:
            # 着手日が判定できない受注は動かさない。
            continue

        started = effective_start <= today
        if status == "confirmed" and started:
            to_in_progress.append(order_id)
        elif status == "in_progress" and not started:
            to_confirmed.append(order_id)

    return to_in_progress, to_confirmed


def _earliest_start_by_order(
    schedule_repo: ScheduleRepository, order_ids: list[int]
) -> dict[int, str]:
    """order_id ごとの最早 start_datetime を返す。"""
    rows = schedule_repo.get_start_datetimes_by_order_ids(order_ids)
    earliest: dict[int, str] = {}
    for row in rows:
        oid = row.get("order_id")
        start = row.get("start_datetime")
        if oid is None or start is None:
            continue
        current = earliest.get(oid)
        if current is None or str(start) < current:
            earliest[oid] = str(start)
    return earliest


def advance_order_statuses(db: Client, today: date | None = None) -> dict[str, Any]:
    """着手日を過ぎた受注を in_progress へ、未来へ戻ったものを confirmed へ遷移させる。

    全テナント横断でバルク更新する（cron から admin クライアントで呼ばれる）。冪等。
    """
    today = today or datetime.now().date()

    order_repo = OrderRepository(db)
    schedule_repo = ScheduleRepository(db)

    candidates = order_repo.get_status_transition_candidates(list(_TARGET_STATUSES))
    if not candidates:
        logger.info("advance_order_statuses: no candidates")
        return {
            "to_in_progress": 0,
            "to_confirmed": 0,
            "in_progress_order_ids": [],
            "confirmed_order_ids": [],
        }

    order_ids = [o["id"] for o in candidates if o.get("id") is not None]
    earliest_start_by_order = _earliest_start_by_order(schedule_repo, order_ids)

    to_in_progress, to_confirmed = classify_status_transitions(
        candidates, earliest_start_by_order, today
    )

    if to_in_progress:
        order_repo.bulk_update_status(to_in_progress, "in_progress")
    if to_confirmed:
        order_repo.bulk_update_status(to_confirmed, "confirmed")

    logger.info(
        "advance_order_statuses complete: to_in_progress=%d to_confirmed=%d",
        len(to_in_progress),
        len(to_confirmed),
    )
    return {
        "to_in_progress": len(to_in_progress),
        "to_confirmed": len(to_confirmed),
        "in_progress_order_ids": to_in_progress,
        "confirmed_order_ids": to_confirmed,
    }
