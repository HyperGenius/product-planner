# routers/master/process_routings.py
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_current_user_role,
    get_product_repo,
    get_supabase_client,
)
from app.models.master import RoutingCreate, RoutingUpdate
from app.repositories.supa_infra.master.product_repo import ProductRepository
from app.utils.logger import get_logger
from supabase import Client  # type: ignore

process_routing_router = APIRouter(
    prefix="/process-routings", tags=["Master (Process Routings)"]
)

logger = get_logger(__name__)


@process_routing_router.post("")
def create_process_routing(
    routing_data: RoutingCreate,
    tenant_id: str = Depends(get_current_tenant_id),
    repo: ProductRepository = Depends(get_product_repo),
):
    """工程順序を新規作成"""
    logger.info(f"Creating process routing {routing_data}")
    return repo.create_routing(routing_data.with_tenant_id(tenant_id))


@process_routing_router.get("")
def get_process_routings(
    product_id: int = Query(..., description="製品ID"),
    repo: ProductRepository = Depends(get_product_repo),
):
    """製品IDに紐づく工程順序を取得"""
    logger.info(f"Fetching process routings for product {product_id}")
    return repo.get_routings_by_product(product_id)


@process_routing_router.get("/{routing_id}")
def get_process_routing(
    routing_id: int, repo: ProductRepository = Depends(get_product_repo)
):
    """工程順序を1件取得"""
    logger.info(f"Fetching process routing {routing_id}")
    result = repo.get_routing_by_id(routing_id)
    if not result:
        raise HTTPException(status_code=404, detail="Not found")
    return result


@process_routing_router.patch("/{routing_id}")
def update_process_routing(
    routing_id: int,
    routing_data: RoutingUpdate,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    repo: ProductRepository = Depends(get_product_repo),
):
    """工程順序を更新。is_confirmed の変更は admin のみ可能"""
    logger.info(f"Updating process routing {routing_id}")

    update_dict = routing_data.model_dump(exclude_unset=True)

    if "is_confirmed" in update_dict:
        role = get_current_user_role(tenant_id, user_id, client)
        if role != "admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="工程の確定・確定取消は管理者のみ操作できます",
            )
        if update_dict["is_confirmed"] is True:
            update_dict["confirmed_by"] = user_id
            update_dict["confirmed_at"] = datetime.now(UTC).isoformat()
        else:
            update_dict["confirmed_by"] = None
            update_dict["confirmed_at"] = None

    result = repo.update_routing(routing_id, update_dict)
    if not result:
        raise HTTPException(status_code=404, detail="Not found")
    return result


@process_routing_router.delete("/{routing_id}")
def delete_process_routing(
    routing_id: int, repo: ProductRepository = Depends(get_product_repo)
):
    """工程順序を削除"""
    logger.info(f"Deleting process routing {routing_id}")
    success = repo.delete_routing(routing_id)
    if not success:
        raise HTTPException(status_code=404, detail="Not found")
    return {"status": "deleted"}
