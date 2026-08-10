# routers/master/products.py
from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_current_user_role,
    get_product_repo,
    get_supabase_client,
)
from app.models.master import ProductCreateSchema, ProductUpdateSchema
from app.repositories.supa_infra.master.product_repo import ProductRepository
from app.utils.logger import get_logger
from supabase import Client  # type: ignore

product_router = APIRouter(prefix="/products", tags=["Master (Products)"])

logger = get_logger(__name__)


@product_router.post("")
def create_product(
    product_data: ProductCreateSchema,  # Pydanticモデル
    tenant_id: str = Depends(get_current_tenant_id),
    repo: ProductRepository = Depends(get_product_repo),
):
    """製品を新規作成"""
    logger.info(f"Creating product {product_data}")
    return repo.create(product_data.with_tenant_id(tenant_id))


@product_router.get("")
def get_products(repo: ProductRepository = Depends(get_product_repo)):
    """製品を全件取得"""
    logger.info("Fetching all products")
    return repo.get_all()


@product_router.get("/{product_id}")
def get_product(product_id: int, repo: ProductRepository = Depends(get_product_repo)):
    """製品を1件取得"""
    logger.info(f"Fetching product {product_id}")
    return repo.get_by_id(product_id)


@product_router.patch("/{product_id}")
def update_product(
    product_id: int,
    product_data: ProductUpdateSchema,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    repo: ProductRepository = Depends(get_product_repo),
):
    """製品を更新。is_active の変更は president / platform_admin のみ可能"""
    logger.info(f"Updating product {product_id}")

    update_dict = product_data.model_dump(exclude_unset=True)

    if "is_active" in update_dict:
        role = get_current_user_role(tenant_id, user_id, client)
        if role not in ("president", "platform_admin"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="製品の有効/無効の切り替えは president または platform_admin のみ操作できます",
            )

    return repo.update(product_id, update_dict)


@product_router.delete("/{product_id}")
def delete_product(
    product_id: int, repo: ProductRepository = Depends(get_product_repo)
):
    """製品を削除"""
    logger.info(f"Deleting product {product_id}")
    success = repo.delete(product_id)
    if not success:
        raise HTTPException(status_code=404, detail="Not found")
    return {"status": "deleted"}
