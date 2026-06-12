from typing import Any

from app.models.common.scheduling_settings import SchedulingParams
from app.repositories.supa_infra.common.scheduling_settings_repo import (
    SchedulingSettingsRepository,
)
from app.repositories.supa_infra.master.equipment_repo import EquipmentRepository

_DEFAULT_PARAMS = SchedulingParams(
    guard_time_minutes=0,
    min_slot_minutes=0,
    max_fragments=10,
)


def _pick(value: Any, fallback: int) -> int:
    """None でなければ value、そうでなければ fallback を返す。"""
    return int(value) if value is not None else fallback


def get_effective_params(
    equipment_id: int | None,
    group_id: int | None,
    tenant_id: str,
    settings_repo: SchedulingSettingsRepository,
    equipment_repo: EquipmentRepository,
) -> SchedulingParams:
    """設備 > グループ > グローバルの優先度で実効スケジューリングパラメータを解決する。

    各パラメータは独立して解決される（例: guard_time は設備、max_fragments はグループ）。

    Args:
        equipment_id: 対象設備 ID（None = 設備不要工程）
        group_id: 対象設備グループ ID（None = グループ未設定）
        tenant_id: テナント ID
        settings_repo: SchedulingSettingsRepository
        equipment_repo: EquipmentRepository（設備・グループ情報を取得）

    Returns:
        SchedulingParams — 実効値
    """
    # グローバル設定を取得（なければデフォルト値）
    global_row = settings_repo.get(tenant_id)
    global_guard = _pick(
        global_row.get("guard_time_minutes") if global_row else None,
        _DEFAULT_PARAMS.guard_time_minutes,
    )
    global_min_slot = _pick(
        global_row.get("min_slot_minutes") if global_row else None,
        _DEFAULT_PARAMS.min_slot_minutes,
    )
    global_max_frag = _pick(
        global_row.get("max_fragments") if global_row else None,
        _DEFAULT_PARAMS.max_fragments,
    )

    # グループ設定（group_id がある場合）
    group_guard: int | None = None
    group_min_slot: int | None = None
    group_max_frag: int | None = None
    if group_id is not None:
        group_row = equipment_repo.get_group_by_id(group_id)
        if group_row:
            group_guard = group_row.get("guard_time_minutes")
            group_min_slot = group_row.get("min_slot_minutes")
            group_max_frag = group_row.get("max_fragments")

    # 設備設定（equipment_id がある場合）
    equip_guard: int | None = None
    equip_min_slot: int | None = None
    equip_max_frag: int | None = None
    if equipment_id is not None:
        equip_row = equipment_repo.get_by_id(equipment_id)
        if equip_row:
            equip_guard = equip_row.get("guard_time_minutes")
            equip_min_slot = equip_row.get("min_slot_minutes")
            equip_max_frag = equip_row.get("max_fragments")

    # 優先度解決: 設備 > グループ > グローバル
    def resolve(equip_val: int | None, group_val: int | None, global_val: int) -> int:
        if equip_val is not None:
            return int(equip_val)
        if group_val is not None:
            return int(group_val)
        return global_val

    return SchedulingParams(
        guard_time_minutes=resolve(equip_guard, group_guard, global_guard),
        min_slot_minutes=resolve(equip_min_slot, group_min_slot, global_min_slot),
        max_fragments=resolve(equip_max_frag, group_max_frag, global_max_frag),
    )
