# models/master/customer_contact_schemas.py
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator


class CustomerContactCreateSchema(BaseModel):
    """顧客の担当者の登録リクエスト（Issue #611）"""

    email: EmailStr = Field(description="担当者のメールアドレス")
    contact_name: str | None = Field(
        default=None, description="担当者の登録名（任意。一覧での見分けに使う）"
    )

    @field_validator("contact_name")
    @classmethod
    def _blank_to_none(cls, value: str | None) -> str | None:
        """前後の空白を除き、空なら未設定（NULL）にする。"""
        return (value or "").strip() or None


class CustomerContactResponse(BaseModel):
    """顧客の担当者"""

    id: UUID
    customer_id: int
    email: str
    contact_name: str | None = None
    created_at: datetime
