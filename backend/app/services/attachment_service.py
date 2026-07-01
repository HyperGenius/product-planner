# backend/app/services/attachment_service.py
import re
import uuid

from supabase import Client

_BUCKET = "order-attachments"


def _safe_filename(filename: str) -> str:
    """Supabase Storage が受け付けるASCII安全なファイル名に変換する。
    拡張子を保持しつつ、それ以外の部分をUUIDで置き換える。"""
    ext = ""
    if "." in filename:
        ext = "." + filename.rsplit(".", 1)[-1].lower()
        ext = re.sub(r"[^a-z0-9.]", "", ext)
    return uuid.uuid4().hex + ext


def upload_attachment(
    admin_client: Client,
    tenant_id: str,
    order_id: int,
    filename: str,
    content: bytes,
    content_type: str,
) -> str:
    """
    添付ファイルを Supabase Storage にアップロードし、storage_path を返す。
    パス形式: {tenant_id}/orders/{order_id}/{safe_filename}
    元のファイル名は呼び出し元が original_filename カラムに保存する。
    """
    storage_path = f"{tenant_id}/orders/{order_id}/{_safe_filename(filename)}"
    admin_client.storage.from_(_BUCKET).upload(
        path=storage_path,
        file=content,
        file_options={"content-type": content_type, "upsert": "true"},
    )
    return storage_path


def upload_staged_attachment(
    admin_client: Client,
    tenant_id: str,
    gmail_message_id: str,
    filename: str,
    content: bytes,
    content_type: str,
) -> str:
    """
    order 未確定の添付ファイルを Supabase Storage にステージング保存し、storage_path を返す。
    パス形式: {tenant_id}/inbox/{gmail_message_id}/{safe_filename}
    元のファイル名は呼び出し元が original_filename カラムに保存する。
    """
    storage_path = f"{tenant_id}/inbox/{gmail_message_id}/{_safe_filename(filename)}"
    admin_client.storage.from_(_BUCKET).upload(
        path=storage_path,
        file=content,
        file_options={"content-type": content_type, "upsert": "true"},
    )
    return storage_path


def download_attachment(admin_client: Client, storage_path: str) -> bytes:
    """Supabase Storage から添付ファイルの内容をダウンロードする。"""
    return bytes(admin_client.storage.from_(_BUCKET).download(storage_path))


def create_signed_url(
    admin_client: Client,
    storage_path: str,
    expires_in: int = 3600,
) -> str:
    """署名付きURL（デフォルト有効期限60分）を生成して返す。"""
    response = admin_client.storage.from_(_BUCKET).create_signed_url(
        path=storage_path,
        expires_in=expires_in,
    )
    return str(response["signedURL"])
