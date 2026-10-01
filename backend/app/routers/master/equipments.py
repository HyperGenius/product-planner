# routers/master/equipments.py
from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import get_current_tenant_id, get_equipment_repo
from app.models.master.equipment_schemas import (
    EquipmentCreate,
    EquipmentUpdate,
)
from app.repositories.supa_infra.common import DuplicateRecordError
from app.repositories.supa_infra.master.equipment_repo import EquipmentRepository
from app.utils.logger import get_logger

equipment_router = APIRouter(prefix="/equipments", tags=["Master (Equipments)"])

logger = get_logger(__name__)


def _duplicate_equipment_conflict(e: DuplicateRecordError) -> HTTPException:
    """設備の一意制約違反を 409 Conflict へ変換する。

    `equipments` の UNIQUE は (tenant_id, name)・(tenant_id, ledger_no)（Issue #486）・
    (tenant_id, short_name) の3本。どれに当たったかは制約名で判別する。レスポンスに生の DB
    制約名・例外文言は載せない（orders の `_duplicate_order_conflict_exception()` と同方針）。
    """
    if e.constraint and "ledger_no" in e.constraint:
        return HTTPException(
            status_code=409,
            detail={
                "error": "duplicate_ledger_no",
                "message": "同じ台帳番号の設備が既に登録されています",
            },
        )
    if e.constraint and "short_name" in e.constraint:
        return HTTPException(
            status_code=409,
            detail={
                "error": "duplicate_short_name",
                "message": "同じ呼称の設備が既に登録されています",
            },
        )
    return HTTPException(
        status_code=409,
        detail={
            "error": "duplicate_equipment_name",
            "message": "同じ名前の設備が既に登録されています",
        },
    )


@equipment_router.post("")
def create_equipment(
    equipment_data: EquipmentCreate,
    tenant_id: str = Depends(get_current_tenant_id),
    repo: EquipmentRepository = Depends(get_equipment_repo),
):
    """設備を新規作成"""
    logger.info(f"Creating equipment {equipment_data}")
    try:
        return repo.create(equipment_data.with_tenant_id(tenant_id))
    except DuplicateRecordError as e:
        raise _duplicate_equipment_conflict(e) from e


@equipment_router.get("")
def get_equipments(repo: EquipmentRepository = Depends(get_equipment_repo)):
    """設備を全件取得"""
    logger.info("Fetching all equipments")
    return repo.get_all()


@equipment_router.get("/{equipment_id}")
def get_equipment(
    equipment_id: int, repo: EquipmentRepository = Depends(get_equipment_repo)
):
    """設備を1件取得"""
    logger.info(f"Fetching equipment {equipment_id}")
    result = repo.get_by_id(equipment_id)
    if not result:
        raise HTTPException(status_code=404, detail="Not found")
    return result


@equipment_router.patch("/{equipment_id}")
def update_equipment(
    equipment_id: int,
    equipment_data: EquipmentUpdate,
    repo: EquipmentRepository = Depends(get_equipment_repo),
):
    """設備を更新"""
    logger.info(f"Updating equipment {equipment_id}")
    try:
        result = repo.update(
            equipment_id, equipment_data.model_dump(exclude_unset=True)
        )
    except DuplicateRecordError as e:
        raise _duplicate_equipment_conflict(e) from e
    if not result:
        raise HTTPException(status_code=404, detail="Not found")
    return result


@equipment_router.delete("/{equipment_id}")
def delete_equipment(
    equipment_id: int, repo: EquipmentRepository = Depends(get_equipment_repo)
):
    """設備を削除"""
    logger.info(f"Deleting equipment {equipment_id}")
    success = repo.delete(equipment_id)
    if not success:
        raise HTTPException(status_code=404, detail="Not found")
    return {"status": "deleted"}
