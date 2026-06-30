# backend/app/services/attachment_service.py
from supabase import Client

_BUCKET = "order-attachments"


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
    パス形式: {tenant_id}/orders/{order_id}/{filename}
    """
    storage_path = f"{tenant_id}/orders/{order_id}/{filename}"
    admin_client.storage.from_(_BUCKET).upload(
        path=storage_path,
        file=content,
        file_options={"content-type": content_type, "upsert": "true"},
    )
    return storage_path


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
