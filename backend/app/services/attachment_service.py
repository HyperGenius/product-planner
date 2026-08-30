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


def upload_manual_email_attachment(
    admin_client: Client,
    tenant_id: str,
    group_id: str,
    filename: str,
    content: bytes,
    content_type: str,
) -> str:
    """
    手動起票（メール起票モード）で担当者が添付したファイルを Supabase Storage に
    保存し、storage_path を返す。パス形式: {tenant_id}/manual/{group_id}/{safe_filename}

    group_id は「1回の手動起票」を束ねる任意のキー（UUID）。同一メールから複数注文を
    起こす場合でも、全注文が同じファイル（同じ storage_path）を参照する。
    tenant_id prefix を維持するため既存のバケットポリシーでカバーされる。
    """
    storage_path = f"{tenant_id}/manual/{group_id}/{_safe_filename(filename)}"
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


def create_signed_urls(
    admin_client: Client,
    storage_paths: list[str],
    expires_in: int = 3600,
) -> dict[str, str]:
    """複数ファイルの署名付きURLをまとめて生成する（N+1回避用）。
    storage_path をキーとした辞書を返す。生成に失敗したパスは含まれない。"""
    if not storage_paths:
        return {}
    responses = admin_client.storage.from_(_BUCKET).create_signed_urls(
        paths=storage_paths,
        expires_in=expires_in,
    )
    return {
        response["path"]: response["signedURL"]
        for response in responses
        if response.get("path") and not response.get("error")
    }
