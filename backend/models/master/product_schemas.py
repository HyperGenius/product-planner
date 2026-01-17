# models/master/product.py

from pydantic import Field

from models.common.base_schema import BaseSchema


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

    name: str | None = Field(default=None, description="製品名")
    code: str | None = Field(default=None, description="製品コード")
    type: str | None = Field(default=None, description="製品種別")
