"""顧客ごとの抽出指示の試し読み（Issue #602）。

過去に届いたPDF（order_attachments のステージング行）を、今の指示と編集中の指示の両方で
読み取って結果を返す。PDFの読み分け（テキスト／画像／読めない）、抽出、明細の解釈・製品の
照合は取り込み（`pdf_order_parsing_service`）と同じ関数を使い、試し読みの結果が実際の起票と
ずれないようにする。

**起票・更新・ログ・通知は一切しない**（読み込みのみ）。顧客は編集中の顧客に固定する
（取り込みでは文面・発行元から顧客を解決し直すが、試し読みはその顧客の指示を確かめるためのもの）。
"""

from dataclasses import dataclass
from typing import Any, Literal, cast

from app.models.master.customer_extraction_prompt_schemas import (
    normalize_extraction_prompt,
)
from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.services.attachment_service import download_attachment
from app.services.pdf_order_extraction_service import (
    PdfDocumentRejectedError,
    extract_order_lines,
    extract_order_lines_from_pdf,
)
from app.services.pdf_order_parsing_service import (
    LineItemReading,
    generate_pdf_auto_customer_order_no,
    is_repair_extraction,
    read_line_item,
)
from app.services.pdf_text_service import MAX_PDF_BYTES, PdfTooLargeError, extract_text
from supabase import Client

_PDF_CONTENT_TYPE = "application/pdf"

# 試し読みに選べる過去のPDFの件数
ATTACHMENT_LIST_LIMIT = 50
# 顧客の受注から添付を探すときに見る受注の件数（新しい順）
_ORDER_SCAN_LIMIT = 500

_ATTACHMENT_COLUMNS = (
    "id, tenant_id, customer_id, storage_path, original_filename, content_type, "
    "size_bytes, created_at"
)


@dataclass(frozen=True)
class ExtractionReading:
    """1つの指示で読み取った結果。"""

    error: Literal["document_rejected"] | None
    document_order_no: str | None
    is_repair: bool
    subject: str | None
    line_items: list[LineItemReading]
    fallback: Literal["email_body", "unreadable_draft"] | None


@dataclass(frozen=True)
class ExtractionPreview:
    source: Literal["text", "image"] | None
    unreadable_reason: Literal["failed_encrypted", "failed_too_large"] | None
    current: ExtractionReading | None
    edited: ExtractionReading | None
    same_prompt: bool
    # 照合できた製品（表示用）。product_id → {"id", "code", "name"}
    products: dict[int, dict[str, Any]]


def _staging_pdf_query(db: Client, tenant_id: str) -> Any:
    return (
        db.table(SupabaseTableName.ORDER_ATTACHMENTS.value)
        .select(_ATTACHMENT_COLUMNS)
        .eq("tenant_id", tenant_id)
        .is_("order_id", "null")
        .eq("content_type", _PDF_CONTENT_TYPE)
        .neq("storage_path", "")
    )


def _attachment_ids_of_customer_orders(
    db: Client, tenant_id: str, customer_id: int
) -> list[str]:
    """その顧客の受注の起票元（orders.source_attachment_id）。

    束ね添付メールで PDF の文面から顧客を解決し直した受注は、ステージング行の customer_id が
    メール単位の顧客のまま残る（Issue #385）ので、受注の側からも探す。
    """
    result = (
        db.table(SupabaseTableName.ORDERS.value)
        .select("source_attachment_id")
        .eq("tenant_id", tenant_id)
        .eq("customer_id", customer_id)
        .not_.is_("source_attachment_id", "null")
        .order("id", desc=True)
        .limit(_ORDER_SCAN_LIMIT)
        .execute()
    )
    rows = cast(list[dict[str, Any]], result.data or [])
    return list(dict.fromkeys(str(row["source_attachment_id"]) for row in rows))


def list_customer_pdf_attachments(
    db: Client, tenant_id: str, customer_id: int
) -> list[dict[str, Any]]:
    """試し読みに使える、その顧客の過去の受信PDF（新しい順）。"""
    direct = (
        _staging_pdf_query(db, tenant_id)
        .eq("customer_id", customer_id)
        .order("created_at", desc=True)
        .limit(ATTACHMENT_LIST_LIMIT)
        .execute()
    )
    rows = cast(list[dict[str, Any]], direct.data or [])

    order_attachment_ids = _attachment_ids_of_customer_orders(
        db, tenant_id, customer_id
    )
    known_ids = {str(row["id"]) for row in rows}
    missing_ids = [id_ for id_ in order_attachment_ids if id_ not in known_ids]
    if missing_ids:
        via_orders = _staging_pdf_query(db, tenant_id).in_("id", missing_ids).execute()
        rows.extend(cast(list[dict[str, Any]], via_orders.data or []))

    rows.sort(key=lambda row: str(row["created_at"]), reverse=True)
    return rows[:ATTACHMENT_LIST_LIMIT]


def find_customer_pdf_attachment(
    db: Client, tenant_id: str, customer_id: int, attachment_id: str
) -> dict[str, Any] | None:
    """試し読みに使える添付か確かめて返す（同じテナント・同じ顧客の受信PDFだけ）。

    `attachment_id` だけを信用しないよう、テナント・ステージング行・PDFであることを条件に引き、
    顧客はステージング行の customer_id か、その添付から起票した受注の顧客で確かめる。
    """
    result = (
        _staging_pdf_query(db, tenant_id).eq("id", attachment_id).limit(1).execute()
    )
    rows = cast(list[dict[str, Any]], result.data or [])
    if not rows:
        return None
    row = rows[0]
    if row.get("customer_id") == customer_id:
        return row

    orders = (
        db.table(SupabaseTableName.ORDERS.value)
        .select("id")
        .eq("tenant_id", tenant_id)
        .eq("customer_id", customer_id)
        .eq("source_attachment_id", attachment_id)
        .limit(1)
        .execute()
    )
    return row if orders.data else None


def _read(
    db: Client,
    tenant_id: str,
    customer_id: int,
    content: bytes,
    pdf_text: str | None,
    prompt: str | None,
) -> ExtractionReading:
    """1つの指示で読み取り、明細を解釈する。pdf_text が None なら画像PDFとして読む。"""
    if pdf_text is not None:
        extraction = extract_order_lines(pdf_text, prompt)
    else:
        try:
            extraction = extract_order_lines_from_pdf(content, prompt)
        except PdfDocumentRejectedError:
            return ExtractionReading(
                error="document_rejected",
                document_order_no=None,
                is_repair=False,
                subject=None,
                line_items=[],
                fallback="unreadable_draft",
            )

    document_order_no: str | None = extraction.get("document_order_no")
    auto_order_no = generate_pdf_auto_customer_order_no(customer_id, pdf_text, content)
    raw_lines = cast(list[dict[str, Any]], extraction["line_items"])
    line_items = [
        read_line_item(
            db, tenant_id, customer_id, line, document_order_no, auto_order_no
        )
        for line in raw_lines
    ]
    is_repair = is_repair_extraction(extraction)

    fallback: Literal["email_body", "unreadable_draft"] | None = None
    if not line_items and not is_repair:
        fallback = "email_body" if pdf_text is not None else "unreadable_draft"

    return ExtractionReading(
        error=None,
        document_order_no=document_order_no,
        is_repair=is_repair,
        subject=extraction.get("subject"),
        line_items=line_items,
        fallback=fallback,
    )


def _load_products(
    db: Client, tenant_id: str, readings: list[ExtractionReading | None]
) -> dict[int, dict[str, Any]]:
    product_ids = sorted(
        {
            line.product_id
            for reading in readings
            if reading is not None
            for line in reading.line_items
            if line.product_id is not None
        }
    )
    if not product_ids:
        return {}
    result = (
        db.table(SupabaseTableName.PRODUCTS.value)
        .select("id, code, name")
        .eq("tenant_id", tenant_id)
        .in_("id", product_ids)
        .execute()
    )
    return {
        int(row["id"]): row for row in cast(list[dict[str, Any]], result.data or [])
    }


def _unreadable(
    reason: Literal["failed_encrypted", "failed_too_large"], same_prompt: bool
) -> ExtractionPreview:
    return ExtractionPreview(
        source=None,
        unreadable_reason=reason,
        current=None,
        edited=None,
        same_prompt=same_prompt,
        products={},
    )


def preview_extraction(
    db: Client,
    tenant_id: str,
    customer_id: int,
    attachment: dict[str, Any],
    current_prompt: str | None,
    edited_prompt: str | None,
) -> ExtractionPreview:
    """
    添付のPDFを今の指示と編集中の指示で読み取る。2つの指示が同じなら1回だけ読む。

    Claude API の一時的な失敗（レート制限・5xx・接続エラー）はそのまま送出する
    （呼び出し側で「時間をおいて試す」応答にする）。
    """
    current_prompt = normalize_extraction_prompt(current_prompt)
    edited_prompt = normalize_extraction_prompt(edited_prompt)
    same_prompt = current_prompt == edited_prompt

    # 取り込みと同じく、ダウンロード前に分かるサイズで弾けるものは弾く
    known_size = attachment.get("size_bytes")
    if isinstance(known_size, int) and known_size > MAX_PDF_BYTES:
        return _unreadable("failed_too_large", same_prompt)

    content = download_attachment(db, attachment["storage_path"])
    try:
        text_result = extract_text(content)
    except PdfTooLargeError:
        return _unreadable("failed_too_large", same_prompt)

    if text_result.failure_reason == "failed_image":
        source: Literal["text", "image"] = "image"
        pdf_text = None
    elif text_result.failure_reason is not None:
        # 暗号化（パスワード付き）。取り込みでも読み取り不能の下書きになる
        return _unreadable("failed_encrypted", same_prompt)
    else:
        source = "text"
        pdf_text = text_result.text

    current = _read(db, tenant_id, customer_id, content, pdf_text, current_prompt)
    edited = (
        current
        if same_prompt
        else _read(db, tenant_id, customer_id, content, pdf_text, edited_prompt)
    )
    return ExtractionPreview(
        source=source,
        unreadable_reason=None,
        current=current,
        edited=edited,
        same_prompt=same_prompt,
        products=_load_products(db, tenant_id, [current, edited]),
    )
