from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_supabase_admin_client,
    get_supabase_client,
)
from app.models.tenant import MemberCreateSchema, MemberResponse, MemberUpdateSchema
from app.utils.logger import get_logger
from supabase import Client  # type: ignore

member_router = APIRouter(prefix="/tenant/members", tags=["Tenant (Members)"])

logger = get_logger(__name__)


def _require_president(
    current_user_id: str,
    tenant_id: str,
    client: Client,
) -> None:
    """現在のユーザーが対象テナントの president であることを検証する。

    メンバー管理(メンバー一覧の閲覧・追加・変更・削除)は president 限定の操作。
    """
    res = (
        client.table("organization_members")
        .select("role")
        .eq("user_id", current_user_id)
        .eq("tenant_id", tenant_id)
        .single()
        .execute()
    )
    if not res.data or cast(dict[str, Any], res.data).get("role") != "president":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="この操作には president 権限が必要です",
        )


@member_router.get("", response_model=list[MemberResponse])
def list_members(
    tenant_id: str = Depends(get_current_tenant_id),
    current_user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    admin_client: Client = Depends(get_supabase_admin_client),
):
    """テナントのメンバー一覧を取得する（president のみ）"""
    _require_president(current_user_id, tenant_id, client)

    members_res = (
        admin_client.table("organization_members")
        .select("user_id, role")
        .eq("tenant_id", tenant_id)
        .execute()
    )

    rows: list[dict[str, Any]] = cast(list[dict[str, Any]], members_res.data or [])
    user_ids = [row["user_id"] for row in rows]

    profiles_map: dict[str, Any] = {}
    if user_ids:
        profiles_res = (
            admin_client.table("profiles")
            .select("id, full_name, email")
            .in_("id", user_ids)
            .execute()
        )
        profiles_map = {
            p["id"]: p for p in cast(list[dict[str, Any]], profiles_res.data or [])
        }

    members: list[MemberResponse] = []
    for row in rows:
        profile = profiles_map.get(row["user_id"], {})
        members.append(
            MemberResponse(
                user_id=row["user_id"],
                email=profile.get("email", ""),
                full_name=profile.get("full_name"),
                role=row["role"],
            )
        )
    return members


@member_router.post(
    "", response_model=MemberResponse, status_code=status.HTTP_201_CREATED
)
def create_member(
    data: MemberCreateSchema,
    tenant_id: str = Depends(get_current_tenant_id),
    current_user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    admin_client: Client = Depends(get_supabase_admin_client),
):
    """新規メンバーをアカウント発行して追加する（president のみ）"""
    _require_president(current_user_id, tenant_id, client)

    # Supabase Admin API でユーザーを作成
    try:
        create_res = admin_client.auth.admin.create_user(
            {
                "email": data.email,
                "password": data.password,
                "email_confirm": True,
            }
        )
    except Exception as e:
        error_msg = str(e)
        if (
            "already registered" in error_msg
            or "duplicate" in error_msg.lower()
            or "23505" in error_msg
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="このメールアドレスはすでに登録されています",
            ) from e
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"ユーザー作成に失敗しました: {error_msg}",
        ) from e

    new_user = create_res.user
    if not new_user:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ユーザー作成に失敗しました",
        )

    new_user_id = str(new_user.id)

    # profiles に氏名とメールアドレスを登録
    admin_client.table("profiles").upsert(
        {"id": new_user_id, "full_name": data.full_name, "email": data.email}
    ).execute()

    # organization_members にテナント紐付けと権限を登録
    admin_client.table("organization_members").insert(
        {"user_id": new_user_id, "tenant_id": tenant_id, "role": data.role}
    ).execute()

    return MemberResponse(
        user_id=new_user_id,
        email=data.email,
        full_name=data.full_name,
        role=data.role,
    )


@member_router.patch("/{user_id}", response_model=MemberResponse)
def update_member(
    user_id: str,
    data: MemberUpdateSchema,
    tenant_id: str = Depends(get_current_tenant_id),
    current_user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    admin_client: Client = Depends(get_supabase_admin_client),
):
    """メンバーの氏名・権限を変更する（president のみ）"""
    _require_president(current_user_id, tenant_id, client)

    # 自分自身の president 権限降格を禁止
    if (
        user_id == current_user_id
        and data.role is not None
        and data.role != "president"
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="自分自身の権限を降格させることはできません",
        )

    # 対象ユーザーが同テナントに所属しているか確認
    member_res = (
        client.table("organization_members")
        .select("user_id, role")
        .eq("user_id", user_id)
        .eq("tenant_id", tenant_id)
        .single()
        .execute()
    )
    if not member_res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="メンバーが見つかりません"
        )

    # role 変更の場合、president が0人になることを防ぐ
    if (
        data.role is not None
        and data.role != "president"
        and cast(dict[str, Any], member_res.data).get("role") == "president"
    ):
        president_count_res = (
            client.table("organization_members")
            .select("user_id", count="exact")  # type: ignore[arg-type]
            .eq("tenant_id", tenant_id)
            .eq("role", "president")
            .execute()
        )
        if (president_count_res.count or 0) <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="テナントに president が0人になるような変更はできません",
            )

    updates: dict[str, Any] = {}
    if data.role is not None:
        updates["role"] = data.role

    if updates:
        admin_client.table("organization_members").update(updates).eq(
            "user_id", user_id
        ).eq("tenant_id", tenant_id).execute()

    if data.full_name is not None:
        admin_client.table("profiles").upsert(
            {"id": user_id, "full_name": data.full_name}
        ).execute()

    # 最新情報を取得して返す
    refreshed = (
        admin_client.table("organization_members")
        .select("user_id, role, profiles(full_name, email)")
        .eq("user_id", user_id)
        .eq("tenant_id", tenant_id)
        .single()
        .execute()
    )
    row = cast(dict[str, Any], refreshed.data)
    profile = cast(dict[str, Any], row.get("profiles") or {})

    return MemberResponse(
        user_id=row["user_id"],
        email=profile.get("email", ""),
        full_name=profile.get("full_name"),
        role=row["role"],
    )


@member_router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_member(
    user_id: str,
    tenant_id: str = Depends(get_current_tenant_id),
    current_user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    admin_client: Client = Depends(get_supabase_admin_client),
):
    """メンバーをテナントから削除する（president のみ、自分自身は削除不可）"""
    _require_president(current_user_id, tenant_id, client)

    if user_id == current_user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="自分自身を削除することはできません",
        )

    # 対象ユーザーが同テナントに所属しているか確認
    member_res = (
        client.table("organization_members")
        .select("user_id, role")
        .eq("user_id", user_id)
        .eq("tenant_id", tenant_id)
        .single()
        .execute()
    )
    if not member_res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="メンバーが見つかりません"
        )

    # president を削除する場合、president が0人になることを防ぐ
    if cast(dict[str, Any], member_res.data).get("role") == "president":
        president_count_res = (
            client.table("organization_members")
            .select("user_id", count="exact")  # type: ignore[arg-type]
            .eq("tenant_id", tenant_id)
            .eq("role", "president")
            .execute()
        )
        if (president_count_res.count or 0) <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="テナントに president が0人になるような削除はできません",
            )

    # organization_members から削除（テナント紐付けを解除）
    admin_client.table("organization_members").delete().eq("user_id", user_id).eq(
        "tenant_id", tenant_id
    ).execute()
