# models/master/equipment_schemas.py

from pydantic import Field

from app.models.common.base_schema import BaseSchema


# --- Equipment Groups ---
class EquipmentGroupBase(BaseSchema):
    """設備グループのベーススキーマ"""

    name: str = Field(default=..., description="設備グループ名")
    guard_time_minutes: int | None = Field(
        None, ge=0, description="ガードタイム（分）。NULL=グローバル設定を継承"
    )
    min_slot_minutes: int | None = Field(
        None, ge=0, description="最低時間スロット（分）。NULL=グローバル設定を継承"
    )
    max_fragments: int | None = Field(
        None, ge=1, description="最大断片数。NULL=グローバル設定を継承"
    )


class EquipmentGroupResponse(EquipmentGroupBase):
    """設備グループのレスポンススキーマ"""

    id: int
    tenant_id: str
    member_names: list[str] = Field(default_factory=list)
    member_count: int = Field(default=0)


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
    guard_time_minutes: int | None = Field(
        None, ge=0, description="ガードタイム（分）。NULL=グループ/グローバル設定を継承"
    )
    min_slot_minutes: int | None = Field(
        None,
        ge=0,
        description="最低時間スロット（分）。NULL=グループ/グローバル設定を継承",
    )
    max_fragments: int | None = Field(
        None, ge=1, description="最大断片数。NULL=グループ/グローバル設定を継承"
    )
    # --- 設備台帳（顧客の正典）の情報 (Issue #486) ---
    ledger_no: int | None = Field(
        None,
        ge=1,
        description="設備台帳の番号（テナント内で一意）。台帳に無い設備は NULL",
    )
    maker: str | None = Field(None, description="メーカー")
    model: str | None = Field(None, description="型式")
    manufactured_on: str | None = Field(
        None, description="製造年月（台帳の表記のまま。例: 1993年5月 / S.53年11月）"
    )
    serial_no: str | None = Field(None, description="製造番号")
    note: str | None = Field(None, description="備考")


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


class EquipmentGroupMemberAdd(BaseSchema):
    """設備グループに設備を追加するためのスキーマ（URLパスからgroup_idを取得するため）"""

    equipment_id: int = Field(default=..., description="設備ID")


class EquipmentGroupMembers(EquipmentGroupMembersBase):
    """読み取り用 (Response)"""

    id: int  # DBのID


# 中間テーブルにおいてUpdateは定義しない
# 古い紐付けを DELETE して新しい紐付けを INSERT する
