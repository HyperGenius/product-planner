from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool

from app.dependencies import get_supabase_admin_client
from app.models.agent import ShipmentFileUploadResponse
from app.routers.agent import _upload
from app.routers.agent._auth import AgentContext, get_agent_context
from app.services.daily_report_service import (
    InvalidDailyReportHeaderError,
    decode_file_path,
    normalize_sha256,
    parse_file_modified_at,
)
from app.services.shipment_file_service import (
    MAX_SHIPMENT_FILE_BYTES,
    is_allowed_file_name,
    store_shipment_file,
)
from app.utils.logger import get_logger
from supabase import Client  # type: ignore

shipment_files_agent_router = APIRouter(prefix="/api/agent", tags=["Agent"])
logger = get_logger(__name__)

SHA256_HEADER = "X-File-Sha256"
PATH_HEADER = "X-File-Path"
MODIFIED_AT_HEADER = "X-File-Modified-At"


@shipment_files_agent_router.post(
    "/shipment-files",
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
async def post_shipment_file(
    request: Request,
    ctx: AgentContext = Depends(get_agent_context),
    admin_client: Client = Depends(get_supabase_admin_client),
):
    """弥生販売の売上伝票 CSV（ボディは octet-stream）を受信して保存する（Issue #662）。

    プロトコルは日報（`POST /api/agent/daily-reports`）と同じ。生ファイルを保存するだけで
    解析はしない。`tenant_id` / `agent_token_id` はトークンから解決した値だけを使う。
    """
    try:
        expected_sha256 = normalize_sha256(
            _upload.required_header(request, SHA256_HEADER)
        )
    except InvalidDailyReportHeaderError as exc:
        raise _upload.bad_request(f"Invalid {SHA256_HEADER} header.") from exc
    try:
        original_path, file_name = decode_file_path(
            _upload.required_header(request, PATH_HEADER)
        )
    except InvalidDailyReportHeaderError as exc:
        raise _upload.bad_request(f"Invalid {PATH_HEADER} header.") from exc
    if not is_allowed_file_name(file_name):
        raise _upload.bad_request("Unsupported file type.")
    file_modified_at = parse_file_modified_at(request.headers.get(MODIFIED_AT_HEADER))

    declared_length = _upload.declared_content_length(request)
    if declared_length is not None and declared_length > MAX_SHIPMENT_FILE_BYTES:
        raise _upload.too_large()

    content, actual_sha256 = await _upload.read_body_with_limit(
        request, MAX_SHIPMENT_FILE_BYTES
    )
    if actual_sha256 != expected_sha256:
        raise _upload.bad_request(f"{SHA256_HEADER} does not match the request body.")

    try:
        result = await run_in_threadpool(
            store_shipment_file,
            admin_client,
            tenant_id=ctx.tenant_id,
            source="agent",
            agent_token_id=ctx.agent_token_id,
            uploaded_by=None,
            sha256=actual_sha256,
            content=content,
            original_path=original_path,
            file_name=file_name,
            file_modified_at=file_modified_at,
        )
    except Exception as exc:
        logger.error(f"shipment file store failed: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to store shipment file.",
        ) from exc

    return ShipmentFileUploadResponse(status=result, sha256=actual_sha256)
