# routers/master/customer_contacts.py
"""顧客の担当者（customer_contacts）の一覧・追加・削除 API（Issue #611）。

Gmail 取り込みの顧客突合は customer_contacts.email で行う（Issue #608）。参照はテナントメンバー全員、
追加・削除は取り込みの突合結果を変えるので事務担当者（order_handler / president / platform_admin）に限る。
"""

from typing import Any, cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from postgrest.exceptions import APIError

from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_current_user_role,
    get_supabase_client,
)
from app.models.master import CustomerContactCreateSchema, CustomerContactResponse
from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.services.customer_contact_service import normalize_contact_email
from app.utils.logger import get_logger
from supabase import Client  # type: ignore

customer_contact_router = APIRouter(
    prefix="/customers/{customer_id}/contacts", tags=["Master (Customer Contacts)"]
)

logger = get_logger(__name__)

_TABLE = SupabaseTableName.CUSTOMER_CONTACTS.value
_COLUMNS = "id, customer_id, email, contact_name, created_at"

# 担当者を追加・削除できるロール。Frontend の CUSTOMER_CONTACT_EDITOR_ROLES（types/member.ts）と揃える
_CONTACT_EDITOR_ROLES = ("order_handler", "president", "platform_admin")


def _require_contact_editor(tenant_id: str, user_id: str, client: Client) -> None:
    role = get_current_user_role(tenant_id, user_id, client)
    if role not in _CONTACT_EDITOR_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"担当者の編集は {'/'.join(_CONTACT_EDITOR_ROLES)} のみ操作できます",
        )


def _get_customer(client: Client, tenant_id: str, customer_id: int) -> dict[str, Any]:
    """このテナントの顧客を返す。無ければ 404（他テナントの顧客を指させない）。"""
    rows = cast(
        list[dict[str, Any]],
        client.table(SupabaseTableName.CUSTOMERS.value)
        .select("id, name, email")
        .eq("tenant_id", tenant_id)
        .eq("id", customer_id)
        .limit(1)
        .execute()
        .data
        or [],
    )
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="顧客が見つかりません"
        )
    return rows[0]


def _duplicate_email_exception(
    client: Client, tenant_id: str, email: str, customer_id: int
) -> HTTPException:
    """重複したアドレスの登録先の顧客名を添えた 409 を作る。"""
    owner_id: int | None = None
    owner_name: str | None = None
    owners = cast(
        list[dict[str, Any]],
        client.table(_TABLE)
        .select("customer_id")
        .eq("tenant_id", tenant_id)
        .eq("email", email)
        .limit(1)
        .execute()
        .data
        or [],
    )
    if owners:
        owner_id = int(owners[0]["customer_id"])
        customers = cast(
            list[dict[str, Any]],
            client.table(SupabaseTableName.CUSTOMERS.value)
            .select("name")
            .eq("tenant_id", tenant_id)
            .eq("id", owner_id)
            .limit(1)
            .execute()
            .data
            or [],
        )
        owner_name = customers[0]["name"] if customers else None
    same_customer = owner_id == customer_id
    if owner_name is None:
        message = "このメールアドレスは既に登録されています"
    elif same_customer:
        message = "このメールアドレスはこの顧客に既に登録されています"
    else:
        message = f"このメールアドレスは「{owner_name}」に登録済みです"
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "error": "duplicate_contact_email",
            "message": message,
            "conflicting_customer": (
                {"id": owner_id, "name": owner_name}
                if owner_id is not None and owner_name is not None
                else None
            ),
        },
    )


@customer_contact_router.get("", response_model=list[CustomerContactResponse])
def list_customer_contacts(
    customer_id: int,
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
):
    """顧客の担当者を一覧する（テナントメンバー全員）"""
    _get_customer(client, tenant_id, customer_id)
    result = (
        client.table(_TABLE)
        .select(_COLUMNS)
        .eq("tenant_id", tenant_id)
        .eq("customer_id", customer_id)
        .order("created_at")
        .execute()
    )
    return cast(list[dict[str, Any]], result.data or [])


@customer_contact_router.post(
    "", response_model=CustomerContactResponse, status_code=status.HTTP_201_CREATED
)
def create_customer_contact(
    customer_id: int,
    body: CustomerContactCreateSchema,
    tenant_id: str = Depends(get_current_tenant_id),
    current_user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    """担当者を追加する。

    アドレスは小文字・前後空白なしで保存する。別の顧客（同じ顧客を含む）に登録済みなら、
    付け替えずに 409 `duplicate_contact_email` で登録先の顧客名を返す。
    """
    _require_contact_editor(tenant_id, current_user_id, client)
    _get_customer(client, tenant_id, customer_id)
    email = normalize_contact_email(str(body.email))
    row: dict[str, Any] = {
        "tenant_id": tenant_id,
        "customer_id": customer_id,
        "email": email,
    }
    if body.contact_name:
        row["contact_name"] = body.contact_name
    try:
        result = client.table(_TABLE).insert(row).execute()
    except APIError as e:
        if e.code == "23505":
            raise _duplicate_email_exception(
                client, tenant_id, email, customer_id
            ) from None
        raise
    return cast(list[dict[str, Any]], result.data)[0]


@customer_contact_router.delete("/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_customer_contact(
    customer_id: int,
    contact_id: UUID,
    tenant_id: str = Depends(get_current_tenant_id),
    current_user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
) -> None:
    """担当者を削除する。

    顧客の `email`（主たる担当者）と同じアドレスなら `email` も空にする。残すと、顧客を
    編集して保存したときに `sync_primary_contact()` が担当者を登録し直してしまう。
    """
    _require_contact_editor(tenant_id, current_user_id, client)
    customer = _get_customer(client, tenant_id, customer_id)
    result = (
        client.table(_TABLE)
        .delete()
        .eq("tenant_id", tenant_id)
        .eq("customer_id", customer_id)
        .eq("id", str(contact_id))
        .execute()
    )
    deleted = cast(list[dict[str, Any]], result.data or [])
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="担当者が見つかりません"
        )
    primary = customer.get("email")
    if primary and normalize_contact_email(primary) == deleted[0]["email"]:
        (
            client.table(SupabaseTableName.CUSTOMERS.value)
            .update({"email": None})
            .eq("tenant_id", tenant_id)
            .eq("id", customer_id)
            .execute()
        )
