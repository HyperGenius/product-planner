# routers/transaction/orders.py
from datetime import UTC, date, datetime
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import (
    get_current_tenant_id,
    get_equipment_repo,
    get_order_repo,
    get_product_repo,
    get_schedule_repo,
    get_supabase_admin_client,
    get_supabase_client,
)
from app.models.transaction.order_schema import (
    OrderAttachmentResponse,
    OrderCreate,
    OrderSimulateRequest,
    OrderSplitRequest,
    OrderUpdate,
)
from app.repositories.supa_infra.common.scheduling_settings_repo import (
    SchedulingSettingsRepository,
)
from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.repositories.supa_infra.master.equipment_repo import EquipmentRepository
from app.repositories.supa_infra.master.product_repo import ProductRepository
from app.repositories.supa_infra.transaction.order_repo import OrderRepository
from app.repositories.supa_infra.transaction.schedule_repo import ScheduleRepository
from app.scheduler_logic import RoutingUnconfirmedError, schedule_order
from app.services.attachment_service import create_signed_url
from app.services.simulation_service import build_simulate_response
from app.utils.logger import get_logger
from supabase import Client

orders_router = APIRouter(prefix="/orders", tags=["Transaction (Orders)"])

logger = get_logger(__name__)


def _map_order_response(order: dict) -> dict:
    """
    データベース形式（order_number, deadline_date）を
    フロントエンド形式（order_no, desired_deadline）にマッピングする。
    """
    mapped = dict(order)
    if "order_number" in mapped:
        mapped["order_no"] = mapped.pop("order_number")
    if "deadline_date" in mapped:
        mapped["desired_deadline"] = mapped.pop("deadline_date")
    if "order_date" in mapped:
        mapped["created_at"] = mapped.pop("order_date")
    return mapped


@orders_router.post("")
def create_order(
    order_data: OrderCreate,
    tenant_id: str = Depends(get_current_tenant_id),
    repo: OrderRepository = Depends(get_order_repo),
):
    """注文を新規作成"""
    logger.info(f"Creating order {order_data}")
    try:
        result = repo.create(order_data.with_tenant_id(tenant_id))
        return _map_order_response(result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None


@orders_router.get("")
def get_orders(repo: OrderRepository = Depends(get_order_repo)):
    """注文を全件取得（has_no_routings / has_unconfirmed_routings フラグ付き）"""
    logger.info("Fetching all orders")
    results = repo.get_all_with_routing_status()
    return [_map_order_response(order) for order in results]


@orders_router.get("/unconfirmed-routing-queue")
def get_unconfirmed_routing_queue(
    repo: OrderRepository = Depends(get_order_repo),
    product_repo: ProductRepository = Depends(get_product_repo),
):
    """工程未確定の draft 注文を残バッファ昇順で返す専門家キュー"""
    logger.info("Fetching unconfirmed routing queue")
    today = date.today()

    all_orders = repo.get_all_with_routing_status()
    draft_unconfirmed = [
        o
        for o in all_orders
        if o.get("status") == "draft" and o.get("has_unconfirmed_routings")
    ]

    products = product_repo.get_all()
    product_name_map = {p["id"]: p.get("name", "不明") for p in products}

    product_ids = [o["product_id"] for o in draft_unconfirmed if o.get("product_id")]
    unconfirmed_counts = product_repo.get_unconfirmed_routing_counts(product_ids)

    items = []
    for order in draft_unconfirmed:
        deadline = order.get("deadline_date")
        buffer_days: int | None = (
            (date.fromisoformat(deadline) - today).days if deadline else None
        )
        pid: int | None = order.get("product_id")
        items.append(
            {
                "order_id": order["id"],
                "order_no": order.get("order_number"),
                "product_name": product_name_map.get(pid, "不明")
                if pid is not None
                else "不明",
                "buffer_days": buffer_days,
                "desired_deadline": deadline,
                "unconfirmed_routing_count": unconfirmed_counts.get(pid, 0)
                if pid is not None
                else 0,
            }
        )

    items.sort(key=lambda x: (x["buffer_days"] is None, x["buffer_days"] or 0))
    return {"count": len(items), "items": items}


@orders_router.get("/{order_id}")
def get_order(order_id: int, repo: OrderRepository = Depends(get_order_repo)):
    """注文を1件取得（has_no_routings / has_unconfirmed_routings フラグ付き）"""
    logger.info(f"Fetching order {order_id}")
    result = repo.get_by_id_with_routing_status(order_id)
    if not result:
        raise HTTPException(status_code=404, detail="Not found")
    return _map_order_response(result)


@orders_router.get(
    "/{order_id}/attachments", response_model=list[OrderAttachmentResponse]
)
def get_order_attachments(
    order_id: int,
    admin_client: Client = Depends(get_supabase_admin_client),
):
    """注文に紐づく添付ファイル一覧を署名付きURLと共に返す"""
    logger.info(f"Fetching attachments for order {order_id}")
    result = (
        admin_client.table(SupabaseTableName.ORDER_ATTACHMENTS.value)
        .select("*")
        .eq("order_id", order_id)
        .order("created_at")
        .execute()
    )
    rows = cast(list[dict[str, Any]], result.data or [])
    attachments = []
    for row in rows:
        signed_url = ""
        if row.get("storage_path"):
            try:
                signed_url = create_signed_url(admin_client, row["storage_path"])
            except Exception:
                logger.warning(
                    f"Failed to generate signed URL for {row['storage_path']}"
                )
        attachments.append(
            OrderAttachmentResponse(
                id=str(row["id"]),
                order_id=row["order_id"],
                storage_path=row.get("storage_path", ""),
                original_filename=row.get("original_filename", ""),
                content_type=row.get("content_type"),
                size_bytes=row.get("size_bytes"),
                parse_status=row["parse_status"],
                signed_url=signed_url,
                created_at=str(row["created_at"]),
            )
        )
    return attachments


@orders_router.patch("/{order_id}")
def update_order(
    order_id: int,
    order_data: OrderUpdate,
    repo: OrderRepository = Depends(get_order_repo),
):
    """注文を更新"""
    logger.info(f"Updating order {order_id}")
    result = repo.update(order_id, order_data.model_dump(exclude_unset=True))
    if not result:
        raise HTTPException(status_code=404, detail="Not found")
    return _map_order_response(result)


@orders_router.delete("/{order_id}")
def delete_order(order_id: int, repo: OrderRepository = Depends(get_order_repo)):
    """注文を削除"""
    logger.info(f"Deleting order {order_id}")
    success = repo.delete(order_id)
    if not success:
        raise HTTPException(status_code=404, detail="Not found")
    return {"status": "deleted"}


@orders_router.post("/{order_id}/split")
def split_order(
    order_id: int,
    split_data: OrderSplitRequest,
    tenant_id: str = Depends(get_current_tenant_id),
    repo: OrderRepository = Depends(get_order_repo),
    client: Client = Depends(get_supabase_client),
):
    """
    誤って1件にマージされた下書き注文を、同じ source_attachment_id を参照する
    N件の下書き注文に手動分割する（Issue #280）。
    """
    logger.info(f"Splitting order {order_id} into {len(split_data.line_items)} items")
    order = repo.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.get("status") != "draft":
        raise HTTPException(status_code=400, detail="下書き状態の注文のみ分割できます")
    source_attachment_id = order.get("source_attachment_id")
    if not source_attachment_id:
        raise HTTPException(
            status_code=400,
            detail="分割元の受注ソース（メール／添付ファイル）が不明なため分割できません",
        )

    source_row = cast(
        "dict[str, Any] | None",
        client.table(SupabaseTableName.ORDER_ATTACHMENTS.value)
        .select("*")
        .eq("id", source_attachment_id)
        .single()
        .execute()
        .data,
    )

    created_orders: list[dict] = []
    try:
        for item in split_data.line_items:
            new_order = repo.create(
                {
                    "tenant_id": tenant_id,
                    "product_id": item.product_id,
                    "quantity": item.quantity,
                    "deadline_date": item.deadline_date,
                    "customer_id": item.customer_id
                    if item.customer_id is not None
                    else order.get("customer_id"),
                    "customer_certainty": item.customer_certainty
                    or order.get("customer_certainty"),
                    "status": "draft",
                    "source_type": order.get("source_type"),
                    "source_raw": order.get("source_raw"),
                    "extracted_product_name": item.extracted_product_name,
                    "source_attachment_id": source_attachment_id,
                }
            )
            created_orders.append(new_order)

            client.table(SupabaseTableName.ORDER_ATTACHMENTS.value).insert(
                {
                    "order_id": new_order["id"],
                    "tenant_id": tenant_id,
                    "storage_path": source_row.get("storage_path", "")
                    if source_row
                    else "",
                    "original_filename": source_row.get("original_filename", "")
                    if source_row
                    else "",
                    "content_type": source_row.get("content_type")
                    if source_row
                    else None,
                    "size_bytes": source_row.get("size_bytes") if source_row else None,
                    "parse_status": "success"
                    if source_row and source_row.get("storage_path")
                    else "failed_no_attachment",
                }
            ).execute()
    except ValueError as e:
        for created in created_orders:
            repo.delete(created["id"])
        raise HTTPException(status_code=400, detail=str(e)) from None

    repo.delete(order_id)

    return {
        "original_order_id": order_id,
        "created_orders": [_map_order_response(o) for o in created_orders],
    }


def get_settings_repo(
    client: Client = Depends(get_supabase_client),
) -> SchedulingSettingsRepository:
    return SchedulingSettingsRepository(client)


@orders_router.post("/simulate")
def simulate_schedule_without_id(
    order_data: OrderSimulateRequest,
    tenant_id: str = Depends(get_current_tenant_id),
    product_repo: ProductRepository = Depends(get_product_repo),
    equipment_repo: EquipmentRepository = Depends(get_equipment_repo),
    schedule_repo: ScheduleRepository = Depends(get_schedule_repo),
    settings_repo: SchedulingSettingsRepository = Depends(get_settings_repo),
):
    """
    スケジュールのシミュレーションを行う（DB保存なし）。
    新規注文作成時にorder_idなしで呼び出される。
    """
    logger.info(
        f"Simulating schedule with product_id={order_data.product_id}, quantity={order_data.quantity}"
    )

    try:
        result = schedule_order(
            order_id=None,
            product_id=order_data.product_id,
            quantity=order_data.quantity,
            product_repo=product_repo,
            schedule_repo=schedule_repo,
            tenant_id=tenant_id,
            dry_run=True,
            standalone=order_data.standalone,
            settings_repo=settings_repo,
        )
        return build_simulate_response(
            result, order_data.deadline_date, product_repo, equipment_repo
        )
    except RoutingUnconfirmedError as e:
        return {
            "routing_status": "no_routing" if e.no_routing else "unconfirmed",
            "calculated_deadline": None,
            "is_feasible": None,
            "process_schedules": [],
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None


@orders_router.post("/{order_id}/simulate")
def simulate_schedule(
    order_id: int,
    tenant_id: str = Depends(get_current_tenant_id),
    order_repo: OrderRepository = Depends(get_order_repo),
    product_repo: ProductRepository = Depends(get_product_repo),
    equipment_repo: EquipmentRepository = Depends(get_equipment_repo),
    schedule_repo: ScheduleRepository = Depends(get_schedule_repo),
    settings_repo: SchedulingSettingsRepository = Depends(get_settings_repo),
):
    """
    スケジュールのシミュレーションを行う（DB保存なし）。
    既存の注文をベースにシミュレーションを実行。
    """
    logger.info(f"Simulating schedule for order {order_id}")
    order = order_repo.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    try:
        result = schedule_order(
            order_id=order["id"],
            product_id=order["product_id"],
            quantity=order["quantity"],
            product_repo=product_repo,
            schedule_repo=schedule_repo,
            tenant_id=tenant_id,
            dry_run=True,
            settings_repo=settings_repo,
        )
        order_repo.mark_as_scheduled(order_id)
        return build_simulate_response(
            result, order.get("deadline_date"), product_repo, equipment_repo
        )
    except RoutingUnconfirmedError as e:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "no_routing" if e.no_routing else "routing_unconfirmed",
            },
        ) from None
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None


@orders_router.post("/{order_id}/confirm")
def confirm_order(
    order_id: int,
    tenant_id: str = Depends(get_current_tenant_id),
    order_repo: OrderRepository = Depends(get_order_repo),
    product_repo: ProductRepository = Depends(get_product_repo),
    schedule_repo: ScheduleRepository = Depends(get_schedule_repo),
    settings_repo: SchedulingSettingsRepository = Depends(get_settings_repo),
):
    """
    スケジュールを確定・保存し、注文ステータスをconfirmedにする。
    """
    logger.info(f"Confirming order {order_id}")
    order = order_repo.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    try:
        # 1. 実際に保存 (dry_run=False)
        result = schedule_order(
            order_id=order["id"],
            product_id=order["product_id"],
            quantity=order["quantity"],
            product_repo=product_repo,
            schedule_repo=schedule_repo,
            tenant_id=tenant_id,
            dry_run=False,
            settings_repo=settings_repo,
            desired_deadline=order.get("deadline_date"),
        )

        # 2. ステータス更新 & is_scheduled フラグ更新
        last_end = max(s["end_datetime"] for s in result)
        confirmed_deadline = datetime.fromisoformat(last_end).date().isoformat()
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
    except RoutingUnconfirmedError as e:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "routing_unconfirmed",
                "desired_deadline": e.desired_deadline,
            },
        ) from None
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
