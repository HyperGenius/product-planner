import base64
import os
from typing import Any, cast

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.services.attachment_service import upload_attachment, upload_staged_attachment
from app.services.customer_matching_service import (
    extract_sender_email,
    resolve_or_create_customer,
)
from app.services.email_extraction_service import extract_email_fields
from app.services.product_matching_service import match_products
from app.utils.logger import get_logger
from supabase import Client

logger = get_logger(__name__)

_GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.modify"]

# Label name prefixes — full label names are "{prefix}/{tenant_name}"
_PREFIX_PENDING = os.environ.get("GMAIL_LABEL_PREFIX_PENDING", "pp-pending")
_PREFIX_PROCESSING = os.environ.get("GMAIL_LABEL_PREFIX_PROCESSING", "pp-processing")
_PREFIX_DONE = os.environ.get("GMAIL_LABEL_PREFIX_DONE", "pp-done")
_PREFIX_ERROR = os.environ.get("GMAIL_LABEL_PREFIX_ERROR", "pp-error")


def _build_gmail_client():
    client_id = os.environ.get("GMAIL_CLIENT_ID")
    client_secret = os.environ.get("GMAIL_CLIENT_SECRET")
    refresh_token = os.environ.get("GMAIL_REFRESH_TOKEN")

    if not all([client_id, client_secret, refresh_token]):
        raise ValueError(
            "Missing Gmail OAuth env vars: GMAIL_CLIENT_ID, "
            "GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN must all be set."
        )

    creds = Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=client_id,
        client_secret=client_secret,
        scopes=_GMAIL_SCOPES,
    )
    creds.refresh(Request())
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def _get_label_id_map(service) -> dict[str, str]:
    """ラベル名 → Gmail label ID のマップを返す。"""
    result = service.users().labels().list(userId="me").execute()
    return {lbl["name"]: lbl["id"] for lbl in result.get("labels", [])}


def _get_message_body(msg: dict) -> str:
    """Gmail API メッセージからプレーンテキスト本文を抽出する。"""
    payload = msg.get("payload", {})

    def _decode(data: str) -> str:
        return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")

    parts = payload.get("parts", [])
    if parts:
        for part in parts:
            if part.get("mimeType") == "text/plain":
                body_data = part.get("body", {}).get("data", "")
                if body_data:
                    return _decode(body_data)
        # fallback: first part
        body_data = parts[0].get("body", {}).get("data", "")
        return _decode(body_data) if body_data else ""

    body_data = payload.get("body", {}).get("data", "")
    return _decode(body_data) if body_data else ""


def _lookup_tenant_id(db: Client, tenant_name: str) -> str | None:
    """ラベルのテナント名部分から tenant_id を引く。"""
    table = SupabaseTableName.GMAIL_LABEL_TENANTS.value
    result = (
        db.table(table)
        .select("tenant_id")
        .eq("label_name", tenant_name)
        .limit(1)
        .execute()
    )
    rows = cast(list[dict[str, Any]], result.data or [])
    return str(rows[0]["tenant_id"]) if rows else None


def _get_attachments(service, msg_id: str, payload: dict) -> list[dict[str, Any]]:
    """
    Gmail メッセージの parts から添付ファイル情報を収集し、バイナリデータと共に返す。
    返り値: [{"filename": str, "content_type": str, "data": bytes}, ...]
    """
    results: list[dict[str, Any]] = []
    parts = payload.get("parts", [])
    for part in parts:
        attachment_id = part.get("body", {}).get("attachmentId")
        filename = part.get("filename", "")
        if not attachment_id or not filename:
            continue
        content_type = part.get("mimeType", "application/octet-stream")
        attachment = (
            service.users()
            .messages()
            .attachments()
            .get(userId="me", messageId=msg_id, id=attachment_id)
            .execute()
        )
        raw = attachment.get("data", "")
        data = base64.urlsafe_b64decode(raw + "==")
        results.append(
            {"filename": filename, "content_type": content_type, "data": data}
        )
    return results


def _move_label(
    service, msg_id: str, add_id: str | None, remove_id: str | None
) -> None:
    add_ids = [add_id] if add_id else []
    remove_ids = [remove_id] if remove_id else []
    if not add_ids and not remove_ids:
        return
    service.users().messages().modify(
        userId="me",
        id=msg_id,
        body={"addLabelIds": add_ids, "removeLabelIds": remove_ids},
    ).execute()


def _process_message(
    service,
    db: Client,
    msg_id: str,
    tenant_name: str,
    label_id_map: dict[str, str],
) -> None:
    pending_label = f"{_PREFIX_PENDING}/{tenant_name}"
    processing_label = f"{_PREFIX_PROCESSING}/{tenant_name}"
    done_label = f"{_PREFIX_DONE}/{tenant_name}"
    error_label = f"{_PREFIX_ERROR}/{tenant_name}"

    processing_id = label_id_map.get(processing_label)
    pending_id = label_id_map.get(pending_label)
    done_id = label_id_map.get(done_label)
    error_id = label_id_map.get(error_label)

    # 1. 処理待ち → 処理中 (二重処理防止)
    _move_label(service, msg_id, processing_id, pending_id)
    logger.info(f"msg {msg_id}: moved to {processing_label}")

    try:
        # 2. 本文取得
        msg = (
            service.users()
            .messages()
            .get(userId="me", id=msg_id, format="full")
            .execute()
        )
        body = _get_message_body(msg)

        # 3. テナント解決
        tenant_id = _lookup_tenant_id(db, tenant_name)
        if not tenant_id:
            raise ValueError(f"tenant not found for label: {tenant_name}")

        # 4. 添付ファイル取得（PDF判定のため単一フィールド抽出より前に行う）
        attachments = _get_attachments(service, msg_id, msg.get("payload", {}))
        pdf_attachment = next(
            (a for a in attachments if a["content_type"] == "application/pdf"), None
        )

        if pdf_attachment is not None:
            # PDF添付メール: orderは作成せず、order_attachments にステージング保存する
            # （パースして複数orderを生成する処理は後続Issueで実装）
            sender_email = extract_sender_email(body)
            customer_id = (
                resolve_or_create_customer(db, tenant_id, sender_email)
                if sender_email
                else None
            )

            storage_path = upload_staged_attachment(
                db,
                tenant_id,
                msg_id,
                pdf_attachment["filename"],
                pdf_attachment["data"],
                pdf_attachment["content_type"],
            )
            db.table(SupabaseTableName.ORDER_ATTACHMENTS.value).insert(
                {
                    "order_id": None,
                    "tenant_id": tenant_id,
                    "customer_id": customer_id,
                    "gmail_message_id": msg_id,
                    "source_raw": body,
                    "storage_path": storage_path,
                    "original_filename": pdf_attachment["filename"],
                    "content_type": pdf_attachment["content_type"],
                    "size_bytes": len(pdf_attachment["data"]),
                    "parse_status": "pending",
                }
            ).execute()
            logger.info(
                f"msg {msg_id}: PDF attachment staged at {storage_path} "
                f"(tenant={tenant_id}, order not created)"
            )

            # 5. 処理中 → 処理済み
            _move_label(service, msg_id, done_id, processing_id)
            return

        # 添付なし・非PDF添付メール: 既存フロー（即時order作成）を維持する

        # 5. Claude で注文フィールド抽出
        raw_fields = extract_email_fields(body)
        fields = {k: (None if v == "<UNKNOWN>" else v) for k, v in raw_fields.items()}
        logger.info(f"msg {msg_id}: extracted fields={fields}")

        # 6. 製品マッチング
        product_id: int | None = None
        candidates: list[dict] = []
        product_name: str | None = fields.get("product_name")
        if product_name:
            match = match_products(db, tenant_id, product_name)
            product_id = match["product_id"]
            candidates = match["candidates"]

        # 7. 顧客マッチング
        customer_id = None
        sender_email = extract_sender_email(body)
        if sender_email:
            customer_id = resolve_or_create_customer(db, tenant_id, sender_email)

        # 8. ドラフト注文を Supabase に登録
        order_row: dict[str, Any] = {
            "tenant_id": tenant_id,
            "source_type": "email",
            "source_raw": body,
            "status": "draft",
            "product_id": product_id,
            "quantity": fields.get("quantity"),
            "deadline_date": fields.get("deadline_date"),
            "order_number": fields.get("order_number"),
            "extracted_product_name": fields.get("product_name"),
            "product_candidates": candidates if candidates else None,
            "customer_id": customer_id,
        }
        insert_result = (
            db.table(SupabaseTableName.ORDERS.value).insert(order_row).execute()
        )
        order_id: int = cast(list[dict[str, Any]], insert_result.data)[0]["id"]
        logger.info(
            f"msg {msg_id}: order draft created (id={order_id}) for tenant {tenant_id}"
        )

        # 9. 添付ファイル（非PDF）を Storage に保存し order_attachments に記録
        if attachments:
            # 現在は1メール1添付を前提とし、最初の添付のみ処理する
            att = attachments[0]
            storage_path = upload_attachment(
                db,
                tenant_id,
                order_id,
                att["filename"],
                att["data"],
                att["content_type"],
            )
            db.table(SupabaseTableName.ORDER_ATTACHMENTS.value).insert(
                {
                    "order_id": order_id,
                    "tenant_id": tenant_id,
                    "storage_path": storage_path,
                    "original_filename": att["filename"],
                    "content_type": att["content_type"],
                    "size_bytes": len(att["data"]),
                    "parse_status": "pending",
                }
            ).execute()
            logger.info(f"msg {msg_id}: attachment saved to {storage_path}")
        else:
            db.table(SupabaseTableName.ORDER_ATTACHMENTS.value).insert(
                {
                    "order_id": order_id,
                    "tenant_id": tenant_id,
                    "storage_path": "",
                    "original_filename": "",
                    "parse_status": "failed_no_attachment",
                }
            ).execute()
            logger.info(f"msg {msg_id}: no attachment found")

        # 10. 処理中 → 処理済み
        _move_label(service, msg_id, done_id, processing_id)

    except Exception as exc:
        logger.error(f"msg {msg_id}: processing failed: {exc}", exc_info=True)
        # 処理中 → エラー
        _move_label(service, msg_id, error_id, processing_id)
        raise


def poll_unread_emails(db: Client) -> dict[str, Any]:
    """処理待ちラベルのメールを取得し、注文ドラフトを作成して件数を返す。"""
    service = _build_gmail_client()
    label_id_map = _get_label_id_map(service)

    # 処理待ち/* ラベルを持つメッセージを列挙
    pending_label_ids = [
        lid
        for name, lid in label_id_map.items()
        if name.startswith(f"{_PREFIX_PENDING}/")
    ]

    if not pending_label_ids:
        logger.info("Gmail poll: no pending labels found.")
        return {"processed": 0, "errors": 0}

    messages: list[dict] = []
    for label_id in pending_label_ids:
        page_token: str | None = None
        while True:
            kwargs: dict[str, Any] = {
                "userId": "me",
                "labelIds": [label_id],
                "maxResults": 500,
            }
            if page_token:
                kwargs["pageToken"] = page_token
            result = service.users().messages().list(**kwargs).execute()
            for m in result.get("messages", []):
                messages.append({"id": m["id"], "label_id": label_id})
            page_token = result.get("nextPageToken")
            if not page_token:
                break

    if not messages:
        logger.info("Gmail poll: no messages in pending labels.")
        return {"processed": 0, "errors": 0}

    logger.info(f"Gmail poll: {len(messages)} messages to process.")

    # label_id → テナント名 逆引き
    id_to_tenant: dict[str, str] = {
        lid: name.removeprefix(f"{_PREFIX_PENDING}/")
        for name, lid in label_id_map.items()
        if name.startswith(f"{_PREFIX_PENDING}/")
    }

    processed = 0
    errors = 0
    for m in messages:
        tenant_name = id_to_tenant.get(m["label_id"], "")
        try:
            _process_message(service, db, m["id"], tenant_name, label_id_map)
            processed += 1
        except Exception:
            errors += 1

    logger.info(f"Gmail poll complete: processed={processed} errors={errors}")
    return {"processed": processed, "errors": errors}
