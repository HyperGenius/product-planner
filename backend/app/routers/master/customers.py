# routers/master/customers.py
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import get_current_tenant_id, get_customer_repo
from app.models.master import CustomerCreateSchema, CustomerUpdateSchema
from app.repositories.supa_infra.master.customer_repo import CustomerRepository
from app.utils.logger import get_logger

customer_router = APIRouter(prefix="/customers", tags=["Master (Customers)"])

logger = get_logger(__name__)

# 抽出指示の本文は platform_admin 専用の API（customer_extraction_prompt.py）だけが返す（Issue #602）
_HIDDEN_COLUMNS = ("order_extraction_prompt",)


def _public_customer(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {key: value for key, value in row.items() if key not in _HIDDEN_COLUMNS}


@customer_router.post("")
def create_customer(
    customer_data: CustomerCreateSchema,
    tenant_id: str = Depends(get_current_tenant_id),
    repo: CustomerRepository = Depends(get_customer_repo),
):
    """顧客を新規作成"""
    logger.info(f"Creating customer {customer_data}")
    return _public_customer(repo.create(customer_data.with_tenant_id(tenant_id)))


@customer_router.get("")
def get_customers(repo: CustomerRepository = Depends(get_customer_repo)):
    """顧客を全件取得"""
    logger.info("Fetching all customers")
    return [_public_customer(row) for row in repo.get_all()]


@customer_router.get("/{customer_id}")
def get_customer(
    customer_id: int, repo: CustomerRepository = Depends(get_customer_repo)
):
    """顧客を1件取得"""
    logger.info(f"Fetching customer {customer_id}")
    return _public_customer(repo.get_by_id(customer_id))


@customer_router.patch("/{customer_id}")
def update_customer(
    customer_id: int,
    customer_data: CustomerUpdateSchema,
    repo: CustomerRepository = Depends(get_customer_repo),
):
    """顧客を更新。専用の「確定」ボタンは設けず、保存するだけで下書きが解除される
    （status は常に 'active' に上書きする）"""
    logger.info(f"Updating customer {customer_id}")
    update_data = customer_data.model_dump(exclude_unset=True)
    update_data["status"] = "active"
    return _public_customer(repo.update(customer_id, update_data))


@customer_router.delete("/{customer_id}")
def delete_customer(
    customer_id: int, repo: CustomerRepository = Depends(get_customer_repo)
):
    """顧客を削除"""
    logger.info(f"Deleting customer {customer_id}")
    try:
        success = repo.delete(customer_id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from None
    if not success:
        raise HTTPException(status_code=404, detail="Not found")
    return {"status": "deleted"}
