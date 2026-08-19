# models/master/product.py

from pydantic import BaseModel, Field

from app.models.common.base_schema import BaseSchema


# --- Products ---
class ProductBase(BaseSchema):
    """製品のベーススキーマ"""

    name: str = Field(default=..., description="製品名")
    code: str = Field(default=..., description="製品コード")
    type: str = Field(default=..., description="製品種別")
    is_active: bool = Field(default=True, description="有効/無効フラグ")


class ProductCreateSchema(ProductBase):
    """製品を作成するためのスキーマ"""

    pass


class Product(ProductBase):
    """読み取り用製品のスキーマ"""

    id: int
    has_process: bool = Field(
        default=False, description="工程が1件以上登録されているか"
    )


class ProductUpdateSchema(BaseSchema):
    """製品を更新するためのスキーマ"""

    name: str | None = Field(default=None, description="製品名")
    code: str | None = Field(default=None, description="製品コード")
    type: str | None = Field(default=None, description="製品種別")
    is_active: bool | None = Field(default=None, description="有効/無効フラグ")


# --- Product Name Aliases（Issue #347） ---
class ProductNameAliasHistoryResponse(BaseModel):
    """製品名の表記ゆれ修正履歴のレスポンススキーマ

    product_name_alias_history の生データではなく、登録者の表示名・
    トリガーとなった注文情報を解決した集約レスポンスとする。
    """

    id: str
    product_id: int | None
    product_name_snapshot: str
    raw_text: str
    changed_by: str
    changed_by_full_name: str | None
    action: str
    source_order_id: int | None
    source_order_label_snapshot: str
    changed_at: str
