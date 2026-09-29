# backend/app/services/daily_report_service.py
"""日報ファイルの Storage 保存と重複判定 (Issue #471, 親Issue #468)。

エージェントから受け取った日報ファイルを、バケット `daily-reports` のキー
`{tenant_id}/{sha256}` に保存し、メタデータを `daily_report_files` に記録する。
呼び出し側（`routers/agent/daily_reports.py`）は service role の admin client を
渡すため、ここでのクエリはすべて `.eq("tenant_id", tenant_id)` で明示的に絞り込む。
"""

import os
import re
from datetime import datetime
from pathlib import PureWindowsPath
from typing import Any, Literal
from urllib.parse import unquote

from postgrest.exceptions import APIError
from storage3.exceptions import StorageApiError

from app.utils.calendar import JST
from app.utils.logger import get_logger
from supabase import Client  # type: ignore

logger = get_logger(__name__)

DAILY_REPORT_BUCKET = "daily-reports"

# 受信ボディの上限。バケットの file_size_limit（マイグレーションで 20MB）と揃える。
MAX_DAILY_REPORT_BYTES = int(
    os.environ.get("DAILY_REPORT_MAX_BYTES", str(20 * 1024 * 1024))
)

_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_UNIQUE_VIOLATION = "23505"

DailyReportStoreStatus = Literal["stored", "duplicate"]


class InvalidDailyReportHeaderError(ValueError):
    """エージェントが送ってきたヘッダ値が不正（400 で返す）。"""


def normalize_sha256(raw: str) -> str:
    """`X-File-Sha256` を小文字の hex に正規化する。

    PowerShell の `Get-FileHash` は大文字の hex を返すため、小文字に揃えてから
    形式を検証する（`daily_report_files.sha256` の CHECK 制約は小文字のみ）。
    """
    value = raw.strip().lower()
    if not _SHA256_PATTERN.fullmatch(value):
        raise InvalidDailyReportHeaderError("invalid sha256")
    return value


def decode_file_path(raw: str) -> tuple[str, str]:
    """URL エンコード済みの `X-File-Path` を復元し、`(original_path, file_name)` を返す。

    エージェント（PowerShell 5.1）は `[System.Uri]::EscapeDataString()` で UTF-8 の
    パーセントエンコードをして送る。パスは Windows 形式（`\\` 区切り・UNC パス）を想定する。
    """
    try:
        original_path = unquote(raw.strip(), encoding="utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise InvalidDailyReportHeaderError("invalid file path encoding") from exc
    original_path = original_path.strip()
    file_name = PureWindowsPath(original_path).name
    if not original_path or not file_name:
        raise InvalidDailyReportHeaderError("invalid file path")
    return original_path, file_name


def parse_file_modified_at(raw: str | None) -> datetime | None:
    """`X-File-Modified-At`（ISO 8601）をパースする。

    ファイルの更新日時は参考情報にすぎないため、解釈できない値でもファイル受信は
    止めずに None（NULL 保存）とする。オフセット無しの値は共有PCの現地時刻（JST）とみなす。
    """
    if raw is None or not raw.strip():
        return None
    try:
        parsed = datetime.fromisoformat(raw.strip())
    except ValueError:
        logger.warning("unparsable X-File-Modified-At header; storing NULL")
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=JST)
    return parsed


def build_storage_path(tenant_id: str, sha256: str) -> str:
    """Storage のオブジェクトキー。日本語ファイル名は含めず ASCII 安全にする。"""
    return f"{tenant_id}/{sha256}"


def _is_storage_duplicate(exc: StorageApiError) -> bool:
    # Storage API は既存オブジェクトへの upsert=false のアップロードを
    # statusCode "409" / error "Duplicate" で返す。
    return str(exc.status) == "409" or exc.code == "Duplicate"


def _upload_if_absent(admin_client: Client, storage_path: str, content: bytes) -> None:
    """upsert=false でアップロードする。既存オブジェクトなら上書きせずに戻る。

    前回の INSERT 失敗等で Storage にだけオブジェクトが残っているケースでも、
    キーが sha256 なので中身は同一であり、そのまま INSERT に進んでよい。
    """
    try:
        admin_client.storage.from_(DAILY_REPORT_BUCKET).upload(
            path=storage_path,
            file=content,
            file_options={
                "content-type": "application/octet-stream",
                "upsert": "false",
            },
        )
    except StorageApiError as exc:
        if _is_storage_duplicate(exc):
            logger.info("daily report object already exists; skipping upload")
            return
        raise


def store_daily_report(
    admin_client: Client,
    *,
    tenant_id: str,
    agent_token_id: str,
    sha256: str,
    content: bytes,
    original_path: str,
    file_name: str,
    file_modified_at: datetime | None,
) -> DailyReportStoreStatus:
    """日報ファイルを保存し、`stored` または `duplicate` を返す。

    1. `(tenant_id, sha256)` の既存行があれば `duplicate`
    2. upsert=false で Storage にアップロード（既存オブジェクトなら上書きせず進む）
    3. INSERT。unique_violation（同時送信で先を越された）なら `duplicate`
    """
    existing = (
        admin_client.table("daily_report_files")
        .select("id")
        .eq("tenant_id", tenant_id)
        .eq("sha256", sha256)
        .limit(1)
        .execute()
    )
    if existing.data:
        return "duplicate"

    storage_path = build_storage_path(tenant_id, sha256)
    _upload_if_absent(admin_client, storage_path, content)

    row: dict[str, Any] = {
        "tenant_id": tenant_id,
        "agent_token_id": agent_token_id,
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
        admin_client.table("daily_report_files").insert(row).execute()
    except APIError as exc:
        if exc.code == _UNIQUE_VIOLATION:
            return "duplicate"
        raise
    return "stored"
