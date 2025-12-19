# models/master/product.py
from models.common.base_schema import BaseSchema
from uuid import UUID


class ProductCreateSchema(BaseSchema):
    """製品を作成するためのスキーマ"""

    order_id: int


class ProductUpdateSchema(BaseSchema):
    """製品を更新するためのスキーマ"""

    order_id: int


# --- Process Routings ---
class RoutingCreate(BaseSchema):
    tenant_id: UUID
    product_id: int
    sequence_order: int
    process_name: str
    equipment_group_id: int
    setup_time_seconds: int = 0
    unit_time_seconds: float
