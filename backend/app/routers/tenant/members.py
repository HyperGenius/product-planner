from typing import Any, cast

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_supabase_admin_client,
    get_supabase_client,
)
from app.models.tenant import (
    MemberCreateSchema,
    MemberResponse,
    MemberUpdateSchema,
    PinSetSchema,
)
from app.utils.logger import get_logger
from supabase import Client  # type: ignore

member_router = APIRouter(prefix="/tenant/members", tags=["Tenant (Members)"])

logger = get_logger(__name__)


# メンバー管理(一覧閲覧・追加・変更・削除)を行える権限を持つロール。
# platform_admin は閲覧全般・メンバー管理・設定サポートを担うが、承認操作は含めない
# （承認系エンドポイントでは対象外とすること）。
_MEMBER_ADMIN_ROLES = ("president", "platform_admin")


def _require_member_admin(
    current_user_id: str,
    tenant_id: str,
    client: Client,
) -> None:
    """現在のユーザーが対象テナントでメンバー管理権限を持つことを検証する。"""
    res = (
        client.table("organization_members")
        .select("role")
        .eq("user_id", current_user_id)
        .eq("tenant_id", tenant_id)
        .single()
        .execute()
    )
    if (
        not res.data
        or cast(dict[str, Any], res.data).get("role") not in _MEMBER_ADMIN_ROLES
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="この操作には president または platform_admin 権限が必要です",
        )


@member_router.get("", response_model=list[MemberResponse])
def list_members(
    tenant_id: str = Depends(get_current_tenant_id),
    current_user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    admin_client: Client = Depends(get_supabase_admin_client),
):
    """テナントのメンバー一覧を取得する（president / platform_admin のみ）"""
    _require_member_admin(current_user_id, tenant_id, client)

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


@member_router.get("/me", response_model=MemberResponse)
def get_my_membership(
    tenant_id: str = Depends(get_current_tenant_id),
    current_user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    """
    現在ログイン中のユーザー自身のテナントメンバー情報（自分のロール等）を取得する。

    `GET /tenant/members` (一覧) は president / platform_admin 限定だが、
    フロントエンドで「自分のロールに応じて操作を出し分ける」用途（承認依頼送信・
    承認・却下ボタンの表示制御等）では、対象ロール以外のユーザーも自分のロールを
    取得できる必要があるため、ロール制限なしの自己参照専用エンドポイントとして分離する。
    """
    # organization_members と profiles の間にFK関係が定義されていないため、
    # PostgRESTの埋め込み構文 (`profiles(...)`) は使えない。list_members と同様に
    # 2クエリに分けて取得する。
    res = (
        client.table("organization_members")
        .select("user_id, role")
        .eq("user_id", current_user_id)
        .eq("tenant_id", tenant_id)
        .single()
        .execute()
    )
    if not res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="メンバー情報が見つかりません"
        )
    row = cast(dict[str, Any], res.data)

    profile_res = (
        client.table("profiles")
        .select("full_name, email")
        .eq("id", current_user_id)
        .maybe_single()
        .execute()
    )
    profile = (
        cast(dict[str, Any], profile_res.data)
        if profile_res and profile_res.data
        else {}
    )

    return MemberResponse(
        user_id=row["user_id"],
        email=profile.get("email", ""),
        full_name=profile.get("full_name"),
        role=row["role"],
    )


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
    """新規メンバーをアカウント発行して追加する（president / platform_admin のみ）"""
    _require_member_admin(current_user_id, tenant_id, client)

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
    """メンバーの氏名・権限を変更する（president / platform_admin のみ）"""
    _require_member_admin(current_user_id, tenant_id, client)

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
    current_role = cast(dict[str, Any], member_res.data).get("role")

    # 自分自身のメンバー管理権限(president/platform_admin)の降格を禁止
    if (
        user_id == current_user_id
        and data.role is not None
        and current_role in _MEMBER_ADMIN_ROLES
        and data.role != current_role
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="自分自身の権限を降格させることはできません",
        )

    # role 変更の場合、president/platform_admin がそれぞれ0人になることを防ぐ
    if (
        data.role is not None
        and data.role != current_role
        and current_role in _MEMBER_ADMIN_ROLES
    ):
        role_count_res = (
            client.table("organization_members")
            .select("user_id", count="exact")  # type: ignore[arg-type]
            .eq("tenant_id", tenant_id)
            .eq("role", current_role)
            .execute()
        )
        if (role_count_res.count or 0) <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"テナントに {current_role} が0人になるような変更はできません",
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
    """メンバーをテナントから削除する（president / platform_admin のみ、自分自身は削除不可）"""
    _require_member_admin(current_user_id, tenant_id, client)

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

    # president/platform_admin を削除する場合、それぞれが0人になることを防ぐ
    current_role = cast(dict[str, Any], member_res.data).get("role")
    if current_role in _MEMBER_ADMIN_ROLES:
        role_count_res = (
            client.table("organization_members")
            .select("user_id", count="exact")  # type: ignore[arg-type]
            .eq("tenant_id", tenant_id)
            .eq("role", current_role)
            .execute()
        )
        if (role_count_res.count or 0) <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"テナントに {current_role} が0人になるような削除はできません",
            )

    # organization_members から削除（テナント紐付けを解除）
    admin_client.table("organization_members").delete().eq("user_id", user_id).eq(
        "tenant_id", tenant_id
    ).execute()

    # member_pins を削除しておかないと、テナントから外れた後もPINハッシュが
    # 残り続け、共有端末のPINログイン候補一覧に表示されたり、PINログインが
    # 通ってしまう（Copilotレビュー指摘）
    admin_client.table("member_pins").delete().eq("tenant_id", tenant_id).eq(
        "user_id", user_id
    ).execute()


@member_router.patch("/me/pin", status_code=status.HTTP_204_NO_CONTENT)
def set_my_pin(
    data: PinSetSchema,
    tenant_id: str = Depends(get_current_tenant_id),
    current_user_id: str = Depends(get_current_user_id),
    admin_client: Client = Depends(get_supabase_admin_client),
):
    """信頼済み端末でのPINログイン用に、自分自身のPINを設定/変更する。"""
    pin_hash = bcrypt.hashpw(data.pin.encode(), bcrypt.gensalt()).decode()
    admin_client.table("member_pins").upsert(
        {
            "tenant_id": tenant_id,
            "user_id": current_user_id,
            "pin_hash": pin_hash,
            "failed_attempts": 0,
            "locked_until": None,
        }
    ).execute()


@member_router.post("/{user_id}/pin/reset", status_code=status.HTTP_204_NO_CONTENT)
def reset_member_pin(
    user_id: str,
    tenant_id: str = Depends(get_current_tenant_id),
    current_user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    admin_client: Client = Depends(get_supabase_admin_client),
):
    """対象メンバーのPINを削除する（president / platform_admin のみ）。

    本人が再度PINを設定するまでPINログインは利用できなくなる。
    パスワードによる復旧経路を残すための操作。
    """
    _require_member_admin(current_user_id, tenant_id, client)
    admin_client.table("member_pins").delete().eq("tenant_id", tenant_id).eq(
        "user_id", user_id
    ).execute()
