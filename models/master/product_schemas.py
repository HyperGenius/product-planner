# models/master/product.py
from models.common.base_schema import BaseSchema
from pydantic import Field
from typing import Optional
from uuid import UUID


class ProductCreateSchema(BaseSchema):
    """製品を作成するためのスキーマ"""

    name: str = Field(default=..., description="製品名")
    code: str = Field(default=..., description="製品コード")
    tenant_id: UUID = Field(default=..., description="テナントID")
    type: str = Field(default=..., description="製品種別")


class ProductUpdateSchema(BaseSchema):
    """製品を更新するためのスキーマ"""

    name: Optional[str] = Field(default=None, description="製品名")
    code: Optional[str] = Field(default=None, description="製品コード")
    type: Optional[str] = Field(default=None, description="製品種別")


# --- Process Routings ---
class RoutingCreate(BaseSchema):
    """製品の工程を新規作成するためのスキーマ"""

    tenant_id: UUID = Field(default=..., description="テナントID")
    product_id: int = Field(default=..., description="製品ID")
    sequence_order: int = Field(default=..., description="シーケンス番号")
    process_name: str = Field(default=..., description="工程名")
    equipment_group_id: int = Field(default=..., description="設備グループID")
    setup_time_seconds: int = Field(default=0, description="セットアップ時間")
    unit_time_seconds: float = Field(default=0, description="単位時間")
