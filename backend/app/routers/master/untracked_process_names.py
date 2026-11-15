# routers/master/untracked_process_names.py
"""日報で追わない工程（untracked_process_names）の一覧・登録・解除 API（Issue #681）。

検査など日報に書かない（まだ取り込めていない）工程を工程名の単位（テナント共通）で設定する。設定した工程は
日報の割り付けで進捗の行を作らない（`services/daily_report_allocator.py`）。割り付けの再計算は cron
（`compute-daily-report-progress`）が行い、この API（ユーザー JWT）からは同期で再計算しない（書き込みは
service role のみのため）。次の cron で反映される。

参照はテナントメンバー全員、登録・解除は工程マスタを持つ社長とプラットフォーム管理者に限る。
"""

from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, status
from postgrest.exceptions import APIError

from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_current_user_role,
    get_supabase_client,
)
from app.models.master import (
    UntrackedProcessNameCreateSchema,
    UntrackedProcessNameResponse,
)
from app.repositories.supa_infra.common.table_name import SupabaseTableName
from supabase import Client  # type: ignore

untracked_process_name_router = APIRouter(
    prefix="/untracked-process-names", tags=["Master (Untracked Process Names)"]
)

_TABLE = SupabaseTableName.UNTRACKED_PROCESS_NAMES.value
_COLUMNS = "id, process_name, created_at"

# 登録・解除できるロール。Frontend の UNTRACKED_PROCESS_EDITOR_ROLES（types/member.ts）と揃える
UNTRACKED_PROCESS_EDITOR_ROLES = ("president", "platform_admin")


def _require_editor(tenant_id: str, user_id: str, client: Client) -> None:
    role = get_current_user_role(tenant_id, user_id, client)
    if role not in UNTRACKED_PROCESS_EDITOR_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="日報で追わない工程の設定は社長・プラットフォーム管理者のみ操作できます",
        )


@untracked_process_name_router.get(
    "", response_model=list[UntrackedProcessNameResponse]
)
def list_untracked_process_names(
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
):
    """日報で追わない工程を一覧する（工程名の順）"""
    result = (
        client.table(_TABLE)
        .select(_COLUMNS)
        .eq("tenant_id", tenant_id)
        .order("process_name")
        .execute()
    )
    return cast(list[dict[str, Any]], result.data or [])


@untracked_process_name_router.post(
    "", response_model=UntrackedProcessNameResponse, status_code=status.HTTP_201_CREATED
)
def create_untracked_process_name(
    body: UntrackedProcessNameCreateSchema,
    tenant_id: str = Depends(get_current_tenant_id),
    current_user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    """工程名を日報で追わない工程にする。登録済みなら 409 `duplicate_untracked_process`。"""
    _require_editor(tenant_id, current_user_id, client)
    try:
        result = (
            client.table(_TABLE)
            .insert(
                {
                    "tenant_id": tenant_id,
                    "process_name": body.process_name,
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
                    "error": "duplicate_untracked_process",
                    "message": "この工程は既に日報で追わない工程に設定されています",
                },
            ) from None
        raise
    return cast(list[dict[str, Any]], result.data)[0]


@untracked_process_name_router.delete(
    "/{untracked_process_name_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_untracked_process_name(
    untracked_process_name_id: int,
    tenant_id: str = Depends(get_current_tenant_id),
    current_user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
) -> None:
    """日報で追わない工程の設定を外す（日報の実績を再び割り付ける）"""
    _require_editor(tenant_id, current_user_id, client)
    result = (
        client.table(_TABLE)
        .delete()
        .eq("tenant_id", tenant_id)
        .eq("id", untracked_process_name_id)
        .execute()
    )
    if not cast(list[dict[str, Any]], result.data or []):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="日報で追わない工程が見つかりません",
        )
