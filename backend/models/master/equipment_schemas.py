# models/master/equipment_schemas.py

from pydantic import Field

from models.common.base_schema import BaseSchema


# --- Equipment Groups ---
class EquipmentGroupBase(BaseSchema):
    """設備グループのベーススキーマ"""

    name: str = Field(default=..., description="設備グループ名")


class EquipmentGroupCreate(EquipmentGroupBase):
    """設備グループを作成するためのスキーマ"""

    pass


class EquipmentGroupUpdate(EquipmentGroupBase):
    """設備グループを更新するためのスキーマ"""

    pass


# --- Equipments ---
class EquipmentBase(BaseSchema):
    """設備のベーススキーマ"""

    name: str = Field(default=..., description="設備名")


class EquipmentCreate(EquipmentBase):
    """設備を作成するためのスキーマ"""

    pass


class EquipmentUpdate(EquipmentBase):
    """設備を更新するためのスキーマ"""

    pass


# --- Equipment Group Members ---
class EquipmentGroupMembersBase(BaseSchema):
    """設備グループメンバーのスキーマ"""

    equipment_group_id: int = Field(default=..., description="設備グループID")
    equipment_id: int = Field(default=..., description="設備ID")


class EquipmentGroupMembersCreate(EquipmentGroupMembersBase):
    """設備グループメンバーを作成するためのスキーマ"""

    pass


class EquipmentGroupMembers(EquipmentGroupMembersBase):
    """読み取り用 (Response)"""

    id: int  # DBのID


# 中間テーブルにおいてUpdateは定義しない
# 古い紐付けを DELETE して新しい紐付けを INSERT する
