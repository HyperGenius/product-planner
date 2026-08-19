import secrets
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_supabase_admin_client,
    get_supabase_client,
)
from app.models.auth import (
    DeviceMemberOption,
    DeviceRegisterResponse,
    DeviceStatusResponse,
    DeviceTrustResponse,
    PinLoginRequest,
    PinLoginResponse,
)
from app.utils.logger import get_logger
from supabase import Client  # type: ignore

device_router = APIRouter(prefix="/auth/device", tags=["Auth (Device)"])

logger = get_logger(__name__)

# members.py の _MEMBER_ADMIN_ROLES と同じ方針: 端末信頼の登録・失効・一覧閲覧は
# president / platform_admin のみが行える（PINログイン自体の対象外の操作）。
_DEVICE_ADMIN_ROLES = ("president", "platform_admin")

# PINロックアウト設定
_MAX_FAILED_ATTEMPTS = 5
_LOCKOUT_DURATION = timedelta(minutes=5)


def _require_device_admin(
    current_user_id: str,
    tenant_id: str,
    client: Client,
) -> None:
    """現在のユーザーが対象テナントで端末管理権限を持つことを検証する。"""
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
        or cast(dict[str, Any], res.data).get("role") not in _DEVICE_ADMIN_ROLES
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="この操作には president または platform_admin 権限が必要です",
        )


def _active_trust(admin_client: Client, device_id: str) -> dict[str, Any] | None:
    """有効な（未失効・未期限切れの）端末信頼レコードを取得する。"""
    res = (
        admin_client.table("device_trust_registrations")
        .select("id, tenant_id, expires_at, revoked_at")
        .eq("device_id", device_id)
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        return None
    row = cast(dict[str, Any], res.data)
    if row.get("revoked_at"):
        return None
    expires_at = datetime.fromisoformat(row["expires_at"])
    if expires_at <= datetime.now(UTC):
        return None
    return row


@device_router.post("/register", response_model=DeviceRegisterResponse)
def register_device(
    tenant_id: str = Depends(get_current_tenant_id),
    current_user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    admin_client: Client = Depends(get_supabase_admin_client),
):
    """現在使用中の端末をこのテナントの信頼済み端末として登録する（president / platform_admin のみ）"""
    _require_device_admin(current_user_id, tenant_id, client)

    device_id = secrets.token_urlsafe(32)
    insert_res = (
        admin_client.table("device_trust_registrations")
        .insert(
            {
                "tenant_id": tenant_id,
                "device_id": device_id,
                "registered_by": current_user_id,
            }
        )
        .execute()
    )
    row = cast(dict[str, Any], insert_res.data[0])
    return DeviceRegisterResponse(device_id=device_id, expires_at=row["expires_at"])


@device_router.get("", response_model=list[DeviceTrustResponse])
def list_devices(
    tenant_id: str = Depends(get_current_tenant_id),
    current_user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    """テナントの信頼済み端末一覧を取得する（president / platform_admin のみ）"""
    _require_device_admin(current_user_id, tenant_id, client)

    res = (
        client.table("device_trust_registrations")
        .select("device_id, registered_by, created_at, expires_at, revoked_at")
        .eq("tenant_id", tenant_id)
        .order("created_at", desc=True)
        .execute()
    )
    rows = cast(list[dict[str, Any]], res.data or [])
    return [DeviceTrustResponse(**row) for row in rows]


@device_router.delete("/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_device(
    device_id: str,
    tenant_id: str = Depends(get_current_tenant_id),
    current_user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    admin_client: Client = Depends(get_supabase_admin_client),
):
    """端末信頼を失効させる（president / platform_admin のみ）"""
    _require_device_admin(current_user_id, tenant_id, client)

    res = (
        admin_client.table("device_trust_registrations")
        .update({"revoked_at": datetime.now(UTC).isoformat()})
        .eq("device_id", device_id)
        .eq("tenant_id", tenant_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="端末が見つかりません"
        )


@device_router.get("/status", response_model=DeviceStatusResponse)
def get_device_status(
    device_id: str,
    admin_client: Client = Depends(get_supabase_admin_client),
):
    """端末の信頼状態を取得する（認証不要、ログイン画面から呼び出す）"""
    trust = _active_trust(admin_client, device_id)
    if not trust:
        return DeviceStatusResponse(trusted=False)

    tenant_id = trust["tenant_id"]
    pins_res = (
        admin_client.table("member_pins")
        .select("user_id")
        .eq("tenant_id", tenant_id)
        .execute()
    )
    pin_user_ids = [
        row["user_id"] for row in cast(list[dict[str, Any]], pins_res.data or [])
    ]
    if not pin_user_ids:
        return DeviceStatusResponse(trusted=True, tenant_id=tenant_id, members=[])

    profiles_res = (
        admin_client.table("profiles")
        .select("id, full_name")
        .in_("id", pin_user_ids)
        .execute()
    )
    profiles = cast(list[dict[str, Any]], profiles_res.data or [])
    members = [
        DeviceMemberOption(user_id=p["id"], full_name=p.get("full_name"))
        for p in profiles
    ]
    return DeviceStatusResponse(trusted=True, tenant_id=tenant_id, members=members)


@device_router.post("/pin-login", response_model=PinLoginResponse)
def pin_login(
    data: PinLoginRequest,
    admin_client: Client = Depends(get_supabase_admin_client),
):
    """信頼済み端末上でPINによりログインする（認証不要）"""
    trust = _active_trust(admin_client, data.device_id)
    if not trust:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="この端末は信頼済みではありません",
        )
    tenant_id = trust["tenant_id"]

    pin_res = (
        admin_client.table("member_pins")
        .select("pin_hash, failed_attempts, locked_until")
        .eq("tenant_id", tenant_id)
        .eq("user_id", data.user_id)
        .maybe_single()
        .execute()
    )
    if not pin_res or not pin_res.data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="PINが設定されていません"
        )
    pin_row = cast(dict[str, Any], pin_res.data)

    locked_until = pin_row.get("locked_until")
    if locked_until and datetime.fromisoformat(locked_until) > datetime.now(UTC):
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail="PIN試行回数の上限に達しました。しばらくしてから再試行してください",
        )

    if not bcrypt.checkpw(data.pin.encode(), pin_row["pin_hash"].encode()):
        failed_attempts = pin_row.get("failed_attempts", 0) + 1
        update: dict[str, Any] = {"failed_attempts": failed_attempts}
        if failed_attempts >= _MAX_FAILED_ATTEMPTS:
            update["locked_until"] = (datetime.now(UTC) + _LOCKOUT_DURATION).isoformat()
        admin_client.table("member_pins").update(update).eq("tenant_id", tenant_id).eq(
            "user_id", data.user_id
        ).execute()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="PINが正しくありません"
        )

    user_res = admin_client.auth.admin.get_user_by_id(data.user_id)
    email = user_res.user.email if user_res.user else None
    if not email:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ユーザー情報の取得に失敗しました",
        )

    try:
        link_res = admin_client.auth.admin.generate_link(
            {"type": "magiclink", "email": email}
        )
        verify_res = admin_client.auth.verify_otp(
            {
                "token_hash": link_res.properties.hashed_token,
                "type": "magiclink",
            }
        )
    except Exception as e:
        logger.error(f"PINログインのセッション発行に失敗しました: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ログイン処理に失敗しました",
        ) from e

    if not verify_res or not verify_res.session:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ログイン処理に失敗しました",
        )

    admin_client.table("member_pins").update(
        {"failed_attempts": 0, "locked_until": None}
    ).eq("tenant_id", tenant_id).eq("user_id", data.user_id).execute()

    return PinLoginResponse(
        access_token=verify_res.session.access_token,
        refresh_token=verify_res.session.refresh_token,
    )
