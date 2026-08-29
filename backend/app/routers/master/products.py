# routers/master/products.py
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_current_user_role,
    get_product_name_alias_history_repo,
    get_product_repo,
    get_supabase_client,
)
from app.models.master import (
    ProductCreateSchema,
    ProductNameAliasHistoryResponse,
    ProductUpdateSchema,
)
from app.repositories.supa_infra.master.product_name_alias_repo import (
    ProductNameAliasHistoryRepository,
)
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


@product_router.get(
    "/{product_id}/aliases", response_model=list[ProductNameAliasHistoryResponse]
)
def get_product_name_alias_history(
    product_id: int,
    client: Client = Depends(get_supabase_client),
    alias_history_repo: ProductNameAliasHistoryRepository = Depends(
        get_product_name_alias_history_repo
    ),
):
    """製品名の表記ゆれ修正履歴を取得する（Issue #347）。

    登録者（changed_by）を表示名に、トリガーとなった注文（source_order_id）を
    注文番号に解決した集約レスポンスを返す（生の product_name_alias_history
    ダンプではない）。
    """
    logger.info(f"Fetching product name alias history for product {product_id}")
    history = alias_history_repo.get_by_product_id(product_id)
    if not history:
        return []

    actor_ids = list({h["changed_by"] for h in history})
    profiles_res = (
        client.table("profiles").select("id, full_name").in_("id", actor_ids).execute()
    )
    profiles_map = {
        p["id"]: p for p in cast(list[dict[str, Any]], profiles_res.data or [])
    }

    return [
        ProductNameAliasHistoryResponse(
            id=str(h["id"]),
            product_id=h.get("product_id"),
            product_name_snapshot=h["product_name_snapshot"],
            customer_id=h.get("customer_id"),
            customer_name_snapshot=h["customer_name_snapshot"],
            raw_text=h["raw_text"],
            changed_by=h["changed_by"],
            changed_by_full_name=profiles_map.get(h["changed_by"], {}).get("full_name"),
            action=h["action"],
            source_order_id=h.get("source_order_id"),
            source_order_label_snapshot=h["source_order_label_snapshot"],
            changed_at=str(h["changed_at"]),
        )
        for h in history
    ]


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
