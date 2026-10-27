"""工程の前倒し・後ろ倒し（Issue #582）。

ガントの詳細シートから、注文の1工程を稼働日単位でずらす。ずらした工程の全セグメントと、同じ注文の
`sequence_order` がそれより後の工程を連動して配置し直し、前の工程・他の注文の工程は動かさない。

- ずらし後のセグメントを求める `plan_process_shift()` と、同じ設備の他の注文との重なりを求める
  `find_overlaps()` は DB から切り離した純粋関数
- 保存は RPC `shift_order_process_schedules` で、セグメントの作り直し・完成見込み
  （`orders.confirmed_deadline`）の更新・変更の記録（`production_schedule_shift_logs`）を
  1トランザクションで行う。計算に使った注文のセグメントが保存までに変わっていたら RPC が失敗する
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, cast

from postgrest.exceptions import APIError

from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.repositories.supa_infra.master.equipment_repo import (
    EQUIPMENT_DISPLAY_COLUMNS,
    equipment_display_name,
)
from app.services.daily_report_name_matching_service import fetch_all_rows
from app.services.order_simulation_service import deadline_from_schedules
from app.utils.calendar import (
    JST,
    CalendarConfig,
    add_working_days,
    count_working_minutes,
    get_next_available_start_time,
    split_work_across_days,
)
from app.utils.logger import get_logger
from supabase import Client

logger = get_logger(__name__)

# スケジュールを書き換えられるロール（Issue #581）。承認系と同じく platform_admin を含めず社長に限る。
# 生産管理者のロールができたらここに足す。Frontend `SCHEDULE_EDITOR_ROLES`（types/member.ts）と、
# RPC `shift_order_process_schedules` のロールの検査を揃える
SCHEDULE_EDITOR_ROLES = ("president",)

# 計画をずらせる受注のステータス（スケジュールが確定していて、まだ出荷していない）
SHIFTABLE_ORDER_STATUSES = ("confirmed", "in_progress")

# 1回でずらせる稼働日の上限（ボタンを押し続けた誤操作の歯止め）
MAX_SHIFT_WORKING_DAYS = 30

# 稼働カレンダーを読む範囲の余白（日）。ずらした後の工程が配置される範囲を十分に覆う
_CALENDAR_MARGIN_DAYS = 180

_EPSILON_MINUTES = 0.01


# ---------------------------------------------------------------------------
# 純粋関数
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Segment:
    start: datetime
    end: datetime
    equipment_id: int | None = None


@dataclass(frozen=True)
class ProcessSchedule:
    """注文の1工程の計画（開始順のセグメント）"""

    process_routing_id: int
    sequence_order: int
    segments: tuple[Segment, ...]

    @property
    def start(self) -> datetime:
        return min(s.start for s in self.segments)

    @property
    def end(self) -> datetime:
        return max(s.end for s in self.segments)


@dataclass(frozen=True)
class ShiftedProcess:
    process_routing_id: int
    before: tuple[Segment, ...]
    after: tuple[Segment, ...]

    @property
    def is_milestone(self) -> bool:
        return all(s.start == s.end for s in self.before)


@dataclass(frozen=True)
class ShiftPlan:
    """ずらす工程（対象＋後工程、工程順）と、前倒しが前工程の終了で止まったか"""

    processes: tuple[ShiftedProcess, ...]
    stopped_at_previous: bool


@dataclass(frozen=True)
class OtherSegment:
    """同じ設備を使う他の注文のセグメント（重なりの判定用）"""

    schedule_id: int
    order_id: int
    equipment_id: int
    start: datetime
    end: datetime


@dataclass(frozen=True)
class Overlap:
    process_routing_id: int
    other: OtherSegment


def _process_minutes(process: ProcessSchedule, config: CalendarConfig | None) -> float:
    """工程の所要時間（稼働時間ベースの分）。稼働時間外だけに置かれた区間は実時間で数える"""
    minutes = sum(
        count_working_minutes(s.start, s.end, config) for s in process.segments
    )
    if minutes > _EPSILON_MINUTES:
        return minutes
    return sum((s.end - s.start).total_seconds() / 60 for s in process.segments)


def _relayout(
    process: ProcessSchedule, start: datetime, config: CalendarConfig | None
) -> tuple[Segment, ...]:
    """工程を start 以降の稼働時間に詰めて配置し直す。設備は最初のセグメントの設備のまま"""
    equipment_id = process.segments[0].equipment_id
    if all(s.start == s.end for s in process.segments):
        # マイルストーン（所要時間 0、#379）は時刻だけずらす
        at = get_next_available_start_time(start, 0, config)
        return (Segment(at, at, equipment_id),)
    minutes = _process_minutes(process, config)
    begin = get_next_available_start_time(start, minutes, config)
    return tuple(
        Segment(s, e, equipment_id)
        for s, e in split_work_across_days(begin, minutes, config)
    )


def plan_process_shift(
    processes: Iterable[ProcessSchedule],
    target_routing_id: int,
    working_days: int,
    config: CalendarConfig | None = None,
) -> ShiftPlan:
    """注文の工程 `target_routing_id` を稼働日 `working_days` 日ずらした計画を求める。

    - 対象と、それより `sequence_order` が後の工程を、それぞれ元の開始から稼働日を数えた日の同じ時刻を
      起点に、所要時間（稼働時間ベース）を保ったまま稼働時間へ配置し直す（休日・夜間・休憩を跳ばす）
    - どの工程も、1つ前に配置した工程の終了より前には置かない。対象を前倒しして前工程の終了より
      前に食い込むときは前工程の終了で止め、`stopped_at_previous` を立てる
    - 前の工程は動かさない

    Raises:
        ValueError: 対象の工程が無い、または working_days が 0
    """
    if working_days == 0:
        raise ValueError("working_days must not be 0")
    ordered = sorted(processes, key=lambda p: (p.sequence_order, p.start))
    index = next(
        (i for i, p in enumerate(ordered) if p.process_routing_id == target_routing_id),
        None,
    )
    if index is None:
        raise ValueError(f"process {target_routing_id} not found")

    floor = max((p.end for p in ordered[:index]), default=None)
    stopped = False
    shifted: list[ShiftedProcess] = []
    for process in ordered[index:]:
        start = add_working_days(process.start, working_days, config)
        if floor is not None and start < floor:
            if not shifted and working_days < 0:
                stopped = True
            start = floor
        after = _relayout(process, start, config)
        shifted.append(
            ShiftedProcess(process.process_routing_id, process.segments, after)
        )
        floor = max(s.end for s in after)
    return ShiftPlan(processes=tuple(shifted), stopped_at_previous=stopped)


def find_overlaps(plan: ShiftPlan, others: Iterable[OtherSegment]) -> list[Overlap]:
    """ずらした後のセグメントと時間が重なる、同じ設備の他の注文のセグメント（開始順）。

    設備の無いセグメント・長さ 0 のセグメント（マイルストーン）は設備を占有しないので数えない
    """
    others = [o for o in others if o.end > o.start]
    found: dict[tuple[int, int], Overlap] = {}
    for process in plan.processes:
        for seg in process.after:
            if seg.equipment_id is None or seg.end <= seg.start:
                continue
            for other in others:
                if (
                    other.equipment_id == seg.equipment_id
                    and seg.start < other.end
                    and other.start < seg.end
                ):
                    found.setdefault(
                        (process.process_routing_id, other.schedule_id),
                        Overlap(process.process_routing_id, other),
                    )
    return sorted(found.values(), key=lambda o: (o.other.start, o.other.schedule_id))


# ---------------------------------------------------------------------------
# DB 入出力（ルーターからユーザー JWT で呼ぶ）
# ---------------------------------------------------------------------------


class ShiftOrderNotFoundError(Exception):
    """受注、または受注のその工程の計画が無い"""


class ShiftOrderNotAdjustableError(Exception):
    """計画をずらせない状態の受注（確定済み・生産中以外）"""


class ShiftForbiddenError(Exception):
    """スケジュールを書き換える権限が無い"""


class ShiftConflictError(Exception):
    """計算した後に注文の計画が変わった（プレビューからやり直す）"""


def _parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _to_jst_date(value: datetime) -> date:
    return value.astimezone(JST).date()


def _parse_date(value: Any) -> date | None:
    return date.fromisoformat(value) if isinstance(value, str) and value else None


def _fetch_order(db: Client, tenant_id: str, order_id: int) -> dict[str, Any]:
    res = (
        db.table(SupabaseTableName.ORDERS.value)
        .select("id, status, deadline_date, confirmed_deadline")
        .eq("tenant_id", tenant_id)
        .eq("id", order_id)
        .limit(1)
        .execute()
    )
    rows = cast(list[dict[str, Any]], res.data or [])
    if not rows:
        raise ShiftOrderNotFoundError
    return rows[0]


def _fetch_order_segments(
    db: Client, tenant_id: str, order_id: int
) -> list[dict[str, Any]]:
    def build_query():
        return (
            db.table(SupabaseTableName.PRODUCTION_SCHEDULES.value)
            .select(
                "id, process_routing_id, equipment_id, start_datetime, end_datetime,"
                " process_routings(sequence_order, process_name)"
            )
            .eq("tenant_id", tenant_id)
            .eq("order_id", order_id)
            .order("id")
        )

    return fetch_all_rows(build_query)


def _group_processes(rows: list[dict[str, Any]]) -> list[ProcessSchedule]:
    by_routing: dict[int, list[dict[str, Any]]] = {}
    for row in rows:
        by_routing.setdefault(row["process_routing_id"], []).append(row)
    processes = []
    for routing_id, items in by_routing.items():
        routing = items[0].get("process_routings") or {}
        segments = sorted(
            (
                Segment(
                    _parse_dt(r["start_datetime"]),
                    _parse_dt(r["end_datetime"]),
                    r.get("equipment_id"),
                )
                for r in items
            ),
            key=lambda s: (s.start, s.end),
        )
        processes.append(
            ProcessSchedule(
                process_routing_id=routing_id,
                sequence_order=routing.get("sequence_order") or 0,
                segments=tuple(segments),
            )
        )
    return processes


def _load_calendar(
    db: Client, tenant_id: str, start: date, end: date
) -> CalendarConfig:
    res = (
        db.table(SupabaseTableName.WORK_CALENDARS.value)
        .select("date, is_holiday")
        .eq("tenant_id", tenant_id)
        .gte("date", start.isoformat())
        .lte("date", end.isoformat())
        .execute()
    )
    rows = cast(list[dict[str, Any]], res.data or [])
    return CalendarConfig(
        holidays={date.fromisoformat(r["date"]) for r in rows if r["is_holiday"]},
        workdays={date.fromisoformat(r["date"]) for r in rows if not r["is_holiday"]},
    )


def _fetch_completed_routing_ids(db: Client, tenant_id: str, order_id: int) -> set[int]:
    res = (
        db.table(SupabaseTableName.ORDER_PROCESS_PROGRESS.value)
        .select("process_routing_id")
        .eq("tenant_id", tenant_id)
        .eq("order_id", order_id)
        .eq("status", "completed")
        .execute()
    )
    return {r["process_routing_id"] for r in cast(list[dict[str, Any]], res.data or [])}


def _fetch_other_segments(
    db: Client, tenant_id: str, order_id: int, plan: ShiftPlan
) -> list[dict[str, Any]]:
    """ずらした後のセグメントと同じ設備・期間にかかる、他の注文のセグメント"""
    segments = [
        s for p in plan.processes for s in p.after if s.equipment_id is not None
    ]
    if not segments:
        return []
    equipment_ids = sorted({cast(int, s.equipment_id) for s in segments})
    start = min(s.start for s in segments)
    end = max(s.end for s in segments)

    def build_query():
        return (
            db.table(SupabaseTableName.PRODUCTION_SCHEDULES.value)
            .select(
                "id, order_id, equipment_id, start_datetime, end_datetime,"
                " orders(order_number), process_routings(process_name),"
                f" equipments({EQUIPMENT_DISPLAY_COLUMNS})"
            )
            .eq("tenant_id", tenant_id)
            .in_("equipment_id", equipment_ids)
            .neq("order_id", order_id)
            .lt("start_datetime", end.isoformat())
            .gt("end_datetime", start.isoformat())
            .order("id")
        )

    return fetch_all_rows(build_query)


def _segment_dict(segment: Segment) -> dict[str, Any]:
    return {
        "start_datetime": segment.start.isoformat(),
        "end_datetime": segment.end.isoformat(),
        "equipment_id": segment.equipment_id,
    }


def _range_dict(segments: tuple[Segment, ...]) -> dict[str, str]:
    return {
        "start_datetime": min(s.start for s in segments).isoformat(),
        "end_datetime": max(s.end for s in segments).isoformat(),
    }


def shift_process(
    db: Client,
    tenant_id: str,
    order_id: int,
    process_routing_id: int,
    working_days: int,
    *,
    dry_run: bool,
) -> dict[str, Any]:
    """工程をずらした計画を求め、`dry_run=False` なら保存する。

    戻り値は `ProcessShiftResponse` の形。保存しても戻り値の計画は計算した値そのもの
    （呼び出し側はスケジュールを取り直す）。

    Raises:
        ShiftOrderNotFoundError / ShiftOrderNotAdjustableError / ShiftForbiddenError /
        ShiftConflictError
    """
    order = _fetch_order(db, tenant_id, order_id)
    if order.get("status") not in SHIFTABLE_ORDER_STATUSES:
        raise ShiftOrderNotAdjustableError
    rows = _fetch_order_segments(db, tenant_id, order_id)
    processes = _group_processes(rows)
    if not any(p.process_routing_id == process_routing_id for p in processes):
        raise ShiftOrderNotFoundError

    margin = timedelta(days=_CALENDAR_MARGIN_DAYS + abs(working_days) * 2)
    config = _load_calendar(
        db,
        tenant_id,
        _to_jst_date(min(p.start for p in processes) - margin),
        _to_jst_date(max(p.end for p in processes) + margin),
    )
    plan = plan_process_shift(processes, process_routing_id, working_days, config)

    other_rows = _fetch_other_segments(db, tenant_id, order_id, plan)
    other_by_id = {r["id"]: r for r in other_rows}
    overlaps = find_overlaps(
        plan,
        (
            OtherSegment(
                schedule_id=r["id"],
                order_id=r["order_id"],
                equipment_id=r["equipment_id"],
                start=_parse_dt(r["start_datetime"]),
                end=_parse_dt(r["end_datetime"]),
            )
            for r in other_rows
        ),
    )
    completed = _fetch_completed_routing_ids(db, tenant_id, order_id)
    names = {
        r["process_routing_id"]: (r.get("process_routings") or {}).get("process_name")
        for r in rows
    }
    sequences = {p.process_routing_id: p.sequence_order for p in processes}

    moved_ids = {p.process_routing_id for p in plan.processes}
    # 承認時の完成見込みと同じ規則（最終工程の終了日時 → 日付）。日付は JST の暦日で取る
    after_segments = [
        {"end_datetime": s.end.astimezone(JST).isoformat()}
        for p in processes
        if p.process_routing_id not in moved_ids
        for s in p.segments
    ] + [
        {"end_datetime": s.end.astimezone(JST).isoformat()}
        for p in plan.processes
        for s in p.after
    ]
    new_deadline = date.fromisoformat(deadline_from_schedules(after_segments))
    desired_deadline = _parse_date(order.get("deadline_date"))

    old_first_day = _to_jst_date(min(p.start for p in processes))
    new_first_day = _to_jst_date(
        min(
            [p.start for p in processes if p.process_routing_id not in moved_ids]
            + [s.start for p in plan.processes for s in p.after]
        )
    )

    shifted = [
        {
            "process_routing_id": p.process_routing_id,
            "process_name": names.get(p.process_routing_id),
            "sequence_order": sequences.get(p.process_routing_id),
            "is_milestone": p.is_milestone,
            "is_completed": p.process_routing_id in completed,
            "before": _range_dict(p.before),
            "after": _range_dict(p.after),
            "segments": [_segment_dict(s) for s in p.after],
        }
        for p in plan.processes
    ]
    response: dict[str, Any] = {
        "order_id": order_id,
        "process_routing_id": process_routing_id,
        "working_days": working_days,
        "stopped_at_previous": plan.stopped_at_previous,
        "processes": shifted,
        "confirmed_deadline_before": order.get("confirmed_deadline"),
        "confirmed_deadline_after": new_deadline.isoformat(),
        "desired_deadline": order.get("deadline_date"),
        "exceeds_desired_deadline": desired_deadline is not None
        and new_deadline > desired_deadline,
        "overlaps": [
            {
                "process_routing_id": o.process_routing_id,
                "process_name": names.get(o.process_routing_id),
                "equipment_id": o.other.equipment_id,
                "equipment_name": equipment_display_name(
                    other_by_id[o.other.schedule_id].get("equipments")
                ),
                "other_order_id": o.other.order_id,
                "other_order_number": (
                    other_by_id[o.other.schedule_id].get("orders") or {}
                ).get("order_number"),
                "other_process_name": (
                    other_by_id[o.other.schedule_id].get("process_routings") or {}
                ).get("process_name"),
                "start_datetime": o.other.start.isoformat(),
                "end_datetime": o.other.end.isoformat(),
            }
            for o in overlaps
        ],
        "saved": False,
    }
    if dry_run:
        return response

    _execute_shift(
        db,
        tenant_id=tenant_id,
        order_id=order_id,
        process_routing_id=process_routing_id,
        working_days=working_days,
        expected=rows,
        plan=plan,
        confirmed_deadline=new_deadline,
        # 着手日（受注ステータスの自動遷移 #400 の基準）は作業開始日を優先するので、注文の最初の
        # 工程の日が変わったら作業開始日も合わせる（手動で決めた計画なので auto=false）
        scheduling_start_date=new_first_day if new_first_day != old_first_day else None,
        log_processes=[
            {
                "process_routing_id": p["process_routing_id"],
                "process_name": p["process_name"],
                "before": p["before"],
                "after": p["after"],
            }
            for p in shifted
        ],
        stopped_at_previous=plan.stopped_at_previous,
    )
    return {**response, "saved": True}


def _execute_shift(
    db: Client,
    *,
    tenant_id: str,
    order_id: int,
    process_routing_id: int,
    working_days: int,
    expected: list[dict[str, Any]],
    plan: ShiftPlan,
    confirmed_deadline: date,
    scheduling_start_date: date | None,
    log_processes: list[dict[str, Any]],
    stopped_at_previous: bool,
) -> None:
    try:
        db.rpc(
            "shift_order_process_schedules",
            {
                "p_tenant_id": tenant_id,
                "p_order_id": order_id,
                "p_process_routing_id": process_routing_id,
                "p_working_days": working_days,
                "p_expected": [
                    {
                        "id": r["id"],
                        "process_routing_id": r["process_routing_id"],
                        "equipment_id": r.get("equipment_id"),
                        "start_datetime": r["start_datetime"],
                        "end_datetime": r["end_datetime"],
                    }
                    for r in expected
                ],
                "p_segments": [
                    {"process_routing_id": p.process_routing_id, **_segment_dict(s)}
                    for p in plan.processes
                    for s in p.after
                ],
                "p_confirmed_deadline": confirmed_deadline.isoformat(),
                "p_scheduling_start_date": (
                    scheduling_start_date.isoformat() if scheduling_start_date else None
                ),
                "p_stopped_at_previous": stopped_at_previous,
                "p_log_processes": log_processes,
            },
        ).execute()
    except APIError as exc:
        logger.error(
            "shift_order_process_schedules failed (order=%s, routing=%s, code=%s)",
            order_id,
            process_routing_id,
            exc.code,
            exc_info=True,
        )
        if exc.code == "42501":
            raise ShiftForbiddenError from exc
        if exc.code == "P0002":
            raise ShiftOrderNotFoundError from exc
        if exc.code == "55000":
            raise ShiftOrderNotAdjustableError from exc
        raise ShiftConflictError from exc
