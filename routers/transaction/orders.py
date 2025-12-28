# routers/transaction/orders.py
from fastapi import APIRouter, Depends, HTTPException

from dependencies import get_current_tenant_id, get_order_repo
from models.transaction.order_schema import (
    OrderCreate,
    OrderUpdate,
)
from repositories.supa_infra.transaction.order_repo import OrderRepository
from utils.logger import get_logger

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
