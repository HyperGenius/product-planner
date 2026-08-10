from typing import Literal

from pydantic import BaseModel, EmailStr, Field

MemberRole = Literal["president", "iso_officer", "order_handler", "platform_admin"]


class MemberCreateSchema(BaseModel):
    """メンバー追加リクエストのスキーマ"""

    email: EmailStr = Field(description="メールアドレス")
    password: str = Field(min_length=8, description="初期パスワード")
    full_name: str = Field(description="氏名")
    role: MemberRole = Field(default="order_handler", description="権限")


class MemberUpdateSchema(BaseModel):
    """メンバー更新リクエストのスキーマ"""

    full_name: str | None = Field(default=None, description="氏名")
    role: MemberRole | None = Field(default=None, description="権限")


class MemberResponse(BaseModel):
    """メンバー情報レスポンスのスキーマ"""

    user_id: str = Field(description="ユーザーID")
    email: str = Field(description="メールアドレス")
    full_name: str | None = Field(default=None, description="氏名")
    role: str = Field(description="権限")
