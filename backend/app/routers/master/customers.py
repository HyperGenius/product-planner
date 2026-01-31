# routers/master/customers.py
from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import get_current_tenant_id, get_customer_repo
from app.models.master import CustomerCreateSchema, CustomerUpdateSchema
from app.repositories.supa_infra.master.customer_repo import CustomerRepository
from app.utils.logger import get_logger

customer_router = APIRouter(prefix="/customers", tags=["Master (Customers)"])

logger = get_logger(__name__)


@customer_router.post("/")
def create_customer(
    customer_data: CustomerCreateSchema,
    tenant_id: str = Depends(get_current_tenant_id),
    repo: CustomerRepository = Depends(get_customer_repo),
):
    """顧客を新規作成"""
    logger.info(f"Creating customer {customer_data}")
    return repo.create(customer_data.with_tenant_id(tenant_id))


@customer_router.get("/")
def get_customers(repo: CustomerRepository = Depends(get_customer_repo)):
    """顧客を全件取得"""
    logger.info("Fetching all customers")
    return repo.get_all()


@customer_router.get("/{customer_id}")
def get_customer(customer_id: int, repo: CustomerRepository = Depends(get_customer_repo)):
    """顧客を1件取得"""
    logger.info(f"Fetching customer {customer_id}")
    return repo.get_by_id(customer_id)


@customer_router.patch("/{customer_id}")
def update_customer(
    customer_id: int,
    customer_data: CustomerUpdateSchema,
    repo: CustomerRepository = Depends(get_customer_repo),
):
    """顧客を更新"""
    logger.info(f"Updating customer {customer_id}")
    return repo.update(customer_id, customer_data.model_dump(exclude_unset=True))


@customer_router.delete("/{customer_id}")
def delete_customer(
    customer_id: int, repo: CustomerRepository = Depends(get_customer_repo)
):
    """顧客を削除"""
    logger.info(f"Deleting customer {customer_id}")
    success = repo.delete(customer_id)
    if not success:
        raise HTTPException(status_code=404, detail="Not found")
    return {"status": "deleted"}
