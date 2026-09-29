import hashlib

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool

from app.dependencies import get_supabase_admin_client
from app.models.agent import DailyReportUploadResponse
from app.routers.agent._auth import AgentContext, get_agent_context
from app.services.daily_report_service import (
    MAX_DAILY_REPORT_BYTES,
    InvalidDailyReportHeaderError,
    decode_file_path,
    normalize_sha256,
    parse_file_modified_at,
    store_daily_report,
)
from app.utils.logger import get_logger
from supabase import Client  # type: ignore

daily_reports_router = APIRouter(prefix="/api/agent", tags=["Agent"])
logger = get_logger(__name__)

SHA256_HEADER = "X-File-Sha256"
PATH_HEADER = "X-File-Path"
MODIFIED_AT_HEADER = "X-File-Modified-At"


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _too_large() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_413_CONTENT_TOO_LARGE,
        detail="File too large.",
    )


def _required_header(request: Request, name: str) -> str:
    value = request.headers.get(name)
    if value is None or not value.strip():
        raise _bad_request(f"Missing required header: {name}.")
    return value


def _declared_content_length(request: Request) -> int | None:
    raw = request.headers.get("Content-Length")
    if raw is None:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


async def _read_body_with_limit(request: Request, max_bytes: int) -> tuple[bytes, str]:
    """上限を超えた時点で 413 を投げながらボディを読み、`(content, sha256)` を返す。

    `Content-Length` 省略（チャンク転送）にも対応するため、宣言値ではなく
    実際に読んだ累計バイト数で判定する。
    """
    hasher = hashlib.sha256()
    buf = bytearray()
    async for chunk in request.stream():
        if len(buf) + len(chunk) > max_bytes:
            raise _too_large()
        hasher.update(chunk)
        buf.extend(chunk)
    return bytes(buf), hasher.hexdigest()


@daily_reports_router.post(
    "/daily-reports",
    response_model=DailyReportUploadResponse,
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
async def post_daily_report(
    request: Request,
    ctx: AgentContext = Depends(get_agent_context),
    admin_client: Client = Depends(get_supabase_admin_client),
):
    """日報ファイル（ボディは octet-stream）を受信して保存する（Issue #471）。

    メタデータはヘッダで受け取る:
    - `X-File-Sha256`（必須）: ファイル本体の SHA-256（hex、大文字小文字は問わない）
    - `X-File-Path`（必須）: 元のファイルパス（UTF-8 で URL エンコード済み）
    - `X-File-Modified-At`（任意）: ファイルの更新日時（ISO 8601）

    `tenant_id` / `agent_token_id` はトークンから解決した値だけを使う。
    `request.stream()` を使うため async にし、同期の supabase-py 呼び出しは
    `run_in_threadpool` でイベントループの外に出す。
    """
    # ボディを読む前にヘッダを検証する（不正なリクエストで 20MB を読まないため）。
    try:
        expected_sha256 = normalize_sha256(_required_header(request, SHA256_HEADER))
    except InvalidDailyReportHeaderError as exc:
        raise _bad_request(f"Invalid {SHA256_HEADER} header.") from exc
    try:
        original_path, file_name = decode_file_path(
            _required_header(request, PATH_HEADER)
        )
    except InvalidDailyReportHeaderError as exc:
        raise _bad_request(f"Invalid {PATH_HEADER} header.") from exc
    file_modified_at = parse_file_modified_at(request.headers.get(MODIFIED_AT_HEADER))

    declared_length = _declared_content_length(request)
    if declared_length is not None and declared_length > MAX_DAILY_REPORT_BYTES:
        raise _too_large()

    content, actual_sha256 = await _read_body_with_limit(
        request, MAX_DAILY_REPORT_BYTES
    )
    if actual_sha256 != expected_sha256:
        raise _bad_request(f"{SHA256_HEADER} does not match the request body.")

    try:
        result = await run_in_threadpool(
            store_daily_report,
            admin_client,
            tenant_id=ctx.tenant_id,
            agent_token_id=ctx.agent_token_id,
            sha256=actual_sha256,
            content=content,
            original_path=original_path,
            file_name=file_name,
            file_modified_at=file_modified_at,
        )
    except Exception as exc:
        # 例外の詳細はログにのみ残し、レスポンスは固定文言にする（内部情報の露出防止）。
        logger.error(f"daily report store failed: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to store daily report.",
        ) from exc

    return DailyReportUploadResponse(status=result, sha256=actual_sha256)
