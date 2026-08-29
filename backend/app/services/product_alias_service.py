# services/product_alias_service.py
"""メール起票の下書き注文の製品名表記ゆれ（raw_text = extracted_product_name）を
製品別名辞書（product_name_aliases）へ蓄積し、修正履歴
（product_name_alias_history）へ追記するサービス。

反映の経路は3つあり、いずれも辞書 UPSERT + 履歴追記の中核処理
（_write_alias_and_history）を共有する。呼び出し元が由来（source）を渡す:

- record_correction_if_applicable():
    PATCH /orders/{id}（update_order）/ POST /orders/{id}/split（split_order）で
    担当者が product_id を明示的に修正した場合。source='manual_correction'（Issue #347）
- record_auto_match_alias_if_applicable():
    POST /orders/{id}/request-approval（request_order_approval）で、自動マッチの
    まま（担当者が未修正）承認依頼が送られた場合。source='auto_match_unreviewed'
    （Issue #350。人間の明示的な確認を経ていない推定値）
- record_direct_alias_change():
    製品マスタ画面からの別名の直接付け替え / 削除（Issue #351）。注文非経由。
"""

from typing import Any, cast

from postgrest.exceptions import APIError

from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.utils.logger import get_logger
from supabase import Client

logger = get_logger(__name__)

SOURCE_MANUAL_CORRECTION = "manual_correction"
SOURCE_AUTO_MATCH_UNREVIEWED = "auto_match_unreviewed"

_DIRECT_EDIT_ORDER_LABEL = "製品マスタからの直接修正"
_DIRECT_DELETE_ORDER_LABEL = "製品マスタからの直接削除"


def record_correction_if_applicable(
    client: Client,
    tenant_id: str,
    order_before: dict[str, Any] | None,
    order_after: dict[str, Any],
    changed_by: str,
) -> None:
    """注文の product_id の「手動修正」を別名候補として記録する（Issue #347）。

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


def record_auto_match_alias_if_applicable(
    client: Client,
    tenant_id: str,
    order: dict[str, Any],
    changed_by: str,
) -> None:
    """承認依頼時、自動マッチのままの product_id を別名候補として記録する（Issue #350）。

    以下のいずれかに該当する場合は何もしない:
    - order["source_type"] が "email" 以外
    - order["product_id_manually_corrected"] が真（#347 の PATCH フックで既に記録済み。
      二重記録防止）
    - order["extracted_product_name"] が未設定
    - order["product_id"] が未設定（request-approval は 422 で弾くため通常起きない）
    - order["customer_id"] が未設定

    record_correction_if_applicable() と同様、承認依頼処理本体とは別トランザクションの
    ベストエフォート処理のため、例外は送出せずログに記録するのみとする。
    """
    try:
        _record_auto_match_alias(client, tenant_id, order, changed_by)
    except Exception:
        order_id = order.get("id")
        logger.error(
            f"product_alias_service: failed to record auto-match alias "
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

    customer_id = order_after.get("customer_id")
    if customer_id is None:
        logger.warning(
            f"product_alias_service: order_id={order_after.get('id')} has no "
            f"customer_id; skip recording alias correction"
        )
        return

    order_id = order_after.get("id")
    order_label_snapshot = order_after.get("order_number") or (
        f"注文 #{order_id}" if order_id is not None else "不明"
    )

    _write_alias_and_history(
        client,
        tenant_id,
        customer_id=customer_id,
        raw_text=raw_text,
        product_id=new_product_id,
        changed_by=changed_by,
        source=SOURCE_MANUAL_CORRECTION,
        source_order_id=order_id,
        source_order_label_snapshot=order_label_snapshot,
    )


def _record_auto_match_alias(
    client: Client,
    tenant_id: str,
    order: dict[str, Any],
    changed_by: str,
) -> None:
    if order.get("source_type") != "email":
        return

    # 担当者が一度でも product_id に手を入れた注文は #347 の PATCH フックで既に
    # manual_correction として記録済み。ここで auto_match_unreviewed として
    # 二重記録しない（Issue #350 完了条件）。
    if order.get("product_id_manually_corrected"):
        return

    raw_text = order.get("extracted_product_name")
    if not raw_text or not raw_text.strip():
        return
    raw_text = raw_text.strip()

    product_id = order.get("product_id")
    if product_id is None:
        return

    customer_id = order.get("customer_id")
    if customer_id is None:
        logger.warning(
            f"product_alias_service: order_id={order.get('id')} has no "
            f"customer_id; skip recording auto-match alias"
        )
        return

    order_id = order.get("id")
    order_label_snapshot = order.get("order_number") or (
        f"注文 #{order_id}" if order_id is not None else "不明"
    )

    _write_alias_and_history(
        client,
        tenant_id,
        customer_id=customer_id,
        raw_text=raw_text,
        product_id=product_id,
        changed_by=changed_by,
        source=SOURCE_AUTO_MATCH_UNREVIEWED,
        source_order_id=order_id,
        source_order_label_snapshot=order_label_snapshot,
    )


def _fetch_customer_name_snapshot(client: Client, customer_id: int) -> str:
    """customer_name_snapshot は表示用の付随情報。RLS・一時的なAPIエラー・
    データ不整合で取得に失敗しても、別名UPSERT/履歴追記そのものは継続したいので
    ここだけは APIError を握りつぶして "不明" でフォールバックする
    （.single() は該当0件でも APIError を送出する。PRレビュー指摘対応）。"""
    try:
        customer_res = (
            client.table(SupabaseTableName.CUSTOMERS.value)
            .select("name")
            .eq("id", customer_id)
            .single()
            .execute()
        )
        customer_row = cast(dict[str, Any] | None, customer_res.data) or {}
        return customer_row.get("name") or "不明"
    except APIError:
        logger.warning(
            f"product_alias_service: failed to fetch customer name for "
            f"customer_id={customer_id}; falling back to '不明'",
            exc_info=True,
        )
        return "不明"


def _fetch_product_name_snapshot(client: Client, product_id: int) -> str:
    """product_name_snapshot は表示用の付随情報。_fetch_customer_name_snapshot と
    同様、取得失敗（.single() は該当0件でも APIError を送出する / 一時的な RLS・API
    エラー）でも別名UPSERT/履歴追記・直接編集APIそのものは継続させたいので、
    APIError を握りつぶして "不明" でフォールバックする（Copilotレビュー指摘対応）。"""
    try:
        product_res = (
            client.table(SupabaseTableName.PRODUCTS.value)
            .select("name")
            .eq("id", product_id)
            .single()
            .execute()
        )
        product_row = cast(dict[str, Any] | None, product_res.data) or {}
        return product_row.get("name") or "不明"
    except APIError:
        logger.warning(
            f"product_alias_service: failed to fetch product name for "
            f"product_id={product_id}; falling back to '不明'",
            exc_info=True,
        )
        return "不明"


def _write_alias_and_history(
    client: Client,
    tenant_id: str,
    *,
    customer_id: int,
    raw_text: str,
    product_id: int,
    changed_by: str,
    source: str,
    source_order_id: int | None,
    source_order_label_snapshot: str,
) -> None:
    """product_name_aliases を UPSERT し、product_name_alias_history へ追記する
    共通処理。#347（手動修正）/ #350（自動マッチ）の両経路から呼ばれる。"""
    customer_name_snapshot = _fetch_customer_name_snapshot(client, customer_id)
    product_name_snapshot = _fetch_product_name_snapshot(client, product_id)

    action = _upsert_alias(
        client, tenant_id, customer_id, raw_text, product_id, changed_by, source
    )

    client.table(SupabaseTableName.PRODUCT_NAME_ALIAS_HISTORY.value).insert(
        {
            "tenant_id": tenant_id,
            "product_id": product_id,
            "product_name_snapshot": product_name_snapshot,
            "customer_id": customer_id,
            "customer_name_snapshot": customer_name_snapshot,
            "raw_text": raw_text,
            "changed_by": changed_by,
            "action": action,
            "source": source,
            "source_order_id": source_order_id,
            "source_order_label_snapshot": source_order_label_snapshot,
        }
    ).execute()

    logger.info(
        f"product_alias_service: {action} alias raw_text={raw_text!r} "
        f"-> product_id={product_id} (source={source}, "
        f"order_id={source_order_id})"
    )


def _resolve_upsert_source(
    incoming_source: str, existing_source: str | None
) -> str | None:
    """既存の別名エントリに対して source をどう更新するかを決める（Issue #350 要件3）。

    - incoming が manual_correction: 常に manual_correction へ更新（手動修正の方が
      信頼度が高いため、既存が auto_match_unreviewed なら格上げする）
    - incoming が auto_match_unreviewed: 既存が manual_correction なら据え置き
      （未検証の推定で確認済みエントリを格下げしない）。それ以外は incoming で更新

    戻り値が None の場合は source 列を更新しない。
    """
    if incoming_source == SOURCE_MANUAL_CORRECTION:
        return SOURCE_MANUAL_CORRECTION
    if existing_source == SOURCE_MANUAL_CORRECTION:
        return None
    return incoming_source


def _upsert_alias(
    client: Client,
    tenant_id: str,
    customer_id: int,
    raw_text: str,
    product_id: int,
    changed_by: str,
    source: str,
) -> str:
    """product_name_aliases を UPSERT する。postgrest-py の on_conflict は条件付き
    ロジックを表現できないため使わず、既存有無を確認した上で insert/update を
    分岐する（docs/features/pdf-order-parsing.md の同種の議論を参照）。

    別名は (tenant_id, customer_id, raw_text) でスコープする（Issue #349）。
    """
    existing_res = (
        client.table(SupabaseTableName.PRODUCT_NAME_ALIASES.value)
        .select("id, source")
        .eq("tenant_id", tenant_id)
        .eq("customer_id", customer_id)
        .eq("raw_text", raw_text)
        .execute()
    )
    existing_rows = cast(list[dict[str, Any]], existing_res.data or [])

    if existing_rows:
        _update_existing_alias(
            client,
            tenant_id,
            customer_id,
            raw_text,
            product_id,
            source,
            existing_rows[0].get("source"),
        )
        return "updated"

    try:
        client.table(SupabaseTableName.PRODUCT_NAME_ALIASES.value).insert(
            {
                "tenant_id": tenant_id,
                "customer_id": customer_id,
                "raw_text": raw_text,
                "product_id": product_id,
                "created_by": changed_by,
                "source": source,
            }
        ).execute()
        return "created"
    except APIError as e:
        if e.code != "23505":
            raise
        # 同時リクエストによる競合挿入: 既に存在するので更新として扱う。
        # 競合相手の source は取り直さず incoming を優先（レアケース）。
        _update_existing_alias(
            client, tenant_id, customer_id, raw_text, product_id, source, None
        )
        return "updated"


def _update_existing_alias(
    client: Client,
    tenant_id: str,
    customer_id: int,
    raw_text: str,
    product_id: int,
    incoming_source: str,
    existing_source: str | None,
) -> None:
    # created_by は「最初に登録したユーザー」を表す監査カラムのため、
    # 再修正（UPSERT の上書き）時にも書き換えない。誰が今回の修正を
    # 行ったかは product_name_alias_history.changed_by 側に記録される。
    update_fields: dict[str, Any] = {"product_id": product_id}
    resolved_source = _resolve_upsert_source(incoming_source, existing_source)
    if resolved_source is not None and resolved_source != existing_source:
        update_fields["source"] = resolved_source

    client.table(SupabaseTableName.PRODUCT_NAME_ALIASES.value).update(update_fields).eq(
        "tenant_id", tenant_id
    ).eq("customer_id", customer_id).eq("raw_text", raw_text).execute()


def record_direct_alias_change(
    client: Client,
    tenant_id: str,
    *,
    alias_row: dict[str, Any],
    action: str,
    changed_by: str,
    target_product_id: int | None = None,
) -> None:
    """製品マスタ画面からの別名の直接付け替え（action='updated'）/ 削除
    （action='deleted'）を product_name_alias_history へ記録する（Issue #351）。

    注文を経由しない操作のため source_order_id は NULL、
    source_order_label_snapshot には注文非経由と分かる文言を入れる。

    #347/#350 の注文経由フックと違い、ここではベストエフォートにしない
    （エンドポイントの主目的そのものの監査記録であり、失敗時は例外を伝播させて
    500 とし担当者にリトライさせる）。呼び出し元は本関数の後に
    product_name_aliases 側の更新 / 削除を行うこと（削除しても監査履歴は残る）。
    """
    if action not in ("updated", "deleted"):
        raise ValueError(f"unsupported direct alias change action: {action!r}")

    customer_id = alias_row.get("customer_id")
    customer_name_snapshot = (
        _fetch_customer_name_snapshot(client, customer_id)
        if customer_id is not None
        else "不明"
    )

    product_id: int | None
    if action == "updated":
        if target_product_id is None:
            raise ValueError("target_product_id is required for action='updated'")
        product_id = target_product_id
        # 担当者が明示的に付け替えたエントリは「確認済み」とみなす
        history_source = SOURCE_MANUAL_CORRECTION
        label = _DIRECT_EDIT_ORDER_LABEL
    else:
        product_id = alias_row.get("product_id")
        # 削除時は「何を削除したか」を監査で追えるよう、削除対象の由来を記録する
        history_source = alias_row.get("source") or SOURCE_MANUAL_CORRECTION
        label = _DIRECT_DELETE_ORDER_LABEL

    product_name_snapshot = (
        _fetch_product_name_snapshot(client, product_id)
        if product_id is not None
        else "不明"
    )

    client.table(SupabaseTableName.PRODUCT_NAME_ALIAS_HISTORY.value).insert(
        {
            "tenant_id": tenant_id,
            "product_id": product_id,
            "product_name_snapshot": product_name_snapshot,
            "customer_id": customer_id,
            "customer_name_snapshot": customer_name_snapshot,
            "raw_text": alias_row.get("raw_text"),
            "changed_by": changed_by,
            "action": action,
            "source": history_source,
            "source_order_id": None,
            "source_order_label_snapshot": label,
        }
    ).execute()

    logger.info(
        f"product_alias_service: direct {action} alias id={alias_row.get('id')} "
        f"raw_text={alias_row.get('raw_text')!r} -> product_id={product_id}"
    )
