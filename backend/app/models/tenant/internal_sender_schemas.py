from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


class InternalSenderCreateSchema(BaseModel):
    """社内転送者の登録リクエスト（Issue #521）"""

    email: EmailStr = Field(description="社内転送者のメールアドレス")


class InternalSenderResponse(BaseModel):
    """社内転送者（受注書を取り込み用アドレスへ転送する社内のアドレス）"""

    id: UUID
    email: str
    created_at: datetime
