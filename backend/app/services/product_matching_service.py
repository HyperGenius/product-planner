import os
from typing import Any, cast

from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.utils.logger import get_logger
from supabase import Client

logger = get_logger(__name__)

_THRESHOLD = float(os.environ.get("PRODUCT_MATCH_THRESHOLD", "0.3"))
_TOP_N = int(os.environ.get("PRODUCT_MATCH_TOP_N", "5"))


def match_product_by_code(db: Client, tenant_id: str, code: str) -> int | None:
    """
    品番 (products.code) の完全一致で製品を検索する。
    一致する製品が唯一存在すればその product_id を返し、それ以外は None を返す。
    """
    result = (
        db.table(SupabaseTableName.PRODUCTS.value)
        .select("id")
        .eq("tenant_id", tenant_id)
        .eq("code", code)
        .limit(2)
        .execute()
    )
    rows = cast(list[dict[str, Any]], result.data or [])
    if len(rows) == 1:
        return int(rows[0]["id"])
    return None


def match_products(db: Client, tenant_id: str, product_name: str) -> dict[str, Any]:
    """
    pg_trgm で製品名を類似度検索する。

    Returns:
        {
            "product_id": int | None,    # 単一確定時のみセット
            "candidates": list[dict],    # UI 表示用上位 N 件
        }
    """
    result = db.rpc(
        "match_products_by_name",
        {
            "query_text": product_name,
            "p_tenant_id": tenant_id,
            "similarity_threshold": _THRESHOLD,
        },
    ).execute()

    rows = cast(list[dict[str, Any]], result.data or [])
    logger.info(f"product match: query='{product_name}' hits={len(rows)}")

    candidates = [
        {"product_id": r["id"], "name": r["name"], "score": r["score"]}
        for r in rows[:_TOP_N]
    ]

    if len(rows) == 1:
        return {"product_id": rows[0]["id"], "candidates": candidates}

    return {"product_id": None, "candidates": candidates}
