import os
import re
import unicodedata
from typing import Any, cast

from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.services.daily_report_name_matching_service import fetch_all_rows
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
# 品名に埋もれた品番で照合するとき（Issue #599）に対象とする品番の最短の長さ。
# 短い品番は品名・寸法の一部と誤一致しやすいため照合に使わない。
_EMBEDDED_CODE_MIN_LENGTH = int(
    os.environ.get("PRODUCT_MATCH_EMBEDDED_CODE_MIN_LENGTH", "4")
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


def match_product_by_alias(
    db: Client, tenant_id: str, customer_id: int, raw_text: str
) -> int | None:
    """
    製品別名辞書 (product_name_aliases) の完全一致で製品を検索する（Issue #347）。

    過去に担当者が確定させた「生テキスト → 製品」の対応を pg_trgm の曖昧マッチング
    より優先して使うことで、表記ゆれの再発による未マッチ・誤マッチを減らす。
    raw_text の正規化は orders.extracted_product_name と同様 TRIM() のみ。

    別名は顧客単位でスコープする（Issue #349）。同じ raw_text でも顧客が違えば
    別の製品を指しうる（別の顧客が同じ表記で別製品を呼ぶ）ため、
    (tenant_id, customer_id, raw_text) の完全一致のみを見る。該当顧客の別名が
    無い場合に他顧客の別名へフォールバックはしない（誤爆防止。呼び出し元が
    従来通り products.code 完全一致 → pg_trgm 曖昧検索へフォールバックする）。
    """
    result = (
        db.table(SupabaseTableName.PRODUCT_NAME_ALIASES.value)
        .select("product_id")
        .eq("tenant_id", tenant_id)
        .eq("customer_id", customer_id)
        .eq("raw_text", raw_text.strip())
        .limit(1)
        .execute()
    )
    rows = cast(list[dict[str, Any]], result.data or [])
    if rows:
        return int(rows[0]["product_id"])
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


def _normalize_for_code_search(text: str) -> str:
    """半角カナ・全角英数を揃え（NFKC）、大文字小文字を区別しないよう大文字にする。"""
    return unicodedata.normalize("NFKC", text).strip().upper()


def find_embedded_product_code(
    raw_texts: list[str | None], code_by_product_id: dict[int, str]
) -> int | None:
    """
    抽出した品名・品番の中に、候補の品番が語として含まれる製品を探す（Issue #599）。

    画像PDF（FAX・スキャン）を読ませると、品番が単独の項目に入らず
    `TEST01ﾌｨﾙﾀｰ QX5501A φ10.0×10L` のように品名に埋もれることがある。品番の前後が
    英数字でない（語として現れる）ものだけを一致とみなし、`QX5501` が `QX5501A` に
    当たらないようにする。当たった製品がちょうど1つのときだけ返す（0件・複数件は None）。
    """
    haystacks = [_normalize_for_code_search(t) for t in raw_texts if t and t.strip()]
    if not haystacks:
        return None

    matched: set[int] = set()
    for product_id, code in code_by_product_id.items():
        normalized_code = _normalize_for_code_search(code)
        if len(normalized_code) < _EMBEDDED_CODE_MIN_LENGTH:
            continue
        pattern = re.compile(rf"(?<![0-9A-Z]){re.escape(normalized_code)}(?![0-9A-Z])")
        if any(pattern.search(haystack) for haystack in haystacks):
            matched.add(product_id)
    return next(iter(matched)) if len(matched) == 1 else None


def match_product_by_embedded_code(
    db: Client, tenant_id: str, customer_id: int, raw_texts: list[str | None]
) -> int | None:
    """
    その顧客が過去に注文した製品の品番が、抽出した品名・品番に語として含まれれば
    その製品を返す（Issue #599）。

    候補を顧客の注文実績に絞るのは、テナント全体の品番だと短い品番・似た品番の
    誤一致が増えるため。別名辞書・品番の完全一致・pg_trgm で決まらなかったときの
    最後の手段として呼ぶ。
    """
    rows = fetch_all_rows(
        lambda: (
            db.table(SupabaseTableName.ORDERS.value)
            .select("id, product_id, products(code)")
            .eq("tenant_id", tenant_id)
            .eq("customer_id", customer_id)
            .not_.is_("product_id", "null")
            .order("id")
        )
    )
    code_by_product_id: dict[int, str] = {}
    for row in rows:
        product = row.get("products")
        code = product.get("code") if isinstance(product, dict) else None
        if isinstance(code, str) and code.strip():
            code_by_product_id[int(row["product_id"])] = code
    product_id = find_embedded_product_code(raw_texts, code_by_product_id)
    if product_id is not None:
        logger.info(
            f"product match: embedded code matched product_id={product_id} "
            f"(customer_id={customer_id}, candidates={len(code_by_product_id)})"
        )
    return product_id
