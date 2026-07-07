"""
スケジューリングロジックモジュール

注文に対して、製品の工程順序に基づいて生産スケジュールを作成する。
カレンダーユーティリティを使用して稼働時間（平日 9:00 - 17:00）内でスケジュールを割り当てる。

設備が存在する工程では、既存スケジュールの隙間（ギャップ）に greedy に詰め込む。
ガードタイム・最低時間スロット・最大断片数はグローバル設定 → グループ → 設備の優先度で解決される。
断片数が最大断片数を超える場合は末尾追加にフォールバックする。
"""

from datetime import datetime, timedelta
from typing import Any

from app.models.common.scheduling_settings import SchedulingParams
from app.repositories.supa_infra.common.scheduling_settings_repo import (
    SchedulingSettingsRepository,
)
from app.repositories.supa_infra.master.product_repo import ProductRepository
from app.repositories.supa_infra.transaction.schedule_repo import ScheduleRepository
from app.services.scheduling_settings_service import get_effective_params
from app.utils.calendar import (
    JST,
    CalendarConfig,
    get_next_available_start_time,
    split_work_across_days,
    split_work_in_window,
)

# ギャップ探索のデフォルト探索ホライズン（日）
_GAP_HORIZON_DAYS = 90


class RoutingUnconfirmedError(ValueError):
    """工程が未確定または未登録のためガント登録できない場合に送出する例外"""

    def __init__(self, desired_deadline: str | None = None, no_routing: bool = False):
        super().__init__("工程が未確定です。ガントチャートへの登録をスキップします")
        self.desired_deadline = desired_deadline
        self.no_routing = no_routing


def routings_are_confirmed(routings: list[dict[str, Any]]) -> bool:
    """全工程が確定済みかどうかを返す。工程が0件の場合は False。"""
    if not routings:
        return False
    return all(r.get("is_confirmed", False) for r in routings)


def schedule_order(
    order_id: int | None,
    product_id: int,
    quantity: int,
    product_repo: ProductRepository,
    schedule_repo: ScheduleRepository,
    tenant_id: str,
    start_time: datetime | None = None,
    dry_run: bool = False,
    calendar_config: CalendarConfig | None = None,
    settings_repo: SchedulingSettingsRepository | None = None,
    standalone: bool = False,
    desired_deadline: str | None = None,
) -> list[dict[str, Any]]:
    """
    注文に対してスケジュールを作成する。

    Args:
        order_id: 注文ID（dry_run時はNoneでも可）
        product_id: 製品ID
        quantity: 数量
        product_repo: 製品リポジトリ
        schedule_repo: スケジュールリポジトリ
        tenant_id: テナントID
        start_time: スケジュール開始基準時刻（指定なしの場合は現在時刻）
        dry_run: Trueの場合、DBに保存せずに計算結果のみを返す
        calendar_config: カレンダー設定（Noneの場合はデフォルト設定を使用）
        settings_repo: スケジューリング設定リポジトリ（Noneの場合はデフォルトパラメータ使用）
        standalone: Trueの場合、既存スケジュールを無視して純粋な工程所要時間のみで計算する
        desired_deadline: 顧客希望納期（RoutingUnconfirmedError に付与して呼び出し側で利用）

    Returns:
        作成されたスケジュールのリスト

    Raises:
        ValueError: 工程が取得できない場合、または設備グループにメンバーが存在しない場合
        RoutingUnconfirmedError: dry_run=False 時に未確定工程が含まれる場合
    """
    routings = product_repo.get_routings_by_product(product_id)

    if not routings:
        raise RoutingUnconfirmedError(
            desired_deadline=desired_deadline, no_routing=True
        )

    if not dry_run and not routings_are_confirmed(routings):
        raise RoutingUnconfirmedError(desired_deadline=desired_deadline)

    created_schedules = []
    current_process_start = start_time if start_time else datetime.now(JST)

    for routing in routings:
        equipment_group_id = routing["equipment_group_id"]
        setup_time_sec = routing.get("setup_time_seconds", 0) or 0
        unit_time_sec = float(routing["unit_time_seconds"])

        total_duration_sec = setup_time_sec + (unit_time_sec * quantity)
        total_duration_min = total_duration_sec / 60

        if equipment_group_id is None:
            actual_start = get_next_available_start_time(
                current_process_start, total_duration_min, calendar_config
            )
            best = {
                "machine_id": None,
                "start": actual_start,
                "duration_sec": total_duration_sec,
                "segments": None,
            }
        else:
            best = _select_best_machine(
                equipment_group_id=equipment_group_id,
                current_process_start=current_process_start,
                total_duration_sec=total_duration_sec,
                total_duration_min=total_duration_min,
                tenant_id=tenant_id,
                settings_repo=settings_repo,
                product_repo=product_repo,
                schedule_repo=schedule_repo,
                calendar_config=calendar_config,
                standalone=standalone,
            )

        chosen_start = best["start"]

        if chosen_start is None:
            raise ValueError("開始時刻が取得できません")
        if not isinstance(chosen_start, datetime):
            raise ValueError("開始時刻の型が正しくありません")

        # セグメントが確定済みならそのまま使用、未確定なら split_work_across_days で計算
        raw_segs: list[tuple[datetime, datetime]] | None = best.get("segments")  # type: ignore[assignment]
        schedule_segments: list[tuple[datetime, datetime]] = (
            raw_segs
            if raw_segs is not None
            else split_work_across_days(
                chosen_start, total_duration_min, calendar_config
            )
        )

        for segment_start, segment_end in schedule_segments:
            schedule_data = {
                "tenant_id": tenant_id,
                "order_id": order_id,
                "process_routing_id": routing["id"],
                "equipment_id": best["machine_id"],
                "start_datetime": segment_start.isoformat(),
                "end_datetime": segment_end.isoformat(),
            }

            if not dry_run:
                schedule_repo.create(schedule_data)

            created_schedules.append(schedule_data)

        current_process_start = schedule_segments[-1][1]

    return created_schedules


def _select_best_machine(
    equipment_group_id: int,
    current_process_start: datetime,
    total_duration_sec: float,
    total_duration_min: float,
    tenant_id: str,
    settings_repo: SchedulingSettingsRepository | None,
    product_repo: ProductRepository,
    schedule_repo: ScheduleRepository,
    calendar_config: CalendarConfig | None,
    standalone: bool = False,
) -> dict:
    """設備グループから最も早く完了できる設備を選定してその候補情報を返す。"""
    machine_ids = _get_equipment_ids_by_group(product_repo, equipment_group_id)
    if not machine_ids:
        # 設備グループにメンバーが未登録の場合は設備なし扱いでスケジュール
        actual_start = get_next_available_start_time(
            current_process_start, total_duration_min, calendar_config
        )
        return {
            "machine_id": None,
            "start": actual_start,
            "duration_sec": total_duration_sec,
            "segments": None,
        }

    candidates = []
    for machine_id in machine_ids:
        if standalone:
            # 既存スケジュールを無視: current_process_start からそのまま計算
            actual_start = get_next_available_start_time(
                current_process_start, total_duration_min, calendar_config
            )
            fb_segments = split_work_across_days(
                actual_start, total_duration_min, calendar_config
            )
            candidates.append(
                {
                    "machine_id": machine_id,
                    "start": actual_start,
                    "duration_sec": total_duration_sec,
                    "segments": None,
                    "completion": fb_segments[-1][1],
                }
            )
        else:
            params = _resolve_params(
                machine_id, equipment_group_id, tenant_id, settings_repo, product_repo
            )
            gap_result = _try_gap_fill(
                machine_id=machine_id,
                current_process_start=current_process_start,
                total_duration_min=total_duration_min,
                params=params,
                schedule_repo=schedule_repo,
                calendar_config=calendar_config,
            )
            if gap_result is not None:
                candidates.append(
                    {
                        "machine_id": machine_id,
                        "start": gap_result[0][0],
                        "duration_sec": total_duration_sec,
                        "segments": gap_result,
                        "completion": gap_result[-1][1],
                    }
                )
            else:
                last_end = schedule_repo.get_last_end_time(machine_id)
                base_start = (
                    max(last_end, current_process_start)
                    if last_end
                    else current_process_start
                )
                actual_start = get_next_available_start_time(
                    base_start, total_duration_min, calendar_config
                )
                fb_segments = split_work_across_days(
                    actual_start, total_duration_min, calendar_config
                )
                candidates.append(
                    {
                        "machine_id": machine_id,
                        "start": actual_start,
                        "duration_sec": total_duration_sec,
                        "segments": None,
                        "completion": fb_segments[-1][1],
                    }
                )

    return min(candidates, key=lambda x: x["completion"])  # type: ignore


def _resolve_params(
    machine_id: int,
    group_id: int,
    tenant_id: str,
    settings_repo: SchedulingSettingsRepository | None,
    product_repo: ProductRepository,
) -> SchedulingParams:
    """スケジューリングパラメータを解決する。settings_repo が None の場合はデフォルト値を返す。"""
    if settings_repo is None:
        return SchedulingParams()

    from app.repositories.supa_infra.master.equipment_repo import EquipmentRepository

    equipment_repo: EquipmentRepository = EquipmentRepository(product_repo.client)
    return get_effective_params(
        equipment_id=machine_id,
        group_id=group_id,
        tenant_id=tenant_id,
        settings_repo=settings_repo,
        equipment_repo=equipment_repo,
    )


def _parse_dt(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _build_gaps(
    current_process_start: datetime,
    existing: list[dict],
    guard_minutes: int,
) -> list[tuple[datetime, datetime]]:
    """既存スケジュールとガードタイムから使用可能ギャップリストを構築する。"""
    gaps: list[tuple[datetime, datetime]] = []
    first_start = _parse_dt(existing[0]["start_datetime"])
    gap_end = first_start - timedelta(minutes=guard_minutes)
    if gap_end > current_process_start:
        gaps.append((current_process_start, gap_end))
    for i in range(len(existing) - 1):
        prev_end = _parse_dt(existing[i]["end_datetime"]) + timedelta(
            minutes=guard_minutes
        )
        next_start = _parse_dt(existing[i + 1]["start_datetime"]) - timedelta(
            minutes=guard_minutes
        )
        if next_start > prev_end:
            gaps.append((prev_end, next_start))
    return gaps


def _greedy_fill_gaps(
    gaps: list[tuple[datetime, datetime]],
    total_duration_min: float,
    params: SchedulingParams,
    calendar_config: CalendarConfig | None,
) -> list[tuple[datetime, datetime]] | None:
    """ギャップリストに対して greedy 詰め込みを行う。断片数超過または全量未収容なら None。"""
    all_segments: list[tuple[datetime, datetime]] = []
    remaining = total_duration_min

    for gap_start, gap_end in gaps:
        if remaining <= 0:
            break
        actual_start = get_next_available_start_time(gap_start, 0, calendar_config)
        if actual_start >= gap_end:
            continue
        rough_minutes = (gap_end - actual_start).total_seconds() / 60
        if rough_minutes < params.min_slot_minutes:
            continue
        segs, remaining = split_work_in_window(
            actual_start, gap_end, remaining, calendar_config
        )
        all_segments.extend(segs)
        if len(all_segments) > params.max_fragments:
            return None

    if remaining > 0.01 or not all_segments:
        return None
    return all_segments


def _try_gap_fill(
    machine_id: int,
    current_process_start: datetime,
    total_duration_min: float,
    params: SchedulingParams,
    schedule_repo: ScheduleRepository,
    calendar_config: CalendarConfig | None,
) -> list[tuple[datetime, datetime]] | None:
    """既存スケジュールのギャップに greedy 詰め込みを試みる。

    Returns:
        成功した場合は (start, end) セグメントのリスト。
        断片数超過またはギャップ不足の場合は None（末尾追加へフォールバック）。
    """
    horizon_end = current_process_start + timedelta(days=_GAP_HORIZON_DAYS)
    existing = schedule_repo.get_schedules_by_equipment(
        machine_id, current_process_start, horizon_end
    )
    if not existing:
        return None

    gaps = _build_gaps(current_process_start, existing, params.guard_time_minutes)
    if not gaps:
        return None

    return _greedy_fill_gaps(gaps, total_duration_min, params, calendar_config)


def _get_equipment_ids_by_group(
    product_repo: ProductRepository, group_id: int
) -> list[int]:
    """
    設備グループIDから、所属する設備IDのリストを取得する。
    """
    res = (
        product_repo.client.table("equipment_group_members")
        .select("equipment_id")
        .eq("equipment_group_id", group_id)
        .execute()
    )
    return [row["equipment_id"] for row in res.data] if res.data else []  # type: ignore
