from datetime import UTC, datetime
from typing import Any, cast

from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.services.attachment_service import download_attachment
from app.services.pdf_order_extraction_service import extract_order_lines
from app.services.pdf_text_service import extract_text
from app.services.product_matching_service import match_product_by_code, match_products
from app.utils.logger import get_logger
from supabase import Client

logger = get_logger(__name__)

_CERTAINTY_TO_STATUS = {
    "confirmed": "confirmed",
    "forecast": "forecast",
    "forecast_tentative": "forecast_tentative",
}


def parse_pending_order_pdfs(db: Client) -> dict[str, int]:
    """
    order_attachments のステージング行 (order_id IS NULL, parse_status='pending') を
    ポーリングし、PDFをパースして複数の orders 行を生成する。
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


def _parse_one(db: Client, row: dict[str, Any]) -> int:
    """1件のステージング行を処理し、生成した order 数を返す。"""
    table = SupabaseTableName.ORDER_ATTACHMENTS.value
    attachment_id = row["id"]

    content = download_attachment(db, row["storage_path"])
    text_result = extract_text(content)

    if text_result.failure_reason is not None:
        db.table(table).update({"parse_status": text_result.failure_reason}).eq(
            "id", attachment_id
        ).execute()
        logger.info(
            f"pdf_order_parsing: attachment {attachment_id} "
            f"marked {text_result.failure_reason}"
        )
        return 0

    line_items = extract_order_lines(cast(str, text_result.text))
    logger.info(
        f"pdf_order_parsing: attachment {attachment_id} "
        f"extracted {len(line_items)} line items"
    )

    created_count = sum(1 for line in line_items if _process_line_item(db, row, line))

    db.table(table).update({"parse_status": "success"}).eq(
        "id", attachment_id
    ).execute()
    return created_count


def _process_line_item(
    db: Client, staging_row: dict[str, Any], line: dict[str, Any]
) -> bool:
    """
    抽出された1明細から order を生成する。
    生成できた場合 True、品番照合失敗・重複スキップの場合 False を返す。
    """
    tenant_id = staging_row["tenant_id"]
    attachment_id = staging_row["id"]
    product_number_raw = line.get("product_number_raw")
    product_name_raw = line.get("product_name_raw")

    # 1. products.code の完全一致
    # 2. products.name に対する品番文字列でのpg_trgm検索
    #    （code列が未整備で、name列に品番文字列が入っているテナントに対応するため）
    # 3. products.name に対する品名文字列でのpg_trgm検索
    product_id: int | None = None
    if product_number_raw:
        product_id = match_product_by_code(db, tenant_id, product_number_raw)
    if product_id is None and product_number_raw:
        match = match_products(db, tenant_id, product_number_raw)
        product_id = match["product_id"]
    if product_id is None and product_name_raw:
        match = match_products(db, tenant_id, product_name_raw)
        product_id = match["product_id"]

    if product_id is None:
        _log_parse_event(
            db,
            tenant_id,
            attachment_id,
            "no_product_match",
            {
                "product_number_raw": product_number_raw,
                "product_name_raw": product_name_raw,
            },
        )
        return False

    certainty = cast(str | None, line.get("certainty"))
    status = _CERTAINTY_TO_STATUS.get(certainty or "", "forecast_tentative")
    deadline_date = line.get("delivery_date")

    rpc_result = db.rpc(
        "upsert_order_by_dedupe_key",
        {
            "p_tenant_id": tenant_id,
            "p_customer_id": staging_row.get("customer_id"),
            "p_product_id": product_id,
            "p_quantity": line.get("quantity"),
            "p_deadline_date": deadline_date,
            "p_status": status,
            "p_source_type": "email",
            "p_source_raw": staging_row.get("source_raw"),
            "p_extracted_product_name": product_name_raw,
        },
    ).execute()
    rpc_rows = cast(list[dict[str, Any]], rpc_result.data or [])
    action = rpc_rows[0]["action"] if rpc_rows else None

    if action == "skipped_downgrade":
        _log_parse_event(
            db,
            tenant_id,
            attachment_id,
            "downgrade_skipped",
            {"product_id": product_id, "deadline_date": deadline_date},
        )
        return False

    if action == "skipped_draft_conflict":
        _log_parse_event(
            db,
            tenant_id,
            attachment_id,
            "draft_conflict_skipped",
            {"product_id": product_id, "deadline_date": deadline_date},
        )
        return False

    if action == "skipped_no_change" or action is None:
        return False

    # action == "inserted" or "updated"
    order_id = rpc_rows[0]["order_id"]
    db.table(SupabaseTableName.ORDER_ATTACHMENTS.value).insert(
        {
            "order_id": order_id,
            "tenant_id": tenant_id,
            "storage_path": staging_row["storage_path"],
            "original_filename": staging_row.get("original_filename", ""),
            "content_type": staging_row.get("content_type"),
            "size_bytes": staging_row.get("size_bytes"),
            "parse_status": "success",
        }
    ).execute()
    logger.info(
        f"pdf_order_parsing: order {order_id} {action} from attachment {attachment_id}"
    )

    if action == "inserted":
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
        .in_("status", ["forecast", "forecast_tentative"])
        .is_("superseded_at", "null")
        .execute()
    )


def _log_parse_event(
    db: Client,
    tenant_id: str,
    attachment_id: str,
    reason: str,
    detail: dict[str, Any],
) -> None:
    db.table(SupabaseTableName.ORDER_PARSE_LOG.value).insert(
        {
            "tenant_id": tenant_id,
            "order_attachment_id": attachment_id,
            "reason": reason,
            "detail": detail,
        }
    ).execute()
    logger.info(
        f"pdf_order_parsing: logged {reason} for attachment {attachment_id}: {detail}"
    )
