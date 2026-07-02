import os
from typing import Any, cast

from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.utils.logger import get_logger
from supabase import Client

logger = get_logger(__name__)

_THRESHOLD = float(os.environ.get("PRODUCT_MATCH_THRESHOLD", "0.3"))
_TOP_N = int(os.environ.get("PRODUCT_MATCH_TOP_N", "5"))
# 自動確定に必要な最上位候補の類似度スコア下限。
# 品番のような構造化文字列は1文字違いでも別製品を指すため、
# 単に候補が1件というだけでは自動確定の根拠として弱い。
_AUTO_CONFIRM_THRESHOLD = float(
    os.environ.get("PRODUCT_MATCH_AUTO_CONFIRM_THRESHOLD", "0.75")
)
# 最上位候補と次点候補のスコア差の下限。
# 僅差の候補が複数ある場合は自動確定せず、候補一覧として提示する。
_AUTO_CONFIRM_MARGIN = float(
    os.environ.get("PRODUCT_MATCH_AUTO_CONFIRM_MARGIN", "0.15")
)


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

    自動確定 (product_id を返す) するのは、最上位候補のスコアが
    _AUTO_CONFIRM_THRESHOLD 以上、かつ次点候補とのスコア差が
    _AUTO_CONFIRM_MARGIN 以上ある場合のみ。単に候補が1件だけという
    条件では、品番の1文字違いの別製品（デコイ）が唯一の候補として
    ヒットするだけで誤って自動確定してしまうため採用しない。

    Returns:
        {
            "product_id": int | None,    # 自動確定時のみセット
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

    product_id: int | None = None
    if rows:
        top_score = float(rows[0]["score"])
        second_score = float(rows[1]["score"]) if len(rows) > 1 else 0.0
        if (
            top_score >= _AUTO_CONFIRM_THRESHOLD
            and (top_score - second_score) >= _AUTO_CONFIRM_MARGIN
        ):
            product_id = rows[0]["id"]

    return {"product_id": product_id, "candidates": candidates}
