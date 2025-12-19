# routers/master/products.py
from fastapi import APIRouter, HTTPException, Depends
from repositories.supabase.master.product_repo import ProductRepository
from models.master import ProductCreateSchema, ProductUpdateSchema
from dependencies import get_product_repo

product_router = APIRouter(prefix="/products", tags=["Master (Products)"])


@product_router.post("/")
def create_product(
    product_data: ProductCreateSchema,  # Pydanticモデル
    repo: ProductRepository = Depends(get_product_repo),
):
    """製品を新規作成"""
    return repo.create(product_data.model_dump())


@product_router.patch("/{product_id}")
def update_product(
    product_id: int,
    product_data: ProductUpdateSchema,
    repo: ProductRepository = Depends(get_product_repo),
):
    """製品を更新"""
    return repo.update(product_id, product_data.model_dump(exclude_unset=True))


@product_router.delete("/{product_id}")
def delete_product(
    product_id: int, repo: ProductRepository = Depends(get_product_repo)
):
    """製品を削除"""
    success = repo.delete(product_id)
    if not success:
        raise HTTPException(status_code=404, detail="Not found")
    return {"status": "deleted"}
