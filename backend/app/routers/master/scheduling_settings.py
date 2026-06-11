from typing import Any

from fastapi import APIRouter, Depends

from app.dependencies import get_current_tenant_id, get_supabase_client
from app.models.common.scheduling_settings import (
    SchedulingSettings,
    SchedulingSettingsUpdate,
)
from app.repositories.supa_infra.common.scheduling_settings_repo import (
    SchedulingSettingsRepository,
)
from app.utils.logger import get_logger
from supabase import Client

logger = get_logger(__name__)

scheduling_settings_router = APIRouter(
    prefix="/scheduling-settings",
    tags=["Master (Scheduling Settings)"],
)

_DEFAULTS = SchedulingSettings(
    guard_time_minutes=0,
    min_slot_minutes=0,
    max_fragments=10,
)


def get_settings_repo(
    client: Client = Depends(get_supabase_client),
) -> SchedulingSettingsRepository:
    return SchedulingSettingsRepository(client)


@scheduling_settings_router.get("/")
def get_scheduling_settings(
    tenant_id: str = Depends(get_current_tenant_id),
    repo: SchedulingSettingsRepository = Depends(get_settings_repo),
) -> dict[str, Any]:
    """テナントのグローバルスケジューリング設定を取得する。未設定の場合はデフォルト値を返す。"""
    logger.info(f"Fetching scheduling settings for tenant {tenant_id}")
    row = repo.get(tenant_id)
    if row:
        return row
    return {
        "tenant_id": tenant_id,
        "guard_time_minutes": _DEFAULTS.guard_time_minutes,
        "min_slot_minutes": _DEFAULTS.min_slot_minutes,
        "max_fragments": _DEFAULTS.max_fragments,
    }


@scheduling_settings_router.put("/")
def upsert_scheduling_settings(
    data: SchedulingSettingsUpdate,
    tenant_id: str = Depends(get_current_tenant_id),
    repo: SchedulingSettingsRepository = Depends(get_settings_repo),
) -> dict[str, Any]:
    """テナントのグローバルスケジューリング設定を作成または更新する。"""
    logger.info(f"Upserting scheduling settings for tenant {tenant_id}")

    # 現在値を取得してマージ（部分更新対応）
    current = repo.get(tenant_id)
    payload: dict[str, Any] = {
        "guard_time_minutes": current.get(
            "guard_time_minutes", _DEFAULTS.guard_time_minutes
        )
        if current
        else _DEFAULTS.guard_time_minutes,
        "min_slot_minutes": current.get("min_slot_minutes", _DEFAULTS.min_slot_minutes)
        if current
        else _DEFAULTS.min_slot_minutes,
        "max_fragments": current.get("max_fragments", _DEFAULTS.max_fragments)
        if current
        else _DEFAULTS.max_fragments,
    }

    update = data.model_dump(exclude_none=True)
    payload.update(update)

    return repo.upsert(tenant_id, payload)
