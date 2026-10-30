# routers/master/customer_extraction_prompt.py
"""顧客ごとの抽出指示の編集・試し読み・変更履歴 API（Issue #602）。

抽出指示（customers.order_extraction_prompt）は、受注のPDF・メール本文からの明細抽出で
汎用プロンプトに足される顧客固有の指示。編集・試し読み・履歴の閲覧は当面 platform_admin
（開発・運用者）だけに許す。顧客の一覧・詳細の API は指示の本文を返さない。
"""

import threading
import time
from collections import defaultdict, deque
from typing import Any, cast

import anthropic
from fastapi import APIRouter, Depends, HTTPException, status
from postgrest.exceptions import APIError
from storage3.exceptions import StorageApiError

from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_current_user_role,
    get_supabase_client,
)
from app.models.master.customer_extraction_prompt_schemas import (
    ExtractionPreviewRequest,
    ExtractionPreviewResponse,
    ExtractionPromptAttachment,
    ExtractionPromptHistoryItem,
    ExtractionPromptResponse,
    ExtractionPromptSaveResponse,
    ExtractionPromptUpdate,
    PreviewLineItem,
    PreviewProduct,
    PreviewReading,
)
from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.services.extraction_prompt_preview_service import (
    ExtractionReading,
    find_customer_pdf_attachment,
    list_customer_pdf_attachments,
    preview_extraction,
)
from app.utils.logger import get_logger
from supabase import Client  # type: ignore

customer_extraction_prompt_router = APIRouter(
    prefix="/customers", tags=["Master (Customer Extraction Prompt)"]
)

logger = get_logger(__name__)

# 抽出指示を編集・試し読み・履歴の閲覧ができるロール。RPC save_customer_extraction_prompt と
# Frontend の EXTRACTION_PROMPT_EDITOR_ROLES と揃える
_EXTRACTION_PROMPT_EDITOR_ROLES = ("platform_admin",)

# 試し読みは1回で Claude API を最大2回呼ぶので、テナント単位で回数を絞る。
# プロセス内の簡易な制限（インスタンスが複数あればそれぞれで数える）
_PREVIEW_RATE_LIMIT = 10
_PREVIEW_RATE_WINDOW_SECONDS = 600


class _PreviewRateLimiter:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._calls: dict[str, deque[float]] = defaultdict(deque)

    def try_acquire(self, tenant_id: str, limit: int, window_seconds: float) -> bool:
        now = time.monotonic()
        with self._lock:
            calls = self._calls[tenant_id]
            while calls and now - calls[0] >= window_seconds:
                calls.popleft()
            if len(calls) >= limit:
                return False
            calls.append(now)
            return True


_preview_rate_limiter = _PreviewRateLimiter()


def _require_extraction_prompt_editor(
    tenant_id: str, user_id: str, client: Client
) -> None:
    role = get_current_user_role(tenant_id, user_id, client)
    if role not in _EXTRACTION_PROMPT_EDITOR_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="この操作には platform_admin 権限が必要です",
        )


def _get_customer(client: Client, tenant_id: str, customer_id: int) -> dict[str, Any]:
    result = (
        client.table(SupabaseTableName.CUSTOMERS.value)
        .select("id, name, order_extraction_prompt")
        .eq("tenant_id", tenant_id)
        .eq("id", customer_id)
        .limit(1)
        .execute()
    )
    rows = cast(list[dict[str, Any]], result.data or [])
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="顧客が見つかりません"
        )
    return rows[0]


@customer_extraction_prompt_router.get(
    "/{customer_id}/extraction-prompt", response_model=ExtractionPromptResponse
)
def get_extraction_prompt(
    customer_id: int,
    tenant_id: str = Depends(get_current_tenant_id),
    current_user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    """顧客の今の抽出指示（platform_admin のみ）"""
    _require_extraction_prompt_editor(tenant_id, current_user_id, client)
    customer = _get_customer(client, tenant_id, customer_id)
    prompt = customer.get("order_extraction_prompt")
    return ExtractionPromptResponse(
        customer_id=customer["id"],
        customer_name=customer["name"],
        prompt=prompt.strip() if isinstance(prompt, str) and prompt.strip() else None,
    )


@customer_extraction_prompt_router.put(
    "/{customer_id}/extraction-prompt", response_model=ExtractionPromptSaveResponse
)
def save_extraction_prompt(
    customer_id: int,
    body: ExtractionPromptUpdate,
    tenant_id: str = Depends(get_current_tenant_id),
    current_user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    """抽出指示を保存し、変更履歴に追記する（platform_admin のみ）。空にすると指示なしに戻る。

    顧客の更新と履歴の追記は RPC で1トランザクションにする（片方だけ成功しないように）。
    """
    _require_extraction_prompt_editor(tenant_id, current_user_id, client)
    try:
        result = client.rpc(
            "save_customer_extraction_prompt",
            {
                "p_tenant_id": tenant_id,
                "p_customer_id": customer_id,
                "p_prompt": body.prompt,
            },
        ).execute()
    except APIError as e:
        if e.code == "P0002":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="顧客が見つかりません"
            ) from e
        if e.code == "42501":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="この操作には platform_admin 権限が必要です",
            ) from e
        raise
    rows = cast(list[dict[str, Any]], result.data or [])
    if not rows:
        raise RuntimeError(
            f"save_customer_extraction_prompt returned no rows for customer {customer_id}"
        )
    logger.info(
        f"extraction prompt saved for customer {customer_id} "
        f"(changed={rows[0]['changed']})"
    )
    return ExtractionPromptSaveResponse(
        prompt=rows[0]["saved_prompt"], changed=rows[0]["changed"]
    )


@customer_extraction_prompt_router.get(
    "/{customer_id}/extraction-prompt/history",
    response_model=list[ExtractionPromptHistoryItem],
)
def list_extraction_prompt_history(
    customer_id: int,
    tenant_id: str = Depends(get_current_tenant_id),
    current_user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    """抽出指示の変更履歴（新しい順。platform_admin のみ）"""
    _require_extraction_prompt_editor(tenant_id, current_user_id, client)
    _get_customer(client, tenant_id, customer_id)
    result = (
        client.table(SupabaseTableName.CUSTOMER_EXTRACTION_PROMPT_HISTORY.value)
        .select("id, prompt, changed_by, changed_at")
        .eq("tenant_id", tenant_id)
        .eq("customer_id", customer_id)
        .order("id", desc=True)
        .execute()
    )
    return cast(list[dict[str, Any]], result.data or [])


@customer_extraction_prompt_router.get(
    "/{customer_id}/extraction-prompt/attachments",
    response_model=list[ExtractionPromptAttachment],
)
def list_extraction_prompt_attachments(
    customer_id: int,
    tenant_id: str = Depends(get_current_tenant_id),
    current_user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    """試し読みに使える、その顧客の過去の受信PDF（新しい順。platform_admin のみ）"""
    _require_extraction_prompt_editor(tenant_id, current_user_id, client)
    _get_customer(client, tenant_id, customer_id)
    rows = list_customer_pdf_attachments(client, tenant_id, customer_id)
    return [
        ExtractionPromptAttachment(
            id=str(row["id"]),
            original_filename=row.get("original_filename") or "",
            size_bytes=row.get("size_bytes"),
            received_at=row["created_at"],
        )
        for row in rows
    ]


def _to_preview_reading(
    reading: ExtractionReading | None, products: dict[int, dict[str, Any]]
) -> PreviewReading | None:
    if reading is None:
        return None
    line_items = []
    for line in reading.line_items:
        product = products.get(line.product_id) if line.product_id else None
        line_items.append(
            PreviewLineItem(
                product_name_raw=line.product_name_raw,
                product_number_raw=line.product_number_raw,
                quantity=line.quantity if line.has_valid_quantity else None,
                invalid_quantity=not line.has_valid_quantity,
                delivery_date=line.deadline_date,
                certainty=line.certainty,
                line_order_no=line.line_order_no,
                customer_order_no=line.customer_order_no,
                product=(
                    PreviewProduct(
                        id=product["id"],
                        code=product.get("code"),
                        name=product["name"],
                    )
                    if product
                    else None
                ),
            )
        )
    return PreviewReading(
        error=reading.error,
        document_order_no=reading.document_order_no,
        is_repair=reading.is_repair,
        subject=reading.subject,
        line_items=line_items,
        fallback=reading.fallback,
    )


@customer_extraction_prompt_router.post(
    "/{customer_id}/extraction-prompt/preview",
    response_model=ExtractionPreviewResponse,
)
def preview_extraction_prompt(
    customer_id: int,
    body: ExtractionPreviewRequest,
    tenant_id: str = Depends(get_current_tenant_id),
    current_user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    """過去のPDFを今の指示と編集中の指示で読み取って並べる（platform_admin のみ）。

    起票・更新・ログ・通知は一切しない。
    """
    _require_extraction_prompt_editor(tenant_id, current_user_id, client)
    customer = _get_customer(client, tenant_id, customer_id)
    attachment = find_customer_pdf_attachment(
        client, tenant_id, customer_id, str(body.attachment_id)
    )
    if attachment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="この顧客の受信PDFが見つかりません",
        )

    if not _preview_rate_limiter.try_acquire(
        tenant_id, _PREVIEW_RATE_LIMIT, _PREVIEW_RATE_WINDOW_SECONDS
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": "preview_rate_limited",
                "message": "試し読みの回数が多すぎます。しばらく待ってから試してください",
            },
        )

    try:
        preview = preview_extraction(
            client,
            tenant_id,
            customer_id,
            attachment,
            customer.get("order_extraction_prompt"),
            body.prompt,
        )
    except StorageApiError as e:
        logger.error(
            f"extraction preview: failed to download attachment {body.attachment_id}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "error": "attachment_download_failed",
                "message": "PDFを取得できませんでした",
            },
        ) from e
    except anthropic.APIError as e:
        logger.error(
            f"extraction preview: Claude API failed for attachment {body.attachment_id}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "extraction_unavailable",
                "message": "読み取りに失敗しました。時間をおいて試してください",
            },
        ) from e

    return ExtractionPreviewResponse(
        source=preview.source,
        unreadable_reason=preview.unreadable_reason,
        current=_to_preview_reading(preview.current, preview.products),
        edited=_to_preview_reading(preview.edited, preview.products),
        same_prompt=preview.same_prompt,
    )
