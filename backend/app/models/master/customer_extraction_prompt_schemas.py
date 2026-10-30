# models/master/customer_extraction_prompt_schemas.py
"""顧客ごとの抽出指示の編集・試し読み API のスキーマ（Issue #602）。"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

# 抽出のたびにプロンプトへ足されるので長さを抑える。
# RPC save_customer_extraction_prompt の上限・Frontend の EXTRACTION_PROMPT_MAX_LENGTH と揃える
EXTRACTION_PROMPT_MAX_LENGTH = 2000


def normalize_extraction_prompt(value: str | None) -> str | None:
    """前後の空白を除き、空なら None（汎用プロンプトのみ）にする。"""
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


class _PromptInput(BaseModel):
    prompt: str | None = Field(
        default=None, description="抽出指示。空文字・空白のみは指示なし（NULL）"
    )

    @field_validator("prompt")
    @classmethod
    def _normalize(cls, value: str | None) -> str | None:
        normalized = normalize_extraction_prompt(value)
        if normalized is not None and len(normalized) > EXTRACTION_PROMPT_MAX_LENGTH:
            raise ValueError(
                f"抽出指示は{EXTRACTION_PROMPT_MAX_LENGTH}文字以内で入力してください"
            )
        return normalized


class ExtractionPromptUpdate(_PromptInput):
    pass


class ExtractionPromptResponse(BaseModel):
    customer_id: int
    customer_name: str
    prompt: str | None
    max_length: int = EXTRACTION_PROMPT_MAX_LENGTH


class ExtractionPromptSaveResponse(BaseModel):
    prompt: str | None
    # 今の指示と同じ内容だった（履歴を追記しなかった）ときは False
    changed: bool


class ExtractionPromptHistoryItem(BaseModel):
    id: int
    prompt: str | None
    # None は画面以外で入った値（移行時点の値・SQL での直接変更）
    changed_by: str | None
    changed_at: datetime


class ExtractionPromptAttachment(BaseModel):
    id: str
    original_filename: str
    size_bytes: int | None
    received_at: datetime


class ExtractionPreviewRequest(_PromptInput):
    attachment_id: UUID


class PreviewProduct(BaseModel):
    id: int
    code: str | None
    name: str


class PreviewLineItem(BaseModel):
    product_name_raw: str | None
    product_number_raw: str | None
    quantity: int | None
    # 数量が整数でない明細（取り込みでは起票せずスキップする）
    invalid_quantity: bool
    delivery_date: str | None
    certainty: str | None
    line_order_no: str | None
    # 起票時に orders.customer_order_no に入る値（明細 → 文書 → アプリ採番の順）
    customer_order_no: str | None
    # 照合できなければ None（取り込みでは製品未照合の下書きになる）
    product: PreviewProduct | None


class PreviewReading(BaseModel):
    # document_rejected: Claude が文書を受け付けなかった（取り込みでは読み取り不能の下書きになる）
    error: Literal["document_rejected"] | None
    document_order_no: str | None
    is_repair: bool
    subject: str | None
    line_items: list[PreviewLineItem]
    # 明細が取れなかったときに取り込みが代わりに行うこと
    # email_body: メール本文から読み直す（テキストPDF）／ unreadable_draft: 空の下書きを起票する（画像PDF）
    fallback: Literal["email_body", "unreadable_draft"] | None


class ExtractionPreviewResponse(BaseModel):
    source: Literal["text", "image"] | None
    # 指示に関係なく読めないPDF（Claude を呼ばない）
    unreadable_reason: Literal["failed_encrypted", "failed_too_large"] | None
    current: PreviewReading | None
    edited: PreviewReading | None
    # 今の指示と編集中の指示が同じ（1回だけ読み取った）
    same_prompt: bool
