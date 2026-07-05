import re
from datetime import datetime
from typing import Any, cast

from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.utils.logger import get_logger
from supabase import Client

logger = get_logger(__name__)

# Matches forwarded message headers in both English and Japanese:
#   "From: Name <addr@example.com>"  or  "差出人: addr@example.com"
_FORWARDED_EMAIL_RE = re.compile(
    r"(?:From|差出人)\s*:.*?([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})",
    re.IGNORECASE,
)


def extract_sender_email(body: str) -> str | None:
    m = _FORWARDED_EMAIL_RE.search(body)
    return m.group(1) if m else None


def _placeholder_customer_name(received_at: str | int | None) -> str:
    """メールの受信日時（Gmail internalDate、epoch millis）から仮の顧客名を組み立てる。"""
    dt = datetime.now()
    if received_at is not None:
        try:
            dt = datetime.fromtimestamp(int(received_at) / 1000)
        except (ValueError, TypeError, OSError):
            pass
    return f"不明な顧客 ({dt.strftime('%Y-%m-%d %H:%M')})"


def resolve_or_create_customer(
    db: Client,
    tenant_id: str,
    email: str | None,
    received_at: str | int | None = None,
) -> tuple[int, bool]:
    """
    メールアドレスで顧客を検索し、存在すれば customer_id を返す（status は変更しない）。
    存在しなければ status='draft' の下書き顧客を自動作成して返す。
    email が None の場合は既存顧客と紐付けようがないため、常に新規の下書き顧客を作成する
    （name は受信日時ベースのプレースホルダー）。

    Returns: (customer_id, 新規に下書き作成したかどうか)
    """
    table = SupabaseTableName.CUSTOMERS.value

    if email:
        result = (
            db.table(table)
            .select("id")
            .eq("tenant_id", tenant_id)
            .eq("email", email)
            .limit(1)
            .execute()
        )
        rows = cast(list[dict[str, Any]], result.data or [])
        if rows:
            logger.info(f"customer found: id={rows[0]['id']} email={email}")
            return int(rows[0]["id"]), False

    insert_row: dict[str, Any] = {
        "tenant_id": tenant_id,
        "name": email if email else _placeholder_customer_name(received_at),
        "status": "draft",
    }
    if email:
        insert_row["email"] = email

    created = db.table(table).insert(insert_row).execute()
    created_rows = cast(list[dict[str, Any]], created.data or [])
    new_id = int(created_rows[0]["id"])
    logger.info(f"draft customer auto-created: id={new_id} email={email}")
    return new_id, True
