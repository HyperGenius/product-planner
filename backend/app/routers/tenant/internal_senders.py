"""社内転送者の管理 API（Issue #521）。

社長（社内の共通メールアカウント）など、注文書を受注取り込み用アドレスへ転送してくる
社内のアドレスを登録する。登録したアドレスからのメールは、Gmail 取り込みで差出人による
顧客の突合・下書き顧客の作成を行わない（`customer_matching_service.resolve_or_create_customer`）。
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
from app.models.tenant import InternalSenderCreateSchema, InternalSenderResponse
from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.utils.logger import get_logger
from supabase import Client  # type: ignore

internal_sender_router = APIRouter(
    prefix="/tenant/internal-senders", tags=["Tenant (Internal Senders)"]
)

logger = get_logger(__name__)

_TABLE = SupabaseTableName.TENANT_INTERNAL_SENDERS.value

# 社内転送者を管理できるロール。メンバー管理と同じ（Frontend の
# INTERNAL_SENDER_ADMIN_ROLES と揃える）
_INTERNAL_SENDER_ADMIN_ROLES = ("president", "platform_admin")


def _require_internal_sender_admin(
    tenant_id: str, user_id: str, client: Client
) -> None:
    role = get_current_user_role(tenant_id, user_id, client)
    if role not in _INTERNAL_SENDER_ADMIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="この操作には president または platform_admin 権限が必要です",
        )


@internal_sender_router.get("", response_model=list[InternalSenderResponse])
def list_internal_senders(
    tenant_id: str = Depends(get_current_tenant_id),
    current_user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    """社内転送者の一覧（president / platform_admin のみ）"""
    _require_internal_sender_admin(tenant_id, current_user_id, client)
    result = (
        client.table(_TABLE)
        .select("id, email, created_at")
        .eq("tenant_id", tenant_id)
        .order("email")
        .execute()
    )
    return cast(list[dict[str, Any]], result.data or [])


@internal_sender_router.post(
    "", response_model=InternalSenderResponse, status_code=status.HTTP_201_CREATED
)
def create_internal_sender(
    body: InternalSenderCreateSchema,
    tenant_id: str = Depends(get_current_tenant_id),
    current_user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    """社内転送者を登録する（president / platform_admin のみ）。

    メールアドレスは小文字で保存する（Gmail の From ヘッダーと大文字小文字を無視して
    比較するため。DB の CHECK も小文字・前後空白なしを要求する）。
    """
    _require_internal_sender_admin(tenant_id, current_user_id, client)
    try:
        result = (
            client.table(_TABLE)
            .insert(
                {
                    "tenant_id": tenant_id,
                    "email": str(body.email).strip().lower(),
                    "created_by": current_user_id,
                }
            )
            .execute()
        )
    except APIError as e:
        if e.code == "23505":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": "duplicate_internal_sender",
                    "message": "このメールアドレスは既に登録されています",
                },
            ) from e
        raise
    return cast(list[dict[str, Any]], result.data)[0]


@internal_sender_router.delete("/{sender_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_internal_sender(
    sender_id: UUID,
    tenant_id: str = Depends(get_current_tenant_id),
    current_user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
) -> None:
    """社内転送者の登録を解除する（president / platform_admin のみ）"""
    _require_internal_sender_admin(tenant_id, current_user_id, client)
    result = (
        client.table(_TABLE)
        .delete()
        .eq("tenant_id", tenant_id)
        .eq("id", str(sender_id))
        .execute()
    )
    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="社内転送者が見つかりません",
        )
