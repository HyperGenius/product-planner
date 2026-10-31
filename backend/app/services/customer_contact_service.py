"""顧客の担当者（customer_contacts、Issue #608）の登録・同期。

Gmail 取り込みの顧客突合は customer_contacts.email で行う。customers.email は互換のため残してあり、
顧客の作成・更新 API で email を渡したときは、ここで担当者へ反映する。
"""

from typing import Any, cast

from postgrest.exceptions import APIError

from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.utils.logger import get_logger
from supabase import Client

logger = get_logger(__name__)

_UNIQUE_VIOLATION = "23505"


def normalize_contact_email(email: str) -> str:
    """customer_contacts.email の保存形式（小文字・前後空白なし）に揃える。"""
    return email.strip().lower()


def _normalize(email: str | None) -> str | None:
    """正規化して返す。空なら None。"""
    return normalize_contact_email(email or "") or None


def add_contact(
    db: Client,
    tenant_id: str,
    customer_id: int,
    email: str,
    contact_name: str | None = None,
) -> bool:
    """担当者を登録する。そのアドレスが既に登録済み（同じ顧客も別の顧客も）なら何もしない。

    突合は (tenant_id, email) で一意に決まるため、別の顧客に属するアドレスを付け替えない
    （取り込みの結果を黙って変えない）。登録したら True。
    """
    normalized = _normalize(email)
    if normalized is None:
        return False
    row: dict[str, Any] = {
        "tenant_id": tenant_id,
        "customer_id": customer_id,
        "email": normalized,
    }
    if contact_name:
        row["contact_name"] = contact_name
    try:
        db.table(SupabaseTableName.CUSTOMER_CONTACTS.value).insert(row).execute()
    except APIError as e:
        if e.code != _UNIQUE_VIOLATION:
            raise
        # 並行する取り込みが先に登録した場合も含め、既存の行を優先する
        logger.info(
            f"customer contact already exists: tenant={tenant_id} "
            f"customer={customer_id}"
        )
        return False
    return True


def sync_primary_contact(
    db: Client,
    tenant_id: str,
    customer_id: int,
    old_email: str | None,
    new_email: str | None,
) -> None:
    """customers.email の変更を担当者へ反映する。

    - 旧アドレスがこの顧客の担当者なら外す（顧客の email を書き換えたとき、旧アドレスの
      メールが同じ顧客に解決され続けないようにする）
    - 新アドレスを担当者に加える。別の顧客に登録済みのアドレスは付け替えず、ログだけ残す
    - 変更が無ければ何もしない
    """
    old = _normalize(old_email)
    new = _normalize(new_email)
    if old == new:
        # 移行前から email を持つ顧客に担当者の行が無い場合の補完だけ行う
        if new is not None:
            add_contact(db, tenant_id, customer_id, new)
        return

    table = SupabaseTableName.CUSTOMER_CONTACTS.value
    if old is not None:
        (
            db.table(table)
            .delete()
            .eq("tenant_id", tenant_id)
            .eq("customer_id", customer_id)
            .eq("email", old)
            .execute()
        )
    if new is not None and not add_contact(db, tenant_id, customer_id, new):
        owner = cast(
            list[dict[str, Any]],
            db.table(table)
            .select("customer_id")
            .eq("tenant_id", tenant_id)
            .eq("email", new)
            .limit(1)
            .execute()
            .data
            or [],
        )
        if owner and int(owner[0]["customer_id"]) != customer_id:
            logger.warning(
                f"contact email already belongs to another customer: "
                f"tenant={tenant_id} customer={customer_id} "
                f"owner={owner[0]['customer_id']}"
            )
