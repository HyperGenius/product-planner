# models/transaction/order_schema.py
from models.common.base_schema import BaseSchema
from typing import Optional


class OrderCreate(BaseSchema):
    """注文を作成するためのスキーマ"""

    order_number: str
    product_id: int
    quantity: int
    deadline_date: Optional[str] = None


class OrderUpdate(BaseSchema):
    """注文を更新するためのスキーマ"""

    order_number: Optional[str] = None
    product_id: Optional[int] = None
    quantity: Optional[int] = None
    deadline_date: Optional[str] = None
