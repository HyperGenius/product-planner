import io
from dataclasses import dataclass

import pdfplumber
from pdfminer.pdfdocument import PDFEncryptionError, PDFPasswordIncorrect

from app.utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class PdfTextResult:
    text: str | None
    # 'failed_encrypted' | 'failed_image' | None (成功時)
    failure_reason: str | None


def extract_text(content: bytes) -> PdfTextResult:
    """
    PDFバイナリからテキストを抽出する。
    - パスワード保護 (PPAP等) で開けない場合は failure_reason='failed_encrypted'
    - 開けるがテキストが1文字も取れない場合（画像PDF等）は failure_reason='failed_image'
    """
    try:
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            pages_text = [page.extract_text() or "" for page in pdf.pages]
    except (PDFPasswordIncorrect, PDFEncryptionError) as exc:
        logger.info(f"pdf_text_service: encrypted PDF detected: {exc}")
        return PdfTextResult(text=None, failure_reason="failed_encrypted")

    text = "\n".join(pages_text).strip()
    if not text:
        logger.info("pdf_text_service: no extractable text (likely image PDF)")
        return PdfTextResult(text=None, failure_reason="failed_image")

    return PdfTextResult(text=text, failure_reason=None)
