import hashlib
import os
from datetime import UTC, datetime
from typing import Any, cast

from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.services.attachment_service import download_attachment
from app.services.email_extraction_service import extract_email_order_lines
from app.services.notification_service import create_notification
from app.services.pdf_order_extraction_service import extract_order_lines
from app.services.pdf_text_service import extract_text
from app.services.product_matching_service import (
    match_product_by_alias,
    match_product_by_code,
    match_products,
)
from app.utils.logger import get_logger
from supabase import Client

logger = get_logger(__name__)

_VALID_CUSTOMER_CERTAINTIES = {"confirmed", "forecast", "forecast_tentative"}

_KNOWN_UPSERT_ACTIONS = {
    "inserted",
    "updated",
    "skipped_no_change",
    "skipped_downgrade",
    "skipped_draft_conflict",
}

# 自動抽出時に複数受注が1明細にマージされてしまった疑いを検知する粗いヒューリスティック。
# まずは数量の異常値のみを対象とし、本番データの精度を見ながら閾値・条件を調整する前提
# （Issue #280 未解決の論点）。
_MULTI_ORDER_QUANTITY_THRESHOLD = int(
    os.environ.get("MULTI_ORDER_SUSPECTED_QUANTITY_THRESHOLD", "100000")
)


def parse_pending_order_pdfs(db: Client) -> dict[str, int]:
    """
    order_attachments のステージング行 (order_id IS NULL, parse_status='pending') を
    ポーリングし、PDF・メール本文をパースして複数の orders 行を生成する。
    """
    table = SupabaseTableName.ORDER_ATTACHMENTS.value
    result = (
        db.table(table)
        .select("*")
        .is_("order_id", "null")
        .eq("parse_status", "pending")
        .execute()
    )
    staging_rows = cast(list[dict[str, Any]], result.data or [])

    processed = 0
    orders_created = 0
    errors = 0

    for row in staging_rows:
        try:
            orders_created += _parse_one(db, row)
            processed += 1
        except Exception as exc:
            errors += 1
            logger.error(
                f"pdf_order_parsing: staging row {row['id']} failed: {exc}",
                exc_info=True,
            )

    logger.info(
        f"pdf_order_parsing complete: processed={processed} "
        f"orders_created={orders_created} errors={errors}"
    )
    return {
        "processed": processed,
        "orders_created": orders_created,
        "errors": errors,
    }


def _get_customer_extraction_prompt(
    db: Client, tenant_id: str, customer_id: Any
) -> str | None:
    """
    顧客固有の抽出プロンプト断片（customers.order_extraction_prompt）を引く。
    未設定（NULL）・顧客未特定の場合は None を返し、汎用プロンプトのみで抽出する
    （挙動不変）。

    このサービスは cron から管理者クライアント（RLS バイパス）で呼ばれるため、
    RLS の tenant isolation に依存せず、明示的に tenant_id で絞り込む
    （staging_row.customer_id が万一他テナントを指しても他テナントの断片を
    読まないようにする）。
    """
    if customer_id is None:
        return None
    result = (
        db.table(SupabaseTableName.CUSTOMERS.value)
        .select("order_extraction_prompt")
        .eq("tenant_id", tenant_id)
        .eq("id", customer_id)
        .limit(1)
        .execute()
    )
    rows = cast(list[dict[str, Any]], result.data or [])
    if not rows:
        return None
    prompt = rows[0].get("order_extraction_prompt")
    return prompt if isinstance(prompt, str) and prompt.strip() else None


def _generate_auto_customer_order_no(
    customer_id: Any, source_text: str | None
) -> str | None:
    """
    注文番号が文書に存在しない顧客（例: 飯野製作所）向けに、アプリ側で
    `customer_order_no` を文書内容から決定的に採番する。

    (customer_id, 正規化した文書テキスト) の SHA-256 から生成するため、同じ文書を
    再パースしても同じ番号になり、観察・重複判定の土台として安定する。連番管理
    テーブルは持たない。文書テキストが空の場合は None。
    """
    normalized = " ".join((source_text or "").split())
    if not normalized:
        return None
    digest = hashlib.sha256(f"{customer_id}\n{normalized}".encode()).hexdigest()
    return f"AUTO-{digest[:10]}"


def _resolve_customer_order_no(
    line: dict[str, Any],
    document_order_no: str | None,
    auto_order_no: str | None,
) -> str | None:
    """
    明細ごとの顧客注文番号を解決する:
    1. 明細レベルの line_order_no（昭和製作所のように1文書に複数ある場合）
    2. 無ければ文書レベルの document_order_no
    3. どちらも無ければアプリ側で採番した auto_order_no（飯野製作所等）
    """
    for candidate in (line.get("line_order_no"), document_order_no):
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return auto_order_no


def _parse_one(db: Client, row: dict[str, Any]) -> int:
    """1件のステージング行を処理し、生成した order 数を返す。"""
    table = SupabaseTableName.ORDER_ATTACHMENTS.value
    attachment_id = row["id"]
    customer_extraction_prompt = _get_customer_extraction_prompt(
        db, row["tenant_id"], row.get("customer_id")
    )

    # PDF添付があればPDFのテキストから明細抽出を試み、明細が0件ならメール本文に
    # フォールバックする。非PDF添付・添付なしメール（storage_path が空）は、
    # そもそもPDFが存在しないため直接メール本文から抽出する（Issue #280）。
    if row.get("content_type") == "application/pdf" and row.get("storage_path"):
        content = download_attachment(db, row["storage_path"])
        text_result = extract_text(content)

        if text_result.failure_reason is not None:
            created_count = _process_unreadable_pdf(db, row, text_result.failure_reason)
            db.table(table).update({"parse_status": "success"}).eq(
                "id", attachment_id
            ).execute()
            return created_count

        extraction = extract_order_lines(
            cast(str, text_result.text), customer_extraction_prompt
        )
        line_items = cast(list[dict[str, Any]], extraction["line_items"])
        document_order_no: str | None = extraction.get("document_order_no")
        auto_order_no = _generate_auto_customer_order_no(
            row.get("customer_id"), text_result.text
        )
        logger.info(
            f"pdf_order_parsing: attachment {attachment_id} "
            f"extracted {len(line_items)} line items "
            f"(document_order_no={document_order_no!r})"
        )

        if line_items:
            created_count = sum(
                1
                for line in line_items
                if _process_line_item(db, row, line, document_order_no, auto_order_no)
            )
        else:
            # PDFの内容が注文と無関係で明細が1件も抽出できなかった場合、
            # メール本文（source_raw）からの抽出にフォールバックする（Issue #278）
            created_count = _process_email_body(db, row, customer_extraction_prompt)
    else:
        created_count = _process_email_body(db, row, customer_extraction_prompt)

    _notify_if_no_order_created(db, row, created_count)
    db.table(table).update({"parse_status": "success"}).eq(
        "id", attachment_id
    ).execute()
    return created_count


def _notify_if_no_order_created(
    db: Client, row: dict[str, Any], created_count: int
) -> None:
    """
    パースは成功したのに order が1件も生成されず、parse_log も通知も残らない
    ケースを可視化する（Issue #357）。

    典型例は、自動抽出した全明細が既存の内示注文と同一キー・同数量・同確度で
    `upsert_order_by_dedupe_key` が `skipped_no_change` を返し、
    `_process_line_item` が黙って False を返し続けたケース。この場合
    `parse_status='success'` だけが記録され、運用側から起票0件に気づけない。

    non_order_email / no_product_match / invalid_quantity など、既に別の理由で
    parse_log が残っている場合は二重に通知しない。
    """
    if created_count > 0:
        return

    tenant_id = row["tenant_id"]
    attachment_id = row["id"]
    existing = (
        db.table(SupabaseTableName.ORDER_PARSE_LOG.value)
        .select("id")
        .eq("order_attachment_id", attachment_id)
        .limit(1)
        .execute()
    )
    if cast(list[dict[str, Any]], existing.data or []):
        return

    detail = {
        "gmail_message_id": row.get("gmail_message_id"),
        "original_filename": row.get("original_filename"),
    }
    log_id = _log_parse_event(db, tenant_id, attachment_id, "no_order_created", detail)
    create_notification(
        db,
        tenant_id,
        "no_order_created",
        SupabaseTableName.ORDER_PARSE_LOG.value,
        log_id,
        detail,
    )


def _process_email_body(
    db: Client,
    row: dict[str, Any],
    customer_extraction_prompt: str | None = None,
) -> int:
    """
    メール本文（source_raw）から注文明細行を抽出し、order を生成する。

    PDFから明細が1件も抽出できなかった場合のフォールバック（Issue #278）と、
    非PDF添付・添付なしメールの本処理（Issue #280）を兼ねる共通経路。
    1通のメールに複数明細が含まれる場合も line_items 配列として抽出できる。

    本文からも注文情報が抽出できなかった場合は non_order_email として
    通知のみ記録し0を返す。
    """
    tenant_id = row["tenant_id"]
    attachment_id = row["id"]
    body = cast(str, row.get("source_raw") or "")

    extraction = extract_email_order_lines(body, customer_extraction_prompt)
    line_items = cast(list[dict[str, Any]], extraction["line_items"])
    document_order_no: str | None = extraction.get("document_order_no")
    auto_order_no = _generate_auto_customer_order_no(row.get("customer_id"), body)

    if not line_items:
        detail = {"body_snippet": body[:200]}
        _log_parse_event(db, tenant_id, attachment_id, "non_order_email", detail)
        # non_order_email 通知は notifications router 側で source_id を
        # Gmail メッセージIDとしてそのままリンク生成に使うため、
        # order_attachments.id ではなく gmail_message_id を渡す必要がある
        create_notification(
            db,
            tenant_id,
            "non_order_email",
            "gmail_message",
            row.get("gmail_message_id"),
            detail,
        )
        logger.info(
            f"pdf_order_parsing: attachment {attachment_id} "
            "no order information found in email body"
        )
        return 0

    created_count = sum(
        1
        for line in line_items
        if _process_line_item(db, row, line, document_order_no, auto_order_no)
    )
    logger.info(
        f"pdf_order_parsing: attachment {attachment_id} "
        f"extracted {len(line_items)} line items from email body, "
        f"created {created_count} orders"
    )
    return created_count


def _require_customer_id(staging_row: dict[str, Any], attachment_id: str) -> int:
    """
    staging_row.customer_id を取得する。resolve_or_create_customer は必ず
    customer_id を解決する（顧客未特定時も"不明な顧客"下書きを作成する）ため、
    ここで欠落している場合はステージング行自体の不整合（想定外の経路での
    直接INSERT等）であり、customer_id=NULL の受注を静かに作らず早期に検知する。
    """
    customer_id = staging_row.get("customer_id")
    if customer_id is None:
        raise ValueError(
            f"staging row {attachment_id} has no customer_id; "
            "resolve_or_create_customer should have set it"
        )
    return cast(int, customer_id)


def _process_unreadable_pdf(
    db: Client, staging_row: dict[str, Any], failure_reason: str
) -> int:
    """
    PDFのテキストが抽出できず明細抽出自体を行えない場合でも、判明している情報
    （顧客等。顧客未特定時は"不明な顧客"下書きに解決済み）だけで product_id・
    quantity・deadline_date が NULL の下書き order を1件起票し、ユーザーが手動で
    内容を補完する起点とする。product_id・deadline_date が共に NULL の行は
    upsert_order_by_dedupe_key が常に新規行としてINSERTするため、他の解析失敗
    ケースと誤って統合されることはない。
    """
    tenant_id = staging_row["tenant_id"]
    attachment_id = staging_row["id"]
    customer_id = _require_customer_id(staging_row, attachment_id)

    rpc_result = db.rpc(
        "upsert_order_by_dedupe_key",
        {
            "p_tenant_id": tenant_id,
            "p_customer_id": customer_id,
            "p_product_id": None,
            "p_quantity": None,
            "p_deadline_date": None,
            "p_customer_certainty": "forecast_tentative",
            "p_source_type": "email",
            "p_source_raw": staging_row.get("source_raw"),
            "p_extracted_product_name": None,
            "p_source_attachment_id": attachment_id,
        },
    ).execute()
    rpc_rows = cast(list[dict[str, Any]], rpc_result.data or [])
    action = rpc_rows[0]["action"] if rpc_rows else None

    if action not in _KNOWN_UPSERT_ACTIONS:
        raise RuntimeError(
            f"upsert_order_by_dedupe_key returned unexpected result "
            f"for attachment {attachment_id}: rows={rpc_rows}"
        )

    log_id = _log_parse_event(db, tenant_id, attachment_id, failure_reason, {})
    create_notification(
        db,
        tenant_id,
        failure_reason,
        SupabaseTableName.ORDER_PARSE_LOG.value,
        log_id,
        {},
    )

    if action != "inserted":
        # NULL/NULLの下書きは常に新規挿入される想定だが、念のため他アクションが
        # 返った場合は order を紐付けずログ・通知のみで終える。
        return 0

    order_id = rpc_rows[0]["order_id"]
    db.table(SupabaseTableName.ORDER_ATTACHMENTS.value).insert(
        {
            "order_id": order_id,
            "tenant_id": tenant_id,
            "storage_path": staging_row.get("storage_path", ""),
            "original_filename": staging_row.get("original_filename", ""),
            "content_type": staging_row.get("content_type"),
            "size_bytes": staging_row.get("size_bytes"),
            "parse_status": failure_reason,
        }
    ).execute()
    logger.info(
        f"pdf_order_parsing: order {order_id} inserted as draft from "
        f"unreadable attachment {attachment_id} ({failure_reason})"
    )
    return 1


def _check_multi_order_suspected(
    db: Client, tenant_id: str, attachment_id: str, line: dict[str, Any]
) -> None:
    """
    1メール/1PDFに複数受注が含まれるにもかかわらず1明細にマージされてしまった
    疑いのあるケースを粗く検知し、通知する（Issue #280）。

    現時点では数量が閾値を超える場合のみを対象とする単純なヒューリスティックであり、
    受注の作成自体はブロックしない（情報提供目的の通知のみ）。
    """
    quantity = line.get("quantity")
    if not isinstance(quantity, int) or quantity < _MULTI_ORDER_QUANTITY_THRESHOLD:
        return
    detail = {
        "quantity": quantity,
        "product_number_raw": line.get("product_number_raw"),
        "product_name_raw": line.get("product_name_raw"),
    }
    log_id = _log_parse_event(
        db, tenant_id, attachment_id, "multi_order_suspected", detail
    )
    create_notification(
        db,
        tenant_id,
        "multi_order_suspected",
        SupabaseTableName.ORDER_PARSE_LOG.value,
        log_id,
        detail,
    )


def _resolve_product_id(
    db: Client,
    tenant_id: str,
    customer_id: int,
    product_number_raw: str | None,
    product_name_raw: str | None,
) -> int | None:
    """
    0. product_name_aliases（過去に担当者が確定させた表記ゆれ辞書）の完全一致
       （Issue #347。extracted_product_name と同じ値 = product_name_raw or
       product_number_raw で、明細ごとに解決済みの customer_id と合わせて検索する。
       Issue #349。該当顧客の別名が無ければ他顧客へはフォールバックしない）
    1. products.code の完全一致
    2. products.name に対する品番文字列でのpg_trgm検索
       （code列が未整備で、name列に品番文字列が入っているテナントに対応するため）
    3. products.name に対する品名文字列でのpg_trgm検索
    の順にフォールバックして product_id を解決する。
    """
    alias_raw_text = product_name_raw or product_number_raw
    if alias_raw_text:
        alias_product_id = match_product_by_alias(
            db, tenant_id, customer_id, alias_raw_text
        )
        if alias_product_id is not None:
            return alias_product_id

    product_id: int | None = None
    if product_number_raw:
        product_id = match_product_by_code(db, tenant_id, product_number_raw)
    if product_id is None and product_number_raw:
        match = match_products(db, tenant_id, product_number_raw)
        product_id = match["product_id"]
    if product_id is None and product_name_raw:
        match = match_products(db, tenant_id, product_name_raw)
        product_id = match["product_id"]
    return product_id


def _process_line_item(
    db: Client,
    staging_row: dict[str, Any],
    line: dict[str, Any],
    document_order_no: str | None = None,
    auto_order_no: str | None = None,
) -> bool:
    """
    抽出された1明細から order を生成する。
    生成できた場合 True、数量不正・重複スキップの場合 False を返す。
    品番照合に失敗した場合も product_id=NULL の下書きとして生成するため True を返す
    （Issue #296）。

    document_order_no（文書レベル）・auto_order_no（アプリ側採番）と明細の
    line_order_no から `customer_order_no` を解決し、RPC 経由で orders に保存する
    （Issue #366。dedupe キー・優先順位判定には使わない観察用）。
    """
    tenant_id = staging_row["tenant_id"]
    attachment_id = staging_row["id"]
    customer_id = _require_customer_id(staging_row, attachment_id)
    customer_order_no = _resolve_customer_order_no(
        line, document_order_no, auto_order_no
    )
    product_number_raw = line.get("product_number_raw")
    product_name_raw = line.get("product_name_raw")

    product_id = _resolve_product_id(
        db, tenant_id, customer_id, product_number_raw, product_name_raw
    )

    # 表記ゆれ対策はTRIM()のみ行い、全角/半角統一等の高度な正規化は
    # 実運用データを見てから要否を判断する（Issue #296 インクリメンタル方針）。
    extracted_product_name_raw = product_name_raw or product_number_raw
    extracted_product_name = (
        extracted_product_name_raw.strip() if extracted_product_name_raw else None
    )

    if product_id is None:
        # 製品を自動識別できなかった明細も、情報を失わずproduct_id=NULLで
        # 下書きを起票する（Issue #296）。ログ・通知は従来どおり記録した上で
        # 処理を継続する（以前はここでFalseを返し明細を丸ごと破棄していた）。
        detail = {
            "product_number_raw": product_number_raw,
            "product_name_raw": product_name_raw,
        }
        log_id = _log_parse_event(
            db, tenant_id, attachment_id, "no_product_match", detail
        )
        create_notification(
            db,
            tenant_id,
            "no_product_match",
            SupabaseTableName.ORDER_PARSE_LOG.value,
            log_id,
            detail,
        )

    certainty_raw = cast(str | None, line.get("certainty"))
    # Claude抽出結果の揺れ・想定外値でも orders.customer_certainty のCHECK制約に
    # 違反してRPCが失敗しないよう、許容値以外は最も確度が低い値にフォールバックする
    certainty = (
        certainty_raw
        if certainty_raw in _VALID_CUSTOMER_CERTAINTIES
        else "forecast_tentative"
    )
    deadline_date = line.get("delivery_date")

    # 抽出結果の揺れ・想定外の型（本来はツールスキーマで int|null に制約されるが、
    # スキーマ変更等で崩れた場合の防御）。不正な値のまま RPC に渡すと不整合な
    # order が作成されてしまうため、明細ごとスキップしてログのみ残す。
    quantity = line.get("quantity")
    if quantity is not None and not isinstance(quantity, int):
        detail = {
            "product_number_raw": product_number_raw,
            "product_name_raw": product_name_raw,
            "quantity": quantity,
        }
        _log_parse_event(db, tenant_id, attachment_id, "invalid_quantity", detail)
        return False

    _check_multi_order_suspected(db, tenant_id, attachment_id, line)

    rpc_result = db.rpc(
        "upsert_order_by_dedupe_key",
        {
            "p_tenant_id": tenant_id,
            "p_customer_id": customer_id,
            "p_product_id": product_id,
            "p_quantity": quantity,
            "p_deadline_date": deadline_date,
            "p_customer_certainty": certainty,
            "p_source_type": "email",
            "p_source_raw": staging_row.get("source_raw"),
            "p_extracted_product_name": extracted_product_name,
            "p_source_attachment_id": attachment_id,
            "p_customer_order_no": customer_order_no,
        },
    ).execute()
    rpc_rows = cast(list[dict[str, Any]], rpc_result.data or [])
    action = rpc_rows[0]["action"] if rpc_rows else None

    if action not in _KNOWN_UPSERT_ACTIONS:
        raise RuntimeError(
            f"upsert_order_by_dedupe_key returned unexpected result "
            f"for attachment {attachment_id}: rows={rpc_rows}"
        )

    if action == "skipped_downgrade":
        detail = {"product_id": product_id, "deadline_date": deadline_date}
        log_id = _log_parse_event(
            db, tenant_id, attachment_id, "downgrade_skipped", detail
        )
        create_notification(
            db,
            tenant_id,
            "downgrade_skipped",
            SupabaseTableName.ORDER_PARSE_LOG.value,
            log_id,
            detail,
        )
        return False

    if action == "skipped_draft_conflict":
        detail = {"product_id": product_id, "deadline_date": deadline_date}
        log_id = _log_parse_event(
            db, tenant_id, attachment_id, "draft_conflict_skipped", detail
        )
        create_notification(
            db,
            tenant_id,
            "draft_conflict_skipped",
            SupabaseTableName.ORDER_PARSE_LOG.value,
            log_id,
            detail,
        )
        return False

    if action == "skipped_no_change":
        return False

    # action == "inserted" or "updated"
    order_id = rpc_rows[0]["order_id"]
    # ソースに添付ファイル本体が無い場合（非PDF添付・添付なしメール由来）は、
    # フロントエンドの表示分岐と揃えるため parse_status を "failed_no_attachment" にする
    attachment_parse_status = (
        "success" if staging_row.get("storage_path") else "failed_no_attachment"
    )
    db.table(SupabaseTableName.ORDER_ATTACHMENTS.value).insert(
        {
            "order_id": order_id,
            "tenant_id": tenant_id,
            "storage_path": staging_row.get("storage_path", ""),
            "original_filename": staging_row.get("original_filename", ""),
            "content_type": staging_row.get("content_type"),
            "size_bytes": staging_row.get("size_bytes"),
            "parse_status": attachment_parse_status,
        }
    ).execute()
    logger.info(
        f"pdf_order_parsing: order {order_id} {action} from attachment {attachment_id}"
    )

    if action == "inserted" and product_id is not None:
        # product_id が未確定の明細は、どの製品の内示を無効化すべきか判断できない
        # ため対象外とする（超過分の後始末は人力での紐付け後に委ねる）。
        _mark_superseded_orders(db, tenant_id, staging_row, product_id, deadline_date)

    return True


def _mark_superseded_orders(
    db: Client,
    tenant_id: str,
    staging_row: dict[str, Any],
    product_id: int,
    deadline_date: str | None,
) -> None:
    """
    同一 (tenant_id, customer_id, product_id) で異なる deadline_date の
    forecast/forecast_tentative かつ未来日付のレコードを superseded_at で無効化する。

    deadline_date がdedupeキーの一部であるため、内示の納期が前後した場合は
    別レコードとして新規INSERTされる。旧レコードが一覧に残り続けないようにする
    最低限のケア（Issue #252）。
    """
    if deadline_date is None:
        return

    now = datetime.now(UTC).isoformat()
    (
        db.table(SupabaseTableName.ORDERS.value)
        .update({"superseded_at": now})
        .eq("tenant_id", tenant_id)
        .eq("customer_id", staging_row.get("customer_id"))
        .eq("product_id", product_id)
        .neq("deadline_date", deadline_date)
        .gt("deadline_date", datetime.now(UTC).date().isoformat())
        .eq("status", "draft")
        .in_("customer_certainty", ["forecast", "forecast_tentative"])
        .is_("superseded_at", "null")
        .execute()
    )


def _log_parse_event(
    db: Client,
    tenant_id: str,
    attachment_id: str,
    reason: str,
    detail: dict[str, Any],
) -> str | None:
    """order_parse_log に1行記録し、挿入した行の id を返す。"""
    result = (
        db.table(SupabaseTableName.ORDER_PARSE_LOG.value)
        .insert(
            {
                "tenant_id": tenant_id,
                "order_attachment_id": attachment_id,
                "reason": reason,
                "detail": detail,
            }
        )
        .execute()
    )
    rows = cast(list[dict[str, Any]], result.data or [])
    logger.info(
        f"pdf_order_parsing: logged {reason} for attachment {attachment_id}: {detail}"
    )
    return rows[0]["id"] if rows else None
