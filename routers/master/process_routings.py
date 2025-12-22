from fastapi import APIRouter, HTTPException, Depends, Query
from repositories.supabase.master.product_repo import ProductRepository
from models.master import RoutingCreate, RoutingUpdate
from dependencies import get_product_repo, get_current_tenant_id
from utils.logger import get_logger

process_routing_router = APIRouter(
    prefix="/process-routings", tags=["Master (Process Routings)"]
)

logger = get_logger(__name__)


@process_routing_router.post("/")
def create_process_routing(
    routing_data: RoutingCreate,
    tenant_id: str = Depends(get_current_tenant_id),
    repo: ProductRepository = Depends(get_product_repo),
):
    """工程順序を新規作成"""
    logger.info(f"Creating process routing {routing_data}")
    return repo.create_routing(routing_data.with_tenant_id(tenant_id))


@process_routing_router.get("/")
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
    repo: ProductRepository = Depends(get_product_repo),
):
    """工程順序を更新"""
    logger.info(f"Updating process routing {routing_id}")
    result = repo.update_routing(
        routing_id, routing_data.model_dump(exclude_unset=True)
    )
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
