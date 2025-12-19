# models/master/equipment_schemas.py
from models.common.base_schema import BaseSchema
from typing import Optional, List
from uuid import UUID


# --- Equipment Groups ---
class EquipmentGroupCreate(BaseSchema):
    """設備グループを作成するためのスキーマ"""

    tenant_id: UUID
    name: str


class EquipmentGroupUpdate(BaseSchema):
    """設備グループを更新するためのスキーマ"""

    name: Optional[str] = None


# --- Equipments ---
class EquipmentCreate(BaseSchema):
    """設備を作成するためのスキーマ"""

    tenant_id: UUID
    name: str
    # 所属グループIDリストを受け取るなど、UIに合わせて調整
    group_ids: List[int] = []


class EquipmentUpdate(BaseSchema):
    """設備を更新するためのスキーマ"""

    name: Optional[str] = None
