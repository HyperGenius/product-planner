# routers/transaction/orders/approval_workflow.py
"""承認ワークフロー（状態遷移）: request-approval / confirm / approve-bulk /
reject / withdraw-approval / ship / ship-overdue-drafts（Issue #376）。"""

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_order_approval_log_repo,
    get_order_repo,
    get_product_repo,
    get_schedule_repo,
    get_supabase_client,
)
from app.models.transaction.order_schema import (
    OrderBulkApproveRequest,
    OrderRejectRequest,
    ShipOverdueDraftsResponse,
)
from app.repositories.supa_infra.common.scheduling_settings_repo import (
    SchedulingSettingsRepository,
)
from app.repositories.supa_infra.master.product_repo import ProductRepository
from app.repositories.supa_infra.transaction.order_approval_log_repo import (
    OrderApprovalLogRepository,
)
from app.repositories.supa_infra.transaction.order_repo import OrderRepository
from app.repositories.supa_infra.transaction.schedule_repo import ScheduleRepository
from app.scheduler_logic import (
    InvalidRoutingDurationError,
    RoutingUnconfirmedError,
    schedule_order,
)
from app.services.notification_service import create_notification
from app.services.order_status_service import (
    InvalidOrderStatusTransitionError,
    is_overdue_draft,
    validate_order_status_transition,
)
from app.services.product_alias_service import record_auto_match_alias_if_applicable
from app.services.scheduling_start_service import to_scheduling_start_time
from app.utils.calendar import JST
from app.utils.logger import get_logger
from supabase import Client

from ._shared import (
    _deadline_from_schedules,
    _map_order_response,
    _require_any_role,
    _require_role,
    get_settings_repo,
)

router = APIRouter()

logger = get_logger(__name__)


def _log_approval_action_safely(
    approval_log_repo: OrderApprovalLogRepository,
    tenant_id: str,
    order_id: int,
    action: str,
    user_id: str,
    reason: str | None = None,
) -> None:
    """
    承認監査ログの記録はベストエフォートとする。
    状態遷移（承認依頼送信・承認・差し戻し・取り下げ）自体は既にDB更新が成功しており、
    監査ログの記録に失敗したからといって業務上成功した操作をエラー扱いにはしない
    （特に `approve-bulk` では、1件のログ記録失敗が他の注文の確定結果を
    巻き込んで500にしてしまうことを防ぐ）。
    """
    try:
        approval_log_repo.log_action(tenant_id, order_id, action, user_id, reason)
    except Exception:
        logger.exception(
            f"Failed to record approval log: order_id={order_id}, action={action}"
        )


def _notify_approval_requested_safely(
    client: Client, tenant_id: str, order_id: int, order_no: str | None
) -> None:
    """
    承認依頼通知の書き込みはベストエフォートとする（Issue #327）。
    通知の記録に失敗しても、承認依頼送信自体（既にDB更新済み）はエラー扱いにしない。
    """
    try:
        create_notification(
            client,
            tenant_id,
            "approval_requested",
            "orders",
            str(order_id),
            detail={"order_no": order_no} if order_no else None,
        )
    except Exception:
        logger.exception(
            f"Failed to record approval_requested notification: order_id={order_id}"
        )


def _confirm_single_order(
    order_id: int,
    tenant_id: str,
    order_repo: OrderRepository,
    product_repo: ProductRepository,
    schedule_repo: ScheduleRepository,
    settings_repo: SchedulingSettingsRepository,
) -> dict:
    """
    スケジュールを確定・保存し、注文ステータスをconfirmedにする。
    ロールチェックは呼び出し側（単体/一括の各エンドポイント）で行う。
    """
    order = order_repo.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("product_id") is None:
        raise HTTPException(status_code=422, detail={"error": "product_unmatched"})

    try:
        validate_order_status_transition(order.get("status"), "confirmed")
    except InvalidOrderStatusTransitionError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None

    # 1. 実際に保存 (dry_run=False)
    #    受注に作業開始日が設定されていれば、その日の稼働開始時刻を起点にする（Issue #372）。
    #    保存済みの値は書き込み時に検証済みのため、ここでは権限チェック不要。
    start_time = to_scheduling_start_time(order.get("scheduling_start_date"))
    result = schedule_order(
        order_id=order["id"],
        product_id=order["product_id"],
        quantity=order["quantity"],
        product_repo=product_repo,
        schedule_repo=schedule_repo,
        tenant_id=tenant_id,
        start_time=start_time,
        dry_run=False,
        settings_repo=settings_repo,
        desired_deadline=order.get("deadline_date"),
    )

    # 2. ステータス更新 & is_scheduled フラグ更新
    confirmed_deadline = _deadline_from_schedules(result)
    order_repo.update(
        order_id,
        {
            "status": "confirmed",
            "is_scheduled": True,
            "confirmed_at": datetime.now(UTC).isoformat(),
            "confirmed_deadline": confirmed_deadline,
        },
    )

    return {"status": "confirmed", "schedules": result}


@router.post("/{order_id}/request-approval")
def request_order_approval(
    order_id: int,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    order_repo: OrderRepository = Depends(get_order_repo),
    approval_log_repo: OrderApprovalLogRepository = Depends(
        get_order_approval_log_repo
    ),
):
    """
    下書き注文の承認依頼を送信し、注文ステータスをpending_approvalにする（order_handler限定）。

    メール起票かつ自動マッチのまま（担当者が product_id を未修正）の注文は、
    この時点で「担当者の目を通った」とみなし、その対応を製品別名辞書へ
    source='auto_match_unreviewed' として記録する（Issue #350）。
    """
    logger.info(f"Requesting approval for order {order_id}")
    _require_role(tenant_id, user_id, client, "order_handler", "承認依頼の送信")

    order = order_repo.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("product_id") is None:
        raise HTTPException(status_code=422, detail={"error": "product_unmatched"})

    try:
        validate_order_status_transition(order.get("status"), "pending_approval")
    except InvalidOrderStatusTransitionError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None

    result = order_repo.update(
        order_id,
        {
            "status": "pending_approval",
            "rejection_reason": None,
            # 承認待ちキューカード（Issue #402）の「依頼者 / 経過時間」表示用に非正規化する。
            # 監査ログ（order_approval_log）とは別に orders 側へも直接書き込む。
            "approval_requested_at": datetime.now(UTC).isoformat(),
            "approval_requested_by": user_id,
        },
    )
    _log_approval_action_safely(
        approval_log_repo, tenant_id, order_id, "request_approval", user_id
    )
    _notify_approval_requested_safely(
        client, tenant_id, order_id, order.get("order_number")
    )
    record_auto_match_alias_if_applicable(client, tenant_id, order, user_id)
    return _map_order_response(result)


@router.post("/{order_id}/confirm")
def confirm_order(
    order_id: int,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    order_repo: OrderRepository = Depends(get_order_repo),
    product_repo: ProductRepository = Depends(get_product_repo),
    schedule_repo: ScheduleRepository = Depends(get_schedule_repo),
    settings_repo: SchedulingSettingsRepository = Depends(get_settings_repo),
    approval_log_repo: OrderApprovalLogRepository = Depends(
        get_order_approval_log_repo
    ),
):
    """
    受注を承認する。スケジュールを確定・保存し、注文ステータスをconfirmedにする（president限定）。
    """
    logger.info(f"Confirming order {order_id}")
    _require_role(tenant_id, user_id, client, "president", "受注の承認（確定）")

    try:
        result = _confirm_single_order(
            order_id, tenant_id, order_repo, product_repo, schedule_repo, settings_repo
        )
        _log_approval_action_safely(
            approval_log_repo, tenant_id, order_id, "approve", user_id
        )
        return result
    except RoutingUnconfirmedError as e:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "routing_unconfirmed",
                "desired_deadline": e.desired_deadline,
            },
        ) from None
    except InvalidRoutingDurationError as e:
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_routing_duration", "routing_id": e.routing_id},
        ) from None
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None


@router.post("/approve-bulk")
def approve_orders_bulk(
    bulk_data: OrderBulkApproveRequest,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    order_repo: OrderRepository = Depends(get_order_repo),
    product_repo: ProductRepository = Depends(get_product_repo),
    schedule_repo: ScheduleRepository = Depends(get_schedule_repo),
    settings_repo: SchedulingSettingsRepository = Depends(get_settings_repo),
    approval_log_repo: OrderApprovalLogRepository = Depends(
        get_order_approval_log_repo
    ),
):
    """
    複数の承認待ち注文をまとめて承認する（president限定）。1件ごとの成否を返す。
    """
    logger.info(f"Bulk approving orders {bulk_data.order_ids}")
    _require_role(tenant_id, user_id, client, "president", "受注の承認（確定）")

    results: list[dict[str, Any]] = []
    for order_id in bulk_data.order_ids:
        try:
            confirm_result = _confirm_single_order(
                order_id,
                tenant_id,
                order_repo,
                product_repo,
                schedule_repo,
                settings_repo,
            )
            _log_approval_action_safely(
                approval_log_repo, tenant_id, order_id, "approve", user_id
            )
            results.append(
                {
                    "order_id": order_id,
                    "status": "confirmed",
                    "schedules": confirm_result["schedules"],
                }
            )
        except HTTPException as e:
            results.append(
                {"order_id": order_id, "status": "error", "detail": e.detail}
            )
        except RoutingUnconfirmedError as e:
            results.append(
                {
                    "order_id": order_id,
                    "status": "error",
                    "detail": {
                        "error": "routing_unconfirmed",
                        "desired_deadline": e.desired_deadline,
                    },
                }
            )
        except InvalidRoutingDurationError as e:
            results.append(
                {
                    "order_id": order_id,
                    "status": "error",
                    "detail": {
                        "error": "invalid_routing_duration",
                        "routing_id": e.routing_id,
                    },
                }
            )
        except ValueError as e:
            results.append({"order_id": order_id, "status": "error", "detail": str(e)})

    return {"results": results}


@router.post("/{order_id}/reject")
def reject_order(
    order_id: int,
    reject_data: OrderRejectRequest,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    order_repo: OrderRepository = Depends(get_order_repo),
    approval_log_repo: OrderApprovalLogRepository = Depends(
        get_order_approval_log_repo
    ),
):
    """
    承認待ちの注文を差し戻す（president限定）。理由は任意入力。
    """
    logger.info(f"Rejecting order {order_id}")
    _require_role(tenant_id, user_id, client, "president", "受注の差し戻し")

    order = order_repo.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    try:
        validate_order_status_transition(order.get("status"), "draft")
    except InvalidOrderStatusTransitionError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None

    result = order_repo.update(
        order_id,
        {
            "status": "draft",
            "rejection_reason": reject_data.reason,
            # draft へ戻った注文に古い依頼者・依頼日時を残さない（Issue #402）。
            "approval_requested_at": None,
            "approval_requested_by": None,
        },
    )
    _log_approval_action_safely(
        approval_log_repo, tenant_id, order_id, "reject", user_id, reject_data.reason
    )
    return _map_order_response(result)


@router.post("/{order_id}/withdraw-approval")
def withdraw_order_approval(
    order_id: int,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    order_repo: OrderRepository = Depends(get_order_repo),
    approval_log_repo: OrderApprovalLogRepository = Depends(
        get_order_approval_log_repo
    ),
):
    """
    誤って送信した承認依頼を取り下げ、下書きに差し戻す（order_handler限定）。

    president による差し戻し（`reject`）とは異なり理由は付かない。
    「差し戻し」を業務上の判断（president による reject）と、送信主自身による単純な取り消しとで
    区別できるよう、監査ログには別action（`withdraw`）として記録する。
    """
    logger.info(f"Withdrawing approval request for order {order_id}")
    _require_role(tenant_id, user_id, client, "order_handler", "承認依頼の取り下げ")

    order = order_repo.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    try:
        validate_order_status_transition(order.get("status"), "draft")
    except InvalidOrderStatusTransitionError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None

    result = order_repo.update(
        order_id,
        {
            "status": "draft",
            # draft へ戻った注文に古い依頼者・依頼日時を残さない（Issue #402）。
            "approval_requested_at": None,
            "approval_requested_by": None,
        },
    )
    _log_approval_action_safely(
        approval_log_repo, tenant_id, order_id, "withdraw", user_id
    )
    return _map_order_response(result)


@router.post("/{order_id}/ship")
def ship_order(
    order_id: int,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    order_repo: OrderRepository = Depends(get_order_repo),
):
    """
    確定済 / 生産中の注文を送品済み (shipped) にする（president / order_handler）。

    confirmed / in_progress から遷移でき、shipped は実質的な終端状態。
    """
    logger.info(f"Marking order {order_id} as shipped")
    _require_any_role(
        tenant_id,
        user_id,
        client,
        ("president", "order_handler"),
        "送品済みへの変更",
    )

    order = order_repo.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    try:
        validate_order_status_transition(order.get("status"), "shipped")
    except InvalidOrderStatusTransitionError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None

    result = order_repo.update(order_id, {"status": "shipped"})
    return _map_order_response(result)


@router.post("/ship-overdue-drafts", response_model=ShipOverdueDraftsResponse)
def ship_overdue_drafts(
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    order_repo: OrderRepository = Depends(get_order_repo),
):
    """
    納期を過ぎたまま残っている下書き (draft) 受注をまとめて送品済み (shipped) にする
    （president / platform_admin 限定、Issue #367）。

    トライアル運用中に溜まった「納期超過の下書き」を後片付けするための管理者操作。
    通常の draft -> shipped は許可されておらず（承認フローを通す）、このエンドポイント
    だけが例外的にその遷移を行う。対象は「status == 'draft' かつ 納期設定済み かつ
    納期 < 今日」に限定する。対象が0件でも 200 を返す。
    """
    logger.info("Shipping overdue draft orders")
    _require_any_role(
        tenant_id,
        user_id,
        client,
        ("president", "platform_admin"),
        "納期超過下書きの送品済み化",
    )

    # 実行ホストのTZに関わらず、納期超過判定はJST基準の暦日で行う（Issue #376 PRレビュー対応）。
    today = datetime.now(JST).date()
    target_ids = [
        order["id"]
        for order in order_repo.get_all()
        if is_overdue_draft(order.get("status"), order.get("deadline_date"), today)
    ]

    updated = order_repo.bulk_update_status(target_ids, "shipped")
    updated_ids = [o["id"] for o in updated] if updated else []

    logger.info(f"Shipped {len(updated_ids)} overdue draft orders")
    logger.debug(f"Shipped overdue draft order ids: {updated_ids}")
    return {"shipped_count": len(updated_ids), "order_ids": updated_ids}
