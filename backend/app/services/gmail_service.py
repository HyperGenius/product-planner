import base64
import os
from typing import Any, cast

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.services.attachment_service import upload_staged_attachment
from app.services.customer_matching_service import (
    extract_effective_sender_email,
    resolve_or_create_customer,
)
from app.services.notification_service import create_notification
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


def _b64url_decode(data: str) -> bytes:
    """Gmail API が返すパディング無しの base64url 文字列をデコードする。

    固定で "==" を付与すると、元データの長さによっては
    ("Incorrect padding") エラーになるため、不足分だけ "=" を補う。
    """
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def _find_part_data(parts: list[dict], mime_type: str) -> str | None:
    """parts を再帰的に探索し、指定 mimeType の body.data を返す。

    PDF添付メールは multipart/mixed の中に multipart/alternative がネストし、
    その中に text/plain・text/html が入る構造になる。トップレベルの parts しか
    見ないと本文が空文字になってしまうため、ネストした parts も探索する。
    """
    for part in parts:
        if part.get("mimeType") == mime_type:
            data = part.get("body", {}).get("data", "")
            if data:
                return data
        nested = part.get("parts")
        if nested:
            found = _find_part_data(nested, mime_type)
            if found:
                return found
    return None


def _get_message_body(msg: dict) -> str:
    """Gmail API メッセージからプレーンテキスト本文を抽出する。"""
    payload = msg.get("payload", {})

    def _decode(data: str) -> str:
        return _b64url_decode(data).decode("utf-8", errors="replace")

    parts = payload.get("parts", [])
    if parts:
        data = _find_part_data(parts, "text/plain")
        if data:
            return _decode(data)
        data = _find_part_data(parts, "text/html")
        return _decode(data) if data else ""

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
        data = _b64url_decode(raw)
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

        # 4. 添付ファイル取得。PDFがあれば優先し、無ければ最初の添付を使う
        #    （複数添付の個別処理は本Issueのスコープ外。1メール1添付を前提とする）
        attachments = _get_attachments(service, msg_id, msg.get("payload", {}))
        pdf_attachment = next(
            (a for a in attachments if a["content_type"] == "application/pdf"), None
        )
        staged_attachment = pdf_attachment or (attachments[0] if attachments else None)

        # 5. 顧客マッチング（メールの受注可否に関わらず、ソース単位で1回解決する）
        sender_email = extract_effective_sender_email(body)
        customer_id, created_draft = resolve_or_create_customer(
            db, tenant_id, body, msg.get("internalDate")
        )
        if created_draft:
            create_notification(
                db,
                tenant_id,
                "customer_draft_created",
                "gmail_message",
                msg_id,
                {"customer_id": customer_id, "email": sender_email},
            )

        # 6. 添付ファイル（あれば）をStorageにステージング保存し、
        #    order_attachments に order_id=NULL のステージング行として保存する。
        #    実際のパース（本文/PDFからの line_items 抽出・複数order生成）は
        #    parse_pending_order_pdfs（cron）が非同期に行う（Issue #248, #280）。
        if staged_attachment is not None:
            storage_path = upload_staged_attachment(
                db,
                tenant_id,
                msg_id,
                staged_attachment["filename"],
                staged_attachment["data"],
                staged_attachment["content_type"],
            )
            original_filename = staged_attachment["filename"]
            content_type = staged_attachment["content_type"]
            size_bytes = len(staged_attachment["data"])
        else:
            storage_path = ""
            original_filename = ""
            content_type = None
            size_bytes = None

        db.table(SupabaseTableName.ORDER_ATTACHMENTS.value).insert(
            {
                "order_id": None,
                "tenant_id": tenant_id,
                "customer_id": customer_id,
                "gmail_message_id": msg_id,
                "source_raw": body,
                "storage_path": storage_path,
                "original_filename": original_filename,
                "content_type": content_type,
                "size_bytes": size_bytes,
                "parse_status": "pending",
            }
        ).execute()
        logger.info(
            f"msg {msg_id}: staged for deferred parsing "
            f"(tenant={tenant_id}, attachment={'yes' if staged_attachment else 'no'})"
        )

        # 7. 処理中 → 処理済み
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
