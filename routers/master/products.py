# routers/master/products.py
from fastapi import APIRouter, HTTPException, Depends
from repositories.supabase.master.product_repo import ProductRepository
from models.master import ProductCreateSchema, ProductUpdateSchema
from dependencies import get_product_repo, get_current_tenant_id
from utils.logger import get_logger

product_router = APIRouter(prefix="/products", tags=["Master (Products)"])

logger = get_logger(__name__)


@product_router.post("/")
def create_product(
    product_data: ProductCreateSchema,  # Pydanticモデル
    tenant_id: str = Depends(get_current_tenant_id),
    repo: ProductRepository = Depends(get_product_repo),
):
    """製品を新規作成"""
    logger.info(f"Creating product {product_data}")
    return repo.create(product_data.with_tenant_id(tenant_id))


@product_router.get("/")
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
    repo: ProductRepository = Depends(get_product_repo),
):
    """製品を更新"""
    logger.info(f"Updating product {product_id}")
    return repo.update(product_id, product_data.model_dump(exclude_unset=True))


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
