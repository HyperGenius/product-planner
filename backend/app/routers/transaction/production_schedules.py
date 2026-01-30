# routers/transaction/production_schedules.py
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.dependencies import get_schedule_repo
from app.models.transaction.schedule import ScheduleUpdate
from app.repositories.supa_infra.transaction.schedule_repo import ScheduleRepository
from app.utils.logger import get_logger

production_schedules_router = APIRouter(
    prefix="/production-schedules", tags=["Transaction (Production Schedules)"]
)

logger = get_logger(__name__)


@production_schedules_router.get("/")
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

    製品名、工程名、注文番号、設備名などが結合された状態で返される。
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
    repo: ScheduleRepository = Depends(get_schedule_repo),
) -> dict[str, Any]:
    """
    ガントチャート上でのドラッグ&ドロップによるスケジュール手動調整。

    開始・終了日時、担当設備を変更することができます。
    """
    logger.info(f"Updating production schedule {schedule_id}")
    try:
        # exclude_unset=True により、指定されたフィールドのみ更新される
        result = repo.update(schedule_id, schedule_data.model_dump(exclude_unset=True))
        return result
    except ValueError as e:
        # レコードが存在しない、または更新に失敗した場合
        raise HTTPException(status_code=404, detail=str(e)) from None
