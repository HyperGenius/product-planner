# routers/transaction/orders/crud.py
"""注文の基本CRUD: POST/GET /orders, GET/PATCH/DELETE /orders/{order_id}（Issue #376）。"""

from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_order_repo,
    get_order_scheduling_start_backdate_log_repo,
    get_supabase_client,
)
from app.models.transaction.order_schema import OrderCreate, OrderUpdate
from app.repositories.supa_infra.common import DuplicateRecordError
from app.repositories.supa_infra.transaction.order_repo import OrderRepository
from app.repositories.supa_infra.transaction.order_scheduling_start_backdate_log_repo import (
    OrderSchedulingStartBackdateLogRepository,
)
from app.services.product_alias_service import record_correction_if_applicable
from app.utils.logger import get_logger
from supabase import Client

from ._shared import _duplicate_order_conflict_exception, _map_order_response
from .scheduling_start import (
    _assert_scheduling_start_date_allowed,
    _log_scheduling_start_backdate_safely,
)

router = APIRouter()

logger = get_logger(__name__)


def _attach_approval_requester_names(client: Client, orders: list[dict]) -> None:
    """承認依頼者（approval_requested_by）の表示名を各注文へ付与する（Issue #402）。

    承認待ちキューカードが「依頼者」列を出すための補完。`approval_requested_by`
    （非正規化した auth.users.id）から profiles を1クエリで引き、`full_name`
    → なければ `email` を `approval_requested_by_name` として詰める。依頼者が
    いない（＝pending_approval 以外の）注文には None を入れる。profiles は
    「同一テナントのメンバーなら参照可」の RLS を持つため、閲覧者自身の
    ユーザー JWT クライアントで取得する。
    """
    requester_ids = list(
        {o["approval_requested_by"] for o in orders if o.get("approval_requested_by")}
    )
    name_map: dict[str, str | None] = {}
    if requester_ids:
        res = (
            client.table("profiles")
            .select("id, full_name, email")
            .in_("id", requester_ids)
            .execute()
        )
        name_map = {
            p["id"]: (p.get("full_name") or p.get("email"))
            for p in cast(list[dict[str, Any]], res.data or [])
        }
    for order in orders:
        rid = order.get("approval_requested_by")
        order["approval_requested_by_name"] = name_map.get(rid) if rid else None


# product_id / 数量 / 希望納期 / 作業開始日 のいずれかが変わると、実行済みの
# シミュレーション結果（simulated_deadline）と is_scheduled は陳腐化するため、
# PATCH /orders/{id} でこれらが変化したら両方を無効化する（Issue #394-A / #392 統合）。
# キー名は OrderUpdate のフィールド名（エイリアスではない）に合わせる。
_SIM_INVALIDATING_ORDER_FIELDS = (
    "product_id",
    "quantity",
    "deadline_date",
    "scheduling_start_date",
)


@router.post("")
def create_order(
    order_data: OrderCreate,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    repo: OrderRepository = Depends(get_order_repo),
    backdate_log_repo: OrderSchedulingStartBackdateLogRepository = Depends(
        get_order_scheduling_start_backdate_log_repo
    ),
):
    """注文を新規作成"""
    logger.info(f"Creating order {order_data}")
    backdated = _assert_scheduling_start_date_allowed(
        order_data.scheduling_start_date, tenant_id, user_id, client
    )
    try:
        result = repo.create(order_data.with_tenant_id(tenant_id))
    except DuplicateRecordError as e:
        raise _duplicate_order_conflict_exception(
            e,
            client=client,
            order_repo=repo,
            tenant_id=tenant_id,
            customer_id=order_data.customer_id,
            product_id=order_data.product_id,
            deadline_date=order_data.deadline_date,
            extracted_product_name=order_data.extracted_product_name,
        ) from None
    except ValueError as e:
        # 重複（23505）以外で create() が投げる ValueError（例: insert が空配列を
        # 返した場合の "Failed to create record"）。クライアント起因ではないが、
        # 従来通り 400 に正規化する（Issue #415 PR2 で DuplicateRecordError 分岐を
        # 追加した際に、この分岐が失われないよう明示的に残す）。
        raise HTTPException(status_code=400, detail=str(e)) from None
    if backdated and order_data.scheduling_start_date:
        _log_scheduling_start_backdate_safely(
            backdate_log_repo,
            tenant_id,
            result["id"],
            order_data.scheduling_start_date,
            user_id,
            "create",
        )
    return _map_order_response(result)


@router.get("")
def get_orders(
    repo: OrderRepository = Depends(get_order_repo),
    client: Client = Depends(get_supabase_client),
):
    """注文を全件取得（has_no_routings / has_unconfirmed_routings フラグ付き）

    承認待ち（pending_approval）注文には承認依頼者名（approval_requested_by_name）と
    依頼日時（approval_requested_at）を付与する。承認待ちキューカード（Issue #402）が
    「誰から・いつ」承認を頼まれたかを一覧表示するために使う。
    """
    logger.info("Fetching all orders")
    results = repo.get_all_with_routing_status()
    mapped = [_map_order_response(order) for order in results]
    _attach_approval_requester_names(client, mapped)
    return mapped


@router.get("/{order_id}")
def get_order(order_id: int, repo: OrderRepository = Depends(get_order_repo)):
    """注文を1件取得（has_no_routings / has_unconfirmed_routings フラグ付き）"""
    logger.info(f"Fetching order {order_id}")
    result = repo.get_by_id_with_routing_status(order_id)
    if not result:
        raise HTTPException(status_code=404, detail="Not found")
    return _map_order_response(result)


@router.patch("/{order_id}")
def update_order(
    order_id: int,
    order_data: OrderUpdate,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    repo: OrderRepository = Depends(get_order_repo),
    backdate_log_repo: OrderSchedulingStartBackdateLogRepository = Depends(
        get_order_scheduling_start_backdate_log_repo
    ),
):
    """注文を更新

    customer_id 変更時の order_attachments.customer_id 同期（実添付行・
    メール/PDF起票のステージング行の双方）は、orders.customer_id の UPDATE と
    同一トランザクションで実行される DB トリガー
    (sync_order_attachments_customer_id, Issue #315) が担う。

    メール起票の下書きで product_id が修正された場合は、その対応を製品別名辞書
    （product_name_aliases）へ記録する（Issue #347）。あわせて、担当者が一度でも
    product_id に手を入れた注文は product_id_manually_corrected=true を立てて
    「手動修正済み」として恒久的にマークする（Issue #350。承認依頼時の
    自動マッチ反映フックが二重記録しないための判定に使う）。
    """
    logger.info(f"Updating order {order_id}")
    backdated = _assert_scheduling_start_date_allowed(
        order_data.scheduling_start_date, tenant_id, user_id, client
    )
    order_before = repo.get_by_id(order_id)

    update_dict = order_data.model_dump(exclude_unset=True)
    if (
        "product_id" in update_dict
        and order_before is not None
        and update_dict["product_id"] != order_before.get("product_id")
        and not order_before.get("product_id_manually_corrected")
    ):
        # 一度 true になったら false へは戻さない（Issue #350）
        update_dict["product_id_manually_corrected"] = True

    # スケジュール条件（製品・数量・希望納期・作業開始日）が実質変化したら、
    # 実行済みのシミュレーション結果を無効化する（Issue #394-A / #392 統合）。
    # 既に無効な項目は書き込まず、余計な UPDATE を避ける。
    if order_before is not None and any(
        field in update_dict and update_dict[field] != order_before.get(field)
        for field in _SIM_INVALIDATING_ORDER_FIELDS
    ):
        if order_before.get("simulated_deadline") is not None:
            update_dict["simulated_deadline"] = None
        if order_before.get("is_scheduled"):
            update_dict["is_scheduled"] = False

    try:
        result = repo.update(order_id, update_dict)
    except DuplicateRecordError as e:
        # orders には UNIQUE が2本ある。編集ダイアログはどちらの列も変更できるため、
        # 制約名で振り分ける（`_duplicate_order_conflict_exception` の判定ロジック参照）。
        # 衝突判定には「変更後の値」を使う必要があるため、update_dict にない項目は
        # order_before の値で補う。
        before = order_before or {}
        raise _duplicate_order_conflict_exception(
            e,
            client=client,
            order_repo=repo,
            tenant_id=tenant_id,
            customer_id=update_dict.get("customer_id", before.get("customer_id")),
            product_id=update_dict.get("product_id", before.get("product_id")),
            deadline_date=update_dict.get("deadline_date", before.get("deadline_date")),
            extracted_product_name=before.get("extracted_product_name"),
            exclude_order_id=order_id,
        ) from None
    if not result:
        raise HTTPException(status_code=404, detail="Not found")

    if backdated and order_data.scheduling_start_date:
        _log_scheduling_start_backdate_safely(
            backdate_log_repo,
            tenant_id,
            order_id,
            order_data.scheduling_start_date,
            user_id,
            "update",
        )

    record_correction_if_applicable(client, tenant_id, order_before, result, user_id)

    return _map_order_response(result)


@router.delete("/{order_id}")
def delete_order(order_id: int, repo: OrderRepository = Depends(get_order_repo)):
    """注文を削除"""
    logger.info(f"Deleting order {order_id}")
    success = repo.delete(order_id)
    if not success:
        raise HTTPException(status_code=404, detail="Not found")
    return {"status": "deleted"}
