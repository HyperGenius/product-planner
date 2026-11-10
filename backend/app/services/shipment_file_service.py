# backend/app/services/shipment_file_service.py
"""弥生販売の売上伝票 CSV（送品ファイル）の Storage 保存と重複判定 (Issue #662)。

生ファイルを保存するだけで、解析・突合はしない（CSV の形式が確定してから別の変更で足す。
エージェントを形式に依存させず、解析の修正を再訪問なしで出せるようにするため）。

経路は2つ:
  - `source="agent"`: 日報エージェント端末が共有フォルダから回収して送る。service role の
    admin client で書くので、クエリはすべて `.eq("tenant_id", tenant_id)` で明示的に絞る。
  - `source="web"`: 事務PCのブラウザからのアップロード。ユーザー JWT の client で書く
    （RLS・Storage ポリシーが自テナントの追加だけを許す。マイグレーション参照）。

バケット `shipment-files` のキーは `{tenant_id}/{sha256}{拡張子}`。
ヘッダ・パスの解釈とハッシュ・拡張子の扱いは日報（`daily_report_service`）と共通。
"""

import os
from datetime import datetime
from pathlib import PureWindowsPath
from typing import Any, Literal

from postgrest.exceptions import APIError
from storage3.exceptions import StorageApiError

from app.services.daily_report_service import (
    build_storage_path,
    storage_extension,
)
from app.utils.logger import get_logger
from supabase import Client  # type: ignore

logger = get_logger(__name__)

SHIPMENT_FILE_BUCKET = "shipment-files"

# 受信ボディの上限。バケットの file_size_limit（マイグレーションで 20MB）と揃える。
MAX_SHIPMENT_FILE_BYTES = int(
    os.environ.get("SHIPMENT_FILE_MAX_BYTES", str(20 * 1024 * 1024))
)

# 弥生販売のエクスポートで想定する拡張子（テキスト／CSV）。Excel は受けない。
ALLOWED_EXTENSIONS = (".csv", ".txt")
# mimetypes に頼らず明示する（CLAUDE.md「Storage のオブジェクトキーと content-type」）。
_CONTENT_TYPES: dict[str, str] = {
    ".csv": "text/csv",
    ".txt": "text/plain",
}
_DEFAULT_CONTENT_TYPE = "application/octet-stream"
_UNIQUE_VIOLATION = "23505"

ShipmentFileSource = Literal["agent", "web"]
ShipmentFileStoreStatus = Literal["stored", "duplicate"]


def is_allowed_file_name(file_name: str) -> bool:
    return storage_extension(file_name) in ALLOWED_EXTENSIONS


def content_type_for(file_name: str) -> str:
    return _CONTENT_TYPES.get(storage_extension(file_name), _DEFAULT_CONTENT_TYPE)


def web_file_path(file_name: str) -> tuple[str, str]:
    """ブラウザから送られたファイル名を `(original_path, file_name)` にする。

    ブラウザはパスを渡さないのでファイル名だけを保存する。区切り文字を含んでいても
    末尾の名前だけを採る（Storage のキーには使わないが、表示に出すため）。
    """
    name = PureWindowsPath(file_name.strip()).name
    return name, name


def _is_storage_duplicate(exc: StorageApiError) -> bool:
    return str(exc.status) == "409" or exc.code == "Duplicate"


def _upload_if_absent(
    client: Client, storage_path: str, content: bytes, content_type: str
) -> None:
    """upsert=false でアップロードする。既存オブジェクトなら上書きせずに戻る。

    キーが sha256 なので既存オブジェクトの中身は同一であり、そのまま INSERT に進んでよい。
    """
    try:
        client.storage.from_(SHIPMENT_FILE_BUCKET).upload(
            path=storage_path,
            file=content,
            file_options={"content-type": content_type, "upsert": "false"},
        )
    except StorageApiError as exc:
        if _is_storage_duplicate(exc):
            logger.info("shipment file object already exists; skipping upload")
            return
        raise


def store_shipment_file(
    client: Client,
    *,
    tenant_id: str,
    source: ShipmentFileSource,
    agent_token_id: str | None,
    uploaded_by: str | None,
    sha256: str,
    content: bytes,
    original_path: str,
    file_name: str,
    file_modified_at: datetime | None,
) -> ShipmentFileStoreStatus:
    """送品ファイルを保存し、`stored` または `duplicate` を返す。

    1. `(tenant_id, sha256)` の既存行があれば `duplicate`
    2. upsert=false で Storage にアップロード
    3. INSERT。unique_violation（同時送信で先を越された）なら `duplicate`
    """
    existing = (
        client.table("shipment_files")
        .select("id")
        .eq("tenant_id", tenant_id)
        .eq("sha256", sha256)
        .limit(1)
        .execute()
    )
    if existing.data:
        return "duplicate"

    storage_path = build_storage_path(tenant_id, sha256, file_name)
    _upload_if_absent(client, storage_path, content, content_type_for(file_name))

    row: dict[str, Any] = {
        "tenant_id": tenant_id,
        "source": source,
        "agent_token_id": agent_token_id,
        "uploaded_by": uploaded_by,
        "sha256": sha256,
        "storage_path": storage_path,
        "original_path": original_path,
        "file_name": file_name,
        "size_bytes": len(content),
        "file_modified_at": (
            file_modified_at.isoformat() if file_modified_at else None
        ),
    }
    try:
        client.table("shipment_files").insert(row).execute()
    except APIError as exc:
        if exc.code == _UNIQUE_VIOLATION:
            return "duplicate"
        raise
    return "stored"
