# routers/transaction/production_schedules.py
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_current_user_role,
    get_schedule_repo,
    get_supabase_client,
)
from app.models.transaction.schedule import ProductionScheduleItem, ScheduleUpdate
from app.repositories.supa_infra.transaction.schedule_repo import ScheduleRepository
from app.utils.logger import get_logger
from supabase import Client  # type: ignore

production_schedules_router = APIRouter(
    prefix="/production-schedules", tags=["Transaction (Production Schedules)"]
)

logger = get_logger(__name__)

# スケジュールを直接書き換えられるロール（Issue #581）。承認系と同じく platform_admin を含めず社長に限る。
# 生産管理者のロールができたらここに足す。Frontend `SCHEDULE_EDITOR_ROLES`（types/member.ts）と揃える
_SCHEDULE_EDITOR_ROLES = ("president",)


@production_schedules_router.get("", response_model=list[ProductionScheduleItem])
def get_production_schedules(
    start_date: str = Query(..., description="取得開始日 (ISO8601 / YYYY-MM-DD)"),
    end_date: str = Query(..., description="取得終了日 (ISO8601 / YYYY-MM-DD)"),
    equipment_group_id: int | None = Query(
        None, description="特定の設備グループで絞り込む場合に使用"
    ),
    repo: ScheduleRepository = Depends(get_schedule_repo),
) -> list[dict[str, Any]]:
    """
    指定された期間内の生産スケジュールを取得する。

    受注（顧客名・製品名・数量・納期・注文番号）、工程名・工程順、設備名・設備グループの表示名が
    結合された状態で返される。工程・受注全体の開始〜終了は表示期間外のセグメントも含む（Issue #579）。
    """
    logger.info(
        f"Fetching production schedules from {start_date} to {end_date}"
        f"{f' for equipment_group_id={equipment_group_id}' if equipment_group_id else ''}"
    )
    return repo.get_by_period(start_date, end_date, equipment_group_id)


@production_schedules_router.patch("/{schedule_id}")
def update_production_schedule(
    schedule_id: int,
    schedule_data: ScheduleUpdate,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    repo: ScheduleRepository = Depends(get_schedule_repo),
) -> dict[str, Any]:
    """
    ガントチャートの詳細シートからのスケジュール手動調整（Issue #581）。

    開始・終了日時、担当設備を変更することができます。`_SCHEDULE_EDITOR_ROLES` 以外は 403。
    """
    role = get_current_user_role(tenant_id, user_id, client)
    if role not in _SCHEDULE_EDITOR_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"スケジュールの変更は {'/'.join(_SCHEDULE_EDITOR_ROLES)} のみ操作できます",
        )
    logger.info(f"Updating production schedule {schedule_id}")
    try:
        # exclude_unset=True により、指定されたフィールドのみ更新される
        result = repo.update(schedule_id, schedule_data.model_dump(exclude_unset=True))
        return result
    except ValueError as e:
        # レコードが存在しない、または更新に失敗した場合
        raise HTTPException(status_code=404, detail=str(e)) from None
