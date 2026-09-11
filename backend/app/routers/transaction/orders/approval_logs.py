# routers/transaction/orders/approval_logs.py
"""承認履歴（監査ログ）の閲覧・CSV出力: GET /orders/approval-logs(/export)（Issue #376）。"""

import csv
import io
from typing import Any, cast

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_order_approval_log_repo,
    get_supabase_client,
)
from app.models.transaction.order_schema import OrderApprovalLogResponse
from app.repositories.supa_infra.transaction.order_approval_log_repo import (
    OrderApprovalLogRepository,
)
from app.utils.logger import get_logger
from supabase import Client

from ._shared import _require_any_role

router = APIRouter()

logger = get_logger(__name__)

# 承認履歴の閲覧・出力を許可するロール（iso_officer: 監査目的、president: 承認者本人としての確認）。
# order_handler は自身の操作ログであっても閲覧不可とし、監査ログとしての独立性を保つ。
_APPROVAL_LOG_VIEWER_ROLES = ("iso_officer", "president", "platform_admin")


def _fetch_enriched_approval_logs(
    tenant_id: str,
    user_id: str,
    client: Client,
    approval_log_repo: OrderApprovalLogRepository,
) -> list[dict[str, Any]]:
    _require_any_role(
        tenant_id, user_id, client, _APPROVAL_LOG_VIEWER_ROLES, "承認履歴の閲覧"
    )

    # 監査ログ本体・注文番号・操作者プロフィールのいずれも、閲覧者自身のユーザーJWT
    # クライアントで取得する（Service Role Keyは使わない）。orders / profiles は
    # 「同一テナントのメンバーなら閲覧可」というRLSを既に持つため、
    # _require_any_role でテナントメンバー かつ 閲覧許可ロールであることを検証済みの
    # このユーザーであれば、RLSをバイパスせずに参照できる。
    logs = approval_log_repo.get_all()
    if not logs:
        return []

    order_ids = list({log["order_id"] for log in logs})
    actor_ids = list({log["actor_user_id"] for log in logs})

    orders_res = (
        client.table("orders").select("id, order_number").in_("id", order_ids).execute()
    )
    order_number_map = {
        o["id"]: o["order_number"]
        for o in cast(list[dict[str, Any]], orders_res.data or [])
    }

    profiles_res = (
        client.table("profiles")
        .select("id, full_name, email")
        .in_("id", actor_ids)
        .execute()
    )
    profiles_map = {
        p["id"]: p for p in cast(list[dict[str, Any]], profiles_res.data or [])
    }

    enriched: list[dict[str, Any]] = []
    for log in logs:
        profile = profiles_map.get(log["actor_user_id"], {})
        enriched.append(
            {
                "id": log["id"],
                "order_id": log["order_id"],
                "order_number": order_number_map.get(log["order_id"]),
                "action": log["action"],
                "actor_user_id": log["actor_user_id"],
                "actor_full_name": profile.get("full_name"),
                "actor_email": profile.get("email"),
                "reason": log.get("reason"),
                "created_at": log["created_at"],
            }
        )
    return enriched


@router.get("/approval-logs", response_model=list[OrderApprovalLogResponse])
def list_approval_logs(
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    approval_log_repo: OrderApprovalLogRepository = Depends(
        get_order_approval_log_repo
    ),
):
    """
    承認ワークフロー（承認依頼送信・承認・差し戻し・取り下げ）の監査ログを一覧取得する
    （iso_officer / president / platform_admin のみ閲覧可）。
    """
    return _fetch_enriched_approval_logs(tenant_id, user_id, client, approval_log_repo)


@router.get("/approval-logs/export")
def export_approval_logs_csv(
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    approval_log_repo: OrderApprovalLogRepository = Depends(
        get_order_approval_log_repo
    ),
):
    """
    承認ワークフローの監査ログをCSV形式で出力する（iso_officer / president / platform_admin のみ）。
    """
    logs = _fetch_enriched_approval_logs(tenant_id, user_id, client, approval_log_repo)

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        ["注文番号", "操作", "操作者氏名", "操作者メール", "理由", "操作日時"]
    )
    action_labels = {
        "request_approval": "承認依頼送信",
        "approve": "承認",
        "reject": "差し戻し",
        "withdraw": "取り下げ",
    }
    for log in logs:
        writer.writerow(
            [
                log["order_number"] or f"#{log['order_id']}",
                action_labels.get(log["action"], log["action"]),
                log["actor_full_name"] or "",
                log["actor_email"] or "",
                log["reason"] or "",
                log["created_at"],
            ]
        )

    # Excelでの文字化けを避けるためBOMを付与する
    csv_content = "﻿" + buffer.getvalue()
    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="approval_logs.csv"'},
    )
