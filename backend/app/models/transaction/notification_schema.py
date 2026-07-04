# models/transaction/notification_schema.py

from typing import Any

from pydantic import BaseModel


class NotificationResponse(BaseModel):
    """通知のレスポンススキーマ"""

    id: str
    notif_type: str
    source_table: str
    source_id: str | None
    detail: dict[str, Any] | None
    read_at: str | None
    created_at: str
    link_url: str | None
