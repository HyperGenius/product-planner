# models/master/product.py

from pydantic import BaseModel, Field

from app.models.common.base_schema import BaseSchema


# --- Products ---
class ProductBase(BaseSchema):
    """製品のベーススキーマ"""

    name: str = Field(default=..., min_length=1, description="品名（ズメーンの品名）")
    is_active: bool = Field(default=True, description="有効/無効フラグ")


class ProductCreateSchema(ProductBase):
    """製品を作成するためのスキーマ。作成時は図番（code）を必須とする。"""

    code: str = Field(
        default=...,
        min_length=1,
        description="図番（ズメーンの図番。テナント内で一意）",
    )


class Product(ProductBase):
    """読み取り用製品のスキーマ。

    未突合・未移行テナントの既存行は code が NULL のため nullable とする
    （実データ・フロント型・[docs/features/product-master.md](../../../../docs/features/product-master.md) と整合）。
    """

    id: int
    code: str | None = Field(
        default=None, description="図番（未突合・未移行の行は NULL）"
    )
    has_process: bool = Field(
        default=False, description="工程が1件以上登録されているか"
    )


class ProductUpdateSchema(BaseSchema):
    """製品を更新するためのスキーマ。

    `code` は `None` を送ると図番をクリア（DB 上 NULL）できる。ただし空文字は不可
    （`min_length=1`）。空文字は `UNIQUE(tenant_id, code)` 衝突の原因になりやすいため、
    フロントも空欄は `null` で送る。
    """

    name: str | None = Field(
        default=None, min_length=1, description="品名（ズメーンの品名）"
    )
    code: str | None = Field(
        default=None,
        min_length=1,
        description="図番（ズメーンの図番。テナント内で一意）。null でクリア",
    )
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
    # どの顧客の別名かを画面で区別できるようにする（Issue #349）。顧客削除後も
    # 履歴の文脈が読めるよう、customer_id は SET NULL・名前はスナップショットを返す。
    customer_id: int | None
    customer_name_snapshot: str
    raw_text: str
    changed_by: str
    changed_by_full_name: str | None
    action: str
    source_order_id: int | None
    source_order_label_snapshot: str
    changed_at: str
