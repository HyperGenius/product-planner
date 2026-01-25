# models/transaction/order_schema.py

from pydantic import ConfigDict, Field

from app.models.common.base_schema import BaseSchema


class OrderCreate(BaseSchema):
    """注文を作成するためのスキーマ"""

    model_config = ConfigDict(populate_by_name=True)

    order_number: str = Field(..., alias="order_no")
    product_id: int
    quantity: int
    deadline_date: str | None = Field(None, alias="desired_deadline")


class OrderSimulateRequest(BaseSchema):
    """注文シミュレーションのリクエストスキーマ"""

    model_config = ConfigDict(populate_by_name=True)

    product_id: int
    quantity: int
    deadline_date: str | None = Field(None, alias="desired_deadline")


class OrderUpdate(BaseSchema):
    """注文を更新するためのスキーマ"""

    model_config = ConfigDict(populate_by_name=True)

    order_number: str | None = Field(None, alias="order_no")
    product_id: int | None = None
    quantity: int | None = None
    deadline_date: str | None = Field(None, alias="desired_deadline")
