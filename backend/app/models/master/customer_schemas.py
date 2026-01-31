# models/master/customer_schemas.py

from pydantic import Field

from app.models.common.base_schema import BaseSchema


# --- Customers ---
class CustomerBase(BaseSchema):
    """顧客のベーススキーマ"""

    name: str = Field(default=..., description="顧客名")
    alias: str | None = Field(default=None, description="通称（画面表示用）")
    representative_name: str | None = Field(default=None, description="代表者名")
    phone_number: str | None = Field(default=None, description="電話番号")
    email: str | None = Field(default=None, description="メールアドレス")


class CustomerCreateSchema(CustomerBase):
    """顧客を作成するためのスキーマ"""

    pass


class Customer(CustomerBase):
    """読み取り用顧客のスキーマ"""

    id: int


class CustomerUpdateSchema(BaseSchema):
    """顧客を更新するためのスキーマ"""

    name: str | None = Field(default=None, description="顧客名")
    alias: str | None = Field(default=None, description="通称（画面表示用）")
    representative_name: str | None = Field(default=None, description="代表者名")
    phone_number: str | None = Field(default=None, description="電話番号")
    email: str | None = Field(default=None, description="メールアドレス")
