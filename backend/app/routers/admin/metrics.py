import os
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import get_current_user_id, get_supabase_admin_client
from app.utils.logger import get_logger
from supabase import Client  # type: ignore

admin_router = APIRouter(prefix="/admin", tags=["Admin"])

logger = get_logger(__name__)


def _require_platform_admin(user_id: str, admin_client: Client) -> None:
    """ログインユーザーが PLATFORM_ADMIN_EMAIL と一致することを検証する。"""
    res = admin_client.auth.admin.get_user_by_id(user_id)
    email = res.user.email if res.user else None
    platform_admin_email = os.environ.get("PLATFORM_ADMIN_EMAIL")
    if not platform_admin_email or email != platform_admin_email:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="この操作はプラットフォーム管理者のみ実行できます",
        )


def _iso_week_start(dt: datetime) -> str:
    """datetime を ISO 週開始日（月曜日）の date 文字列に変換する。"""
    monday = dt - timedelta(days=dt.weekday())
    return monday.date().isoformat()


@admin_router.get("/metrics/weekly-confirmations")
def get_weekly_confirmations(
    current_user_id: str = Depends(get_current_user_id),
    admin_client: Client = Depends(get_supabase_admin_client),
):
    """
    テナント別・週次の納期確認件数を返す（直近12週分）。
    PLATFORM_ADMIN_EMAIL のユーザーのみアクセス可。
    """
    _require_platform_admin(current_user_id, admin_client)

    logger.info(f"Fetching weekly confirmations (requested by {current_user_id})")

    cutoff = (datetime.now(UTC) - timedelta(weeks=12)).isoformat()

    orders_res = (
        admin_client.table("orders")
        .select("tenant_id, confirmed_at")
        .not_.is_("confirmed_at", "null")
        .gte("confirmed_at", cutoff)
        .execute()
    )

    tenants_res = admin_client.table("tenants").select("id, name").execute()
    tenant_rows: list[dict[str, Any]] = cast(
        list[dict[str, Any]], tenants_res.data or []
    )
    tenant_map: dict[str, str] = {str(t["id"]): str(t["name"]) for t in tenant_rows}

    counts: dict[tuple[str, str], int] = defaultdict(int)
    order_rows: list[dict[str, Any]] = cast(list[dict[str, Any]], orders_res.data or [])
    for order in order_rows:
        tenant_id = str(order["tenant_id"])
        confirmed_at_str = str(order["confirmed_at"]).replace("Z", "+00:00")
        dt = datetime.fromisoformat(confirmed_at_str)
        week_start = _iso_week_start(dt)
        counts[(tenant_id, week_start)] += 1

    return [
        {
            "tenant_id": tenant_id,
            "tenant_name": tenant_map.get(tenant_id, tenant_id),
            "week_start": week_start,
            "count": count,
        }
        for (tenant_id, week_start), count in sorted(counts.items())
    ]
