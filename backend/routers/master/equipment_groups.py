# routers/master/equipment_groups.py
from dependencies import get_current_tenant_id, get_equipment_repo
from fastapi import APIRouter, Depends, HTTPException
from models.master.equipment_schemas import (
    EquipmentGroupCreate,
    EquipmentGroupUpdate,
)
from repositories.supa_infra.master.equipment_repo import EquipmentRepository
from utils.logger import get_logger

equipment_group_router = APIRouter(
    prefix="/equipment-groups", tags=["Master (Equipment Groups)"]
)

logger = get_logger(__name__)


@equipment_group_router.post("/")
def create_equipment_group(
    group_data: EquipmentGroupCreate,
    tenant_id: str = Depends(get_current_tenant_id),
    repo: EquipmentRepository = Depends(get_equipment_repo),
):
    """設備グループを新規作成"""
    logger.info(f"Creating equipment group {group_data}")
    return repo.create_group(group_data.with_tenant_id(tenant_id))


@equipment_group_router.get("/")
def get_equipment_groups(repo: EquipmentRepository = Depends(get_equipment_repo)):
    """設備グループを全件取得"""
    logger.info("Fetching all equipment groups")
    return repo.get_all_groups()


@equipment_group_router.get("/{group_id}")
def get_equipment_group(
    group_id: int, repo: EquipmentRepository = Depends(get_equipment_repo)
):
    """設備グループを1件取得"""
    logger.info(f"Fetching equipment group {group_id}")
    result = repo.get_group_by_id(group_id)
    if not result:
        raise HTTPException(status_code=404, detail="Not found")
    return result


@equipment_group_router.patch("/{group_id}")
def update_equipment_group(
    group_id: int,
    group_data: EquipmentGroupUpdate,
    repo: EquipmentRepository = Depends(get_equipment_repo),
):
    """設備グループを更新"""
    logger.info(f"Updating equipment group {group_id}")
    result = repo.update_group(group_id, group_data.model_dump(exclude_unset=True))
    if not result:
        raise HTTPException(status_code=404, detail="Not found")
    return result


@equipment_group_router.delete("/{group_id}")
def delete_equipment_group(
    group_id: int, repo: EquipmentRepository = Depends(get_equipment_repo)
):
    """設備グループを削除"""
    logger.info(f"Deleting equipment group {group_id}")
    success = repo.delete_group(group_id)
    if not success:
        raise HTTPException(status_code=404, detail="Not found")
    return {"status": "deleted"}
