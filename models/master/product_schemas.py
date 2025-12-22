# models/master/product.py
from models.common.base_schema import BaseSchema
from pydantic import Field
from typing import Optional


# --- Products ---
class ProductBase(BaseSchema):
    """製品のベーススキーマ"""

    name: str = Field(default=..., description="製品名")
    code: str = Field(default=..., description="製品コード")
    type: str = Field(default=..., description="製品種別")


class ProductCreateSchema(ProductBase):
    """製品を作成するためのスキーマ"""

    pass


class Product(ProductBase):
    """読み取り用製品のスキーマ"""

    id: int


class ProductUpdateSchema(BaseSchema):
    """製品を更新するためのスキーマ"""

    name: Optional[str] = Field(default=None, description="製品名")
    code: Optional[str] = Field(default=None, description="製品コード")
    type: Optional[str] = Field(default=None, description="製品種別")
