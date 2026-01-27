# routers/transaction/production_schedules.py
from fastapi import APIRouter, Depends, Query

from app.dependencies import get_schedule_repo
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
):
    """
    指定された期間内の生産スケジュールを取得する。

    製品名、工程名、注文番号、設備名などが結合された状態で返される。
    """
    logger.info(
        f"Fetching production schedules from {start_date} to {end_date}"
        f"{f' for equipment_group_id={equipment_group_id}' if equipment_group_id else ''}"
    )
    return repo.get_by_period(start_date, end_date, equipment_group_id)
