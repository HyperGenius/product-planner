# routers/transaction/orders.py
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import (
    get_current_tenant_id,
    get_order_repo,
    get_product_repo,
    get_schedule_repo,
)
from app.models.transaction.order_schema import (
    OrderCreate,
    OrderSimulateRequest,
    OrderUpdate,
)
from app.repositories.supa_infra.master.product_repo import ProductRepository
from app.repositories.supa_infra.transaction.order_repo import OrderRepository
from app.repositories.supa_infra.transaction.schedule_repo import ScheduleRepository
from app.scheduler_logic import schedule_order
from app.utils.logger import get_logger

orders_router = APIRouter(prefix="/orders", tags=["Transaction (Orders)"])

logger = get_logger(__name__)


def _get_process_name(product_repo: ProductRepository, routing_id: int) -> str:
    """
    工程ルーティングIDから工程名を取得する。
    """
    try:
        # routing_id から process_name を直接取得
        routing_result = (
            product_repo.client.table("process_routings")
            .select("process_name")
            .eq("id", routing_id)
            .execute()
        )

        logger.info(f"Routing query result for id={routing_id}: {routing_result.data}")

        if not routing_result.data or not isinstance(routing_result.data[0], dict):
            logger.warning(f"No routing data found for id={routing_id}")
            return "不明"

        process_name = routing_result.data[0].get("process_name")
        logger.info(f"Process name from routing: {process_name}")

        if not process_name:
            logger.warning(f"No process_name in routing {routing_id}")
            return "不明"

        return str(process_name)
    except Exception as e:
        logger.error(f"Error getting process name for routing_id={routing_id}: {e}")
        return "不明"


def _get_equipment_name(
    product_repo: ProductRepository, equipment_id: int
) -> str | None:
    """
    設備IDから設備名を取得する。
    """
    try:
        equipment = (
            product_repo.client.table("equipment")
            .select("equipment_name")
            .eq("id", equipment_id)
            .execute()
        )
        if not equipment.data or not isinstance(equipment.data[0], dict):
            return None

        return str(equipment.data[0].get("equipment_name"))
    except Exception:
        return None


def _build_simulate_response(
    schedules: list[dict],
    desired_deadline: str | None,
    product_repo: ProductRepository,
) -> dict:
    """
    スケジュール情報をフロントエンドが期待する形式に変換する。
    """
    if not schedules:
        raise ValueError("スケジュール情報が空です")

    # 最後のスケジュールの終了時刻を回答納期とする
    last_schedule = schedules[-1]
    calculated_deadline = last_schedule["end_datetime"]

    # 希望納期との比較
    is_feasible = _is_schedule_feasible(desired_deadline, calculated_deadline)

    # process_schedulesを構築（process_nameと equipment_nameを含める）
    process_schedules = _build_process_schedules(schedules, product_repo)

    return {
        "calculated_deadline": calculated_deadline,
        "is_feasible": is_feasible,
        "process_schedules": process_schedules,
    }


def _is_schedule_feasible(
    desired_deadline: str | None, calculated_deadline: str
) -> bool:
    """
    スケジュールが希望納期に間に合うか判定する。
    """
    if not desired_deadline:
        return True

    try:
        deadline_dt = datetime.fromisoformat(desired_deadline)
        calc_dt = datetime.fromisoformat(calculated_deadline)
        return calc_dt <= deadline_dt
    except ValueError:
        return True


def _build_process_schedules(
    schedules: list[dict],
    product_repo: ProductRepository,
) -> list[dict]:
    """
    スケジュール情報からプロセススケジュールを構築する。
    """
    process_schedules = []
    for schedule in schedules:
        routing_id = schedule.get("process_routing_id")
        equipment_id = schedule.get("equipment_id")

        # 工程名を取得
        process_name = "不明"
        if routing_id:
            process_name = _get_process_name(product_repo, routing_id)

        # 設備名を取得
        equipment_name = None
        if equipment_id:
            equipment_name = _get_equipment_name(product_repo, equipment_id)

        process_schedules.append(
            {
                "process_name": process_name,
                "start_time": schedule["start_datetime"],
                "end_time": schedule["end_datetime"],
                "equipment_name": equipment_name,
            }
        )

    return process_schedules


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
        return _build_simulate_response(result, order_data.deadline_date, product_repo)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None


@orders_router.post("/{order_id}/simulate")
def simulate_schedule(
    order_id: int,
    tenant_id: str = Depends(get_current_tenant_id),
    order_repo: OrderRepository = Depends(get_order_repo),
    product_repo: ProductRepository = Depends(get_product_repo),
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
        return _build_simulate_response(
            result, order.get("desired_deadline"), product_repo
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
