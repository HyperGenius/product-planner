from fastapi import APIRouter, HTTPException, Depends
from repositories.supabase.master.equipment_repo import EquipmentRepository
from models.master.equipment_schemas import (
    EquipmentCreate,
    EquipmentUpdate,
)
from dependencies import get_equipment_repo, get_current_tenant_id
from utils.logger import get_logger

equipment_router = APIRouter(prefix="/equipments", tags=["Master (Equipments)"])

logger = get_logger(__name__)


@equipment_router.post("/")
def create_equipment(
    equipment_data: EquipmentCreate,
    tenant_id: str = Depends(get_current_tenant_id),
    repo: EquipmentRepository = Depends(get_equipment_repo),
):
    """設備を新規作成"""
    logger.info(f"Creating equipment {equipment_data}")
    return repo.create(equipment_data.with_tenant_id(tenant_id))


@equipment_router.get("/")
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
    result = repo.update(equipment_id, equipment_data.model_dump(exclude_unset=True))
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
