# routers/transaction/shipment_files.py
"""弥生販売の売上伝票 CSV（送品ファイル）のアプリからのアップロードと一覧 (Issue #662)。

日報エージェント端末の共有フォルダ経由（`routers/agent/shipment_files.py`）の予備経路。
共有フォルダが使えない・障害のときに、事務PCのブラウザから直接送れるようにする。
ユーザー JWT の client で書く（service role は使わない。RLS・Storage ポリシーが自テナントの
追加だけを許す）。書き込めるのは事務担当者に限り、参照はテナントメンバー全員。
"""

from typing import cast
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool

from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_current_user_role,
    get_supabase_client,
)
from app.models.agent import (
    ShipmentFileItem,
    ShipmentFileListResponse,
    ShipmentFileUploadResponse,
)
from app.routers.agent import _upload
from app.services.daily_report_service import parse_file_modified_at
from app.services.shipment_file_service import (
    MAX_SHIPMENT_FILE_BYTES,
    is_allowed_file_name,
    store_shipment_file,
    web_file_path,
)
from app.utils.logger import get_logger
from supabase import Client  # type: ignore

shipment_files_router = APIRouter(prefix="/shipment-files", tags=["Shipment Files"])
logger = get_logger(__name__)

# アップロードできるロール（送品の消し込みと同じ事務担当者）
SHIPMENT_FILE_UPLOAD_ROLES = ("order_handler", "president", "platform_admin")

FILE_NAME_HEADER = "X-File-Name"
MODIFIED_AT_HEADER = "X-File-Modified-At"
RECENT_FILE_LIMIT = 20


@shipment_files_router.get("", response_model=ShipmentFileListResponse)
def list_shipment_files(
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
) -> ShipmentFileListResponse:
    """最終取り込み日時と、直近の取り込み済みファイル（解析の結果つき。Issue #667）を返す。"""
    res = (
        client.table("shipment_files")
        .select(
            "id, file_name, source, size_bytes, received_at, parse_status, "
            "parse_error, parsed_at, period_start, period_end, entry_count, "
            "skipped_count, replace_result"
        )
        .eq("tenant_id", tenant_id)
        .order("received_at", desc=True)
        .limit(RECENT_FILE_LIMIT)
        .execute()
    )
    rows = cast(list[dict], res.data or [])
    files = [ShipmentFileItem(**row) for row in rows]
    return ShipmentFileListResponse(
        last_received_at=files[0].received_at if files else None,
        files=files,
    )


@shipment_files_router.post(
    "",
    response_model=ShipmentFileUploadResponse,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "application/octet-stream": {
                    "schema": {"type": "string", "format": "binary"}
                }
            },
        }
    },
)
async def upload_shipment_file(
    request: Request,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
) -> ShipmentFileUploadResponse:
    """売上伝票 CSV（ボディは octet-stream）を保存する。

    ヘッダ:
    - `X-File-Name`（必須）: 元のファイル名（UTF-8 で URL エンコード済み）
    - `X-File-Modified-At`（任意）: ファイルの更新日時（ISO 8601）

    SHA-256 はブラウザに計算させず、ボディを読みながらサーバーで求める。
    """
    role = await run_in_threadpool(get_current_user_role, tenant_id, user_id, client)
    if role not in SHIPMENT_FILE_UPLOAD_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "送品ファイルのアップロードは "
                f"{'/'.join(SHIPMENT_FILE_UPLOAD_ROLES)} のみ操作できます"
            ),
        )

    try:
        raw_name = unquote(
            _upload.required_header(request, FILE_NAME_HEADER),
            encoding="utf-8",
            errors="strict",
        )
    except UnicodeDecodeError as exc:
        raise _upload.bad_request(f"Invalid {FILE_NAME_HEADER} header.") from exc
    original_path, file_name = web_file_path(raw_name)
    if not file_name:
        raise _upload.bad_request(f"Invalid {FILE_NAME_HEADER} header.")
    if not is_allowed_file_name(file_name):
        raise _upload.bad_request("Unsupported file type.")
    file_modified_at = parse_file_modified_at(request.headers.get(MODIFIED_AT_HEADER))

    declared_length = _upload.declared_content_length(request)
    if declared_length is not None and declared_length > MAX_SHIPMENT_FILE_BYTES:
        raise _upload.too_large()
    content, sha256 = await _upload.read_body_with_limit(
        request, MAX_SHIPMENT_FILE_BYTES
    )
    if not content:
        raise _upload.bad_request("Empty file.")

    try:
        result = await run_in_threadpool(
            store_shipment_file,
            client,
            tenant_id=tenant_id,
            source="web",
            agent_token_id=None,
            uploaded_by=user_id,
            sha256=sha256,
            content=content,
            original_path=original_path,
            file_name=file_name,
            file_modified_at=file_modified_at,
        )
    except Exception as exc:
        logger.error(f"shipment file upload failed: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to store shipment file.",
        ) from exc

    return ShipmentFileUploadResponse(status=result, sha256=sha256)
