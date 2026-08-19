# services/product_alias_service.py
"""メール起票の下書き注文で product_id が修正された場合に、
raw_text（extracted_product_name）→ product_id の対応を製品別名辞書
（product_name_aliases）へ蓄積し、修正履歴（product_name_alias_history）に
追記するサービス（Issue #347）。

orders.product_id を更新する経路は今後も増えうるため、更新箇所ごとに個別実装
するのではなく、必ず record_correction_if_applicable() を通すこと。現在の
呼び出し元は以下の2経路（backend/app/routers/transaction/orders.py）:

- PATCH /orders/{id}（update_order）: 修正前後の product_id が異なる場合
- POST /orders/{id}/split（split_order）: 分割後の各明細に product_id が
  設定される場合（元の下書きの extracted_product_name を明細ごとに引き継ぐ）
"""

from typing import Any, cast

from postgrest.exceptions import APIError

from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.utils.logger import get_logger
from supabase import Client

logger = get_logger(__name__)


def record_correction_if_applicable(
    client: Client,
    tenant_id: str,
    order_before: dict[str, Any] | None,
    order_after: dict[str, Any],
    changed_by: str,
) -> None:
    """注文の product_id 修正を別名候補として記録する。

    以下のいずれかに該当する場合は何もしない（発火しない）:
    - order_after["source_type"] が "email" 以外（手動起票等）
    - order_after["extracted_product_name"] が未設定
    - order_after["product_id"] が未設定
    - 変更前後の product_id が同一（実質的な修正でない）

    注文本体の更新（呼び出し元の repo.update() / repo.create()）とは別トランザクション
    のベストエフォート処理。ここで例外が発生しても、既に完了している注文更新自体を
    失敗として扱わせない（クライアントの誤ったリトライによる二重更新を防ぐ）ため、
    例外を送出せずログに記録するのみとする（PRレビュー指摘対応）。
    """
    try:
        _record_correction(client, tenant_id, order_before, order_after, changed_by)
    except Exception:
        order_id = order_after.get("id")
        logger.error(
            f"product_alias_service: failed to record alias correction "
            f"for order_id={order_id}",
            exc_info=True,
        )


def _record_correction(
    client: Client,
    tenant_id: str,
    order_before: dict[str, Any] | None,
    order_after: dict[str, Any],
    changed_by: str,
) -> None:
    if order_after.get("source_type") != "email":
        return

    raw_text = order_after.get("extracted_product_name")
    if not raw_text or not raw_text.strip():
        return
    raw_text = raw_text.strip()

    new_product_id = order_after.get("product_id")
    if new_product_id is None:
        return

    before_product_id = order_before.get("product_id") if order_before else None
    if before_product_id == new_product_id:
        return

    product_res = (
        client.table(SupabaseTableName.PRODUCTS.value)
        .select("name")
        .eq("id", new_product_id)
        .single()
        .execute()
    )
    product_name = cast(dict[str, Any] | None, product_res.data) or {}
    product_name_snapshot = product_name.get("name") or "不明"

    order_id = order_after.get("id")
    order_label_snapshot = order_after.get("order_number") or (
        f"注文 #{order_id}" if order_id is not None else "不明"
    )

    action = _upsert_alias(client, tenant_id, raw_text, new_product_id, changed_by)

    client.table(SupabaseTableName.PRODUCT_NAME_ALIAS_HISTORY.value).insert(
        {
            "tenant_id": tenant_id,
            "product_id": new_product_id,
            "product_name_snapshot": product_name_snapshot,
            "raw_text": raw_text,
            "changed_by": changed_by,
            "action": action,
            "source_order_id": order_id,
            "source_order_label_snapshot": order_label_snapshot,
        }
    ).execute()

    logger.info(
        f"product_alias_service: {action} alias raw_text={raw_text!r} "
        f"-> product_id={new_product_id} (order_id={order_id})"
    )


def _upsert_alias(
    client: Client,
    tenant_id: str,
    raw_text: str,
    product_id: int,
    changed_by: str,
) -> str:
    """product_name_aliases を UPSERT する。postgrest-py の on_conflict は条件付き
    ロジックを表現できないため使わず、既存有無を確認した上で insert/update を
    分岐する（docs/features/pdf-order-parsing.md の同種の議論を参照）。
    """
    existing_res = (
        client.table(SupabaseTableName.PRODUCT_NAME_ALIASES.value)
        .select("id")
        .eq("tenant_id", tenant_id)
        .eq("raw_text", raw_text)
        .execute()
    )
    existing_rows = cast(list[dict[str, Any]], existing_res.data or [])

    if existing_rows:
        # created_by は「最初に登録したユーザー」を表す監査カラムのため、
        # 再修正（UPSERT の上書き）時にも書き換えない。誰が今回の修正を
        # 行ったかは product_name_alias_history.changed_by 側に記録される。
        client.table(SupabaseTableName.PRODUCT_NAME_ALIASES.value).update(
            {"product_id": product_id}
        ).eq("tenant_id", tenant_id).eq("raw_text", raw_text).execute()
        return "updated"

    try:
        client.table(SupabaseTableName.PRODUCT_NAME_ALIASES.value).insert(
            {
                "tenant_id": tenant_id,
                "raw_text": raw_text,
                "product_id": product_id,
                "created_by": changed_by,
            }
        ).execute()
        return "created"
    except APIError as e:
        if e.code != "23505":
            raise
        # 同時リクエストによる競合挿入: 既に存在するので更新として扱う
        client.table(SupabaseTableName.PRODUCT_NAME_ALIASES.value).update(
            {"product_id": product_id}
        ).eq("tenant_id", tenant_id).eq("raw_text", raw_text).execute()
        return "updated"
