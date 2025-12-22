# models/master/process_routings.py
from models.common.base_schema import BaseSchema
from pydantic import Field
from typing import Optional


class RoutingCreate(BaseSchema):
    """製品の工程を新規作成するためのスキーマ"""

    product_id: int = Field(default=..., description="製品ID")
    sequence_order: int = Field(default=..., description="シーケンス番号")
    process_name: str = Field(default=..., description="工程名")
    equipment_group_id: int = Field(default=..., description="設備グループID")
    setup_time_seconds: int = Field(default=0, description="セットアップ時間")
    unit_time_seconds: float = Field(default=0, description="単位時間")
    setup_method_id: Optional[int] = Field(default=None, description="段取り方法ID")


class RoutingUpdate(BaseSchema):
    """製品の工程を更新するためのスキーマ"""

    sequence_order: Optional[int] = Field(default=None, description="シーケンス番号")
    process_name: Optional[str] = Field(default=None, description="工程名")
    equipment_group_id: Optional[int] = Field(
        default=None, description="設備グループID"
    )
    setup_time_seconds: Optional[int] = Field(
        default=None, description="セットアップ時間"
    )
    unit_time_seconds: Optional[float] = Field(default=None, description="単位時間")
    setup_method_id: Optional[int] = Field(default=None, description="段取り方法ID")
