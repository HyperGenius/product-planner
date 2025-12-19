# models/master/product.py
from pydantic import BaseModel


class ProductCreateSchema(BaseModel):
    """製品を作成するためのスキーマ"""

    order_id: int


class ProductUpdateSchema(BaseModel):
    """製品を更新するためのスキーマ"""

    order_id: int
