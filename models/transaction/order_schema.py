# models/transaction/order_schema.py
from models.common.base_schema import BaseSchema
from uuid import UUID
from typing import Optional


class OrderCreate(BaseSchema):
    """注文を作成するためのスキーマ"""

    tenant_id: UUID
    order_number: str
    product_id: int
    quantity: int
    deadline_date: Optional[str] = None
