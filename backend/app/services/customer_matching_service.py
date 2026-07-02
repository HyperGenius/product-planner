import re
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


def resolve_or_create_customer(db: Client, tenant_id: str, email: str) -> int:
    """
    メールアドレスで顧客を検索し、存在すれば customer_id を返す。
    存在しなければ顧客を自動作成して返す。
    """
    table = SupabaseTableName.CUSTOMERS.value
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
        return int(rows[0]["id"])

    created = (
        db.table(table)
        .insert({"tenant_id": tenant_id, "email": email, "name": email})
        .execute()
    )
    created_rows = cast(list[dict[str, Any]], created.data or [])
    new_id = int(created_rows[0]["id"])
    logger.info(f"customer auto-created: id={new_id} email={email}")
    return new_id
