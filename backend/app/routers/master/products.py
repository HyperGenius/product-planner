# routers/master/products.py
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, status
from postgrest.exceptions import APIError

from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_current_user_role,
    get_product_name_alias_history_repo,
    get_product_name_alias_repo,
    get_product_repo,
    get_supabase_client,
)
from app.models.master import (
    ProductCreateSchema,
    ProductNameAliasHistoryResponse,
    ProductNameAliasUpdateSchema,
    ProductUpdateSchema,
)
from app.repositories.supa_infra.master.product_name_alias_repo import (
    ProductNameAliasHistoryRepository,
    ProductNameAliasRepository,
)
from app.repositories.supa_infra.master.product_repo import ProductRepository
from app.services.product_alias_service import record_direct_alias_change
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

    現在も有効な別名（product_name_aliases に行が残り、かつこの製品を指している）
    については、その最新の履歴行にのみ alias_id を付与する（Issue #351 の
    付け替え / 削除アクションの対象。過去行や、既に別製品へ付け替え済み・
    削除済みのエントリには付かない）。
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

    # 現在この製品を指している別名を (customer_id, raw_text) → alias_id で引けるように
    alias_rows = (
        client.table("product_name_aliases")
        .select("id, customer_id, raw_text")
        .eq("product_id", product_id)
        .execute()
    )
    live_alias_map: dict[tuple[Any, str], str] = {
        (r.get("customer_id"), r["raw_text"]): str(r["id"])
        for r in cast(list[dict[str, Any]], alias_rows.data or [])
    }

    responses: list[ProductNameAliasHistoryResponse] = []
    # history は changed_at 降順。各別名の最新行にだけ alias_id を割り当て、
    # 以降の古い行には付けない。
    seen_keys: set[tuple[Any, str]] = set()
    for h in history:
        key = (h.get("customer_id"), h["raw_text"])
        alias_id: str | None = None
        if key not in seen_keys and key in live_alias_map:
            alias_id = live_alias_map[key]
        seen_keys.add(key)

        responses.append(
            ProductNameAliasHistoryResponse(
                id=str(h["id"]),
                alias_id=alias_id,
                product_id=h.get("product_id"),
                product_name_snapshot=h["product_name_snapshot"],
                customer_id=h.get("customer_id"),
                customer_name_snapshot=h["customer_name_snapshot"],
                raw_text=h["raw_text"],
                changed_by=h["changed_by"],
                changed_by_full_name=profiles_map.get(h["changed_by"], {}).get(
                    "full_name"
                ),
                action=h["action"],
                source=h.get("source") or "manual_correction",
                source_order_id=h.get("source_order_id"),
                source_order_label_snapshot=h["source_order_label_snapshot"],
                changed_at=str(h["changed_at"]),
            )
        )
    return responses


def _load_alias_or_404(
    alias_repo: ProductNameAliasRepository, product_id: int, alias_id: str
) -> dict[str, Any]:
    """URL の {product_id}/{alias_id} に一致する別名エントリを取得する。

    別名が存在しない、または現在の向き先が {product_id} でない場合は 404。
    """
    alias = alias_repo.get_alias_by_id(alias_id)
    if not alias or alias.get("product_id") != product_id:
        raise HTTPException(status_code=404, detail="別名エントリが見つかりません")
    return cast(dict[str, Any], alias)


@product_router.patch("/{product_id}/aliases/{alias_id}")
def update_product_name_alias(
    product_id: int,
    alias_id: str,
    payload: ProductNameAliasUpdateSchema,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    alias_repo: ProductNameAliasRepository = Depends(get_product_name_alias_repo),
    product_repo: ProductRepository = Depends(get_product_repo),
):
    """表記ゆれ辞書エントリの向き先製品を別の製品へ付け替える（Issue #351）。

    #350 で自動反映される未検証エントリ（source='auto_match_unreviewed'）を、
    誤りに気づいた担当者がその場で直せるようにする経路。別名登録に承認は不要
    という #347 の方針を踏襲し、president の承認フローを経由しない
    （order_handler を含むテナントメンバーなら実行可能）。
    """
    logger.info(f"Repointing alias {alias_id} of product {product_id}")
    alias = _load_alias_or_404(alias_repo, product_id, alias_id)

    try:
        target = product_repo.get_by_id(payload.product_id)
    except APIError:
        target = None
    if not target:
        raise HTTPException(status_code=404, detail="付け替え先の製品が見つかりません")

    # 監査履歴を先に残す（付け替え自体が失敗しても履歴が欠けないように）。
    record_direct_alias_change(
        client,
        tenant_id,
        alias_row=alias,
        action="updated",
        changed_by=user_id,
        target_product_id=payload.product_id,
    )
    return alias_repo.update_product_id(alias_id, payload.product_id)


@product_router.delete("/{product_id}/aliases/{alias_id}")
def delete_product_name_alias(
    product_id: int,
    alias_id: str,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    alias_repo: ProductNameAliasRepository = Depends(get_product_name_alias_repo),
):
    """表記ゆれ辞書エントリを削除する（Issue #351）。

    削除後、その raw_text は辞書ヒットせず通常のマッチング
    （products.code 完全一致 → pg_trgm 曖昧検索）にフォールバックする。
    監査目的で product_name_alias_history には action='deleted' の行を残す。
    承認不要・order_handler 権限で実行可能。
    """
    logger.info(f"Deleting alias {alias_id} of product {product_id}")
    alias = _load_alias_or_404(alias_repo, product_id, alias_id)

    # 履歴を先に残してから辞書行を削除する（削除しても監査履歴は残す）。
    record_direct_alias_change(
        client,
        tenant_id,
        alias_row=alias,
        action="deleted",
        changed_by=user_id,
    )
    alias_repo.delete_by_id(alias_id)
    return {"status": "deleted"}


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
