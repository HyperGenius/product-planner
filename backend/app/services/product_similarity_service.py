"""新規登録・編集中の品名に似た既存製品の検索（Issue #516）。

品名の読み取り・比較は重複の統合（#515）と共通の `parse_product_spec()` を使う。
計算（`select_similar_products()`）は DB から切り離した純粋関数に保ち、DB の読み込みは
`find_similar_products()` に置く。ルーターからユーザー JWT で呼ぶ（RLS 下で動く）。
"""

from collections import defaultdict
from typing import Any

from app.models.master.product_similarity_schemas import (
    SimilarProduct,
    SimilarProductsResponse,
)
from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.services.daily_report_name_matching_service import fetch_all_rows
from app.services.product_spec_parser import ProductSpec, parse_product_spec
from supabase import Client  # type: ignore

_PRODUCT_COLUMNS = "id, name, code, is_active"


def select_similar_products(
    target: ProductSpec, products: list[dict[str, Any]], exclude_id: int | None = None
) -> list[tuple[dict[str, Any], ProductSpec]]:
    """`target` と直径・長さ・材質が一致する製品を ID 順に（製品の仕様を添えて）返す。

    無効な製品も含め、`exclude_id` の製品は除く。
    """
    result: list[tuple[dict[str, Any], ProductSpec]] = []
    for product in sorted(products, key=lambda p: p["id"]):
        if exclude_id is not None and product["id"] == exclude_id:
            continue
        spec = parse_product_spec(product["name"])
        if spec is not None and target.same_size_and_material(spec):
            result.append((product, spec))
    return result


def find_similar_products(
    db: Client, tenant_id: str, name: str, exclude_id: int | None = None
) -> SimilarProductsResponse:
    """テナントの全製品（無効な製品を含む）から、入力の品名に似た製品を返す。"""
    target = parse_product_spec(name)
    if target is None:
        return SimilarProductsResponse(products=[])

    products = fetch_all_rows(
        lambda: (
            db.table(SupabaseTableName.PRODUCTS.value)
            .select(_PRODUCT_COLUMNS)
            .eq("tenant_id", tenant_id)
            .order("id")
        )
    )
    matched = select_similar_products(target, products, exclude_id)
    if not matched:
        return SimilarProductsResponse(products=[])

    ids = [p["id"] for p, _ in matched]
    routings = fetch_all_rows(
        lambda: (
            db.table(SupabaseTableName.PROCESS_ROUTINGS.value)
            .select("id, product_id, is_confirmed")
            .eq("tenant_id", tenant_id)
            .in_("product_id", ids)
            .order("id")
        )
    )
    routings_by_product: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for routing in routings:
        routings_by_product[routing["product_id"]].append(routing)

    return SimilarProductsResponse(
        products=[
            SimilarProduct(
                id=product["id"],
                name=product["name"],
                code=product.get("code"),
                is_active=product["is_active"],
                prefix=spec.prefix,
                prefix_differs=spec.prefix_key != target.prefix_key,
                has_process=bool(routings_by_product[product["id"]]),
                has_unconfirmed_process=any(
                    not r.get("is_confirmed", False)
                    for r in routings_by_product[product["id"]]
                ),
            )
            for product, spec in matched
        ]
    )
