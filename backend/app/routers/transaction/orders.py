# routers/transaction/orders.py
from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import (
    get_current_tenant_id,
    get_equipment_repo,
    get_order_repo,
    get_product_repo,
    get_schedule_repo,
)
from app.models.transaction.order_schema import (
    OrderCreate,
    OrderSimulateRequest,
    OrderUpdate,
)
from app.repositories.supa_infra.master.equipment_repo import EquipmentRepository
from app.repositories.supa_infra.master.product_repo import ProductRepository
from app.repositories.supa_infra.transaction.order_repo import OrderRepository
from app.repositories.supa_infra.transaction.schedule_repo import ScheduleRepository
from app.scheduler_logic import schedule_order
from app.services.simulation_service import build_simulate_response
from app.utils.logger import get_logger

orders_router = APIRouter(prefix="/orders", tags=["Transaction (Orders)"])

logger = get_logger(__name__)


@orders_router.post("/")
def create_order(
    order_data: OrderCreate,
    tenant_id: str = Depends(get_current_tenant_id),
    repo: OrderRepository = Depends(get_order_repo),
):
    """注文を新規作成"""
    logger.info(f"Creating order {order_data}")
    return repo.create(order_data.with_tenant_id(tenant_id))


@orders_router.get("/")
def get_orders(repo: OrderRepository = Depends(get_order_repo)):
    """注文を全件取得"""
    logger.info("Fetching all orders")
    return repo.get_all()


@orders_router.get("/{order_id}")
def get_order(order_id: int, repo: OrderRepository = Depends(get_order_repo)):
    """注文を1件取得"""
    logger.info(f"Fetching order {order_id}")
    result = repo.get_by_id(order_id)
    if not result:
        raise HTTPException(status_code=404, detail="Not found")
    return result


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
    return result


@orders_router.delete("/{order_id}")
def delete_order(order_id: int, repo: OrderRepository = Depends(get_order_repo)):
    """注文を削除"""
    logger.info(f"Deleting order {order_id}")
    success = repo.delete(order_id)
    if not success:
        raise HTTPException(status_code=404, detail="Not found")
    return {"status": "deleted"}


@orders_router.post("/simulate")
def simulate_schedule_without_id(
    order_data: OrderSimulateRequest,
    tenant_id: str = Depends(get_current_tenant_id),
    product_repo: ProductRepository = Depends(get_product_repo),
    equipment_repo: EquipmentRepository = Depends(get_equipment_repo),
    schedule_repo: ScheduleRepository = Depends(get_schedule_repo),
):
    """
    スケジュールのシミュレーションを行う（DB保存なし）。
    新規注文作成時にorder_idなしで呼び出される。
    """
    logger.info(
        f"Simulating schedule with product_id={order_data.product_id}, quantity={order_data.quantity}"
    )

    try:
        # dry_run=True で実行（order_id は None）
        result = schedule_order(
            order_id=None,
            product_id=order_data.product_id,
            quantity=order_data.quantity,
            product_repo=product_repo,
            schedule_repo=schedule_repo,
            tenant_id=tenant_id,
            dry_run=True,
        )
        return build_simulate_response(
            result, order_data.deadline_date, product_repo, equipment_repo
        )
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
        # dry_run=True で実行
        result = schedule_order(
            order_id=order["id"],
            product_id=order["product_id"],
            quantity=order["quantity"],
            product_repo=product_repo,
            schedule_repo=schedule_repo,
            tenant_id=tenant_id,
            dry_run=True,
        )
        return build_simulate_response(
            result, order.get("desired_deadline"), product_repo, equipment_repo
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None


@orders_router.post("/{order_id}/confirm")
def confirm_order(
    order_id: int,
    tenant_id: str = Depends(get_current_tenant_id),
    order_repo: OrderRepository = Depends(get_order_repo),
    product_repo: ProductRepository = Depends(get_product_repo),
    schedule_repo: ScheduleRepository = Depends(get_schedule_repo),
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
        )

        # 2. ステータス更新 & is_scheduled フラグ更新
        order_repo.update(order_id, {"status": "confirmed", "is_scheduled": True})

        return {"status": "confirmed", "schedules": result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
