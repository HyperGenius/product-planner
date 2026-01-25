# models/transaction/order_schema.py

from app.models.common.base_schema import BaseSchema


class OrderCreate(BaseSchema):
    """注文を作成するためのスキーマ"""

    order_number: str
    product_id: int
    quantity: int
    deadline_date: str | None = None


class OrderSimulateRequest(BaseSchema):
    """注文シミュレーションのリクエストスキーマ"""

    product_id: int
    quantity: int
    deadline_date: str | None = None


class OrderUpdate(BaseSchema):
    """注文を更新するためのスキーマ"""

    order_number: str | None = None
    product_id: int | None = None
    quantity: int | None = None
    deadline_date: str | None = None
