import io
import os
from dataclasses import dataclass

import pdfplumber
from pdfminer.pdfdocument import PDFEncryptionError, PDFPasswordIncorrect

from app.utils.logger import get_logger

logger = get_logger(__name__)

# pdfplumber はページごとのレイアウトオブジェクトを内部キャッシュするため、ページ数・
# 図形数の多いPDFで数百MB規模のメモリスパイクになりうる（Issue #425）。cron
# （parse-order-pdfs）から全テナント横断で呼ばれる Web インスタンス上での処理のため、
# 事前にバイト数・ページ数の上限を設けて超過分は例外で弾く。
# MAX_PDF_BYTES は呼び出し元（pdf_order_parsing_service）が Storage ダウンロード前に
# order_attachments.size_bytes と突き合わせる事前ガードにも使うため公開定数にしている。
MAX_PDF_BYTES = int(os.environ.get("PDF_TEXT_MAX_BYTES", str(20 * 1024 * 1024)))
_MAX_PDF_PAGES = int(os.environ.get("PDF_TEXT_MAX_PAGES", "50"))


@dataclass
class PdfTextResult:
    text: str | None
    # 'failed_encrypted' | 'failed_image' | None (成功時)
    failure_reason: str | None


class PdfTooLargeError(ValueError):
    """PDFのバイト数・ページ数が上限を超えており、メモリ保護のため処理を拒否した。"""


def extract_text(content: bytes) -> PdfTextResult:
    """
    PDFバイナリからテキストを抽出する。
    - パスワード保護 (PPAP等) で開けない場合は failure_reason='failed_encrypted'
    - 開けるがテキストが1文字も取れない場合（画像PDF等）は failure_reason='failed_image'
    - バイト数・ページ数が上限を超える場合は PdfTooLargeError を送出する（呼び出し側は
      他の解析失敗ケースと同様に1件ごとにキャッチしてスキップする想定）
    """
    if len(content) > MAX_PDF_BYTES:
        raise PdfTooLargeError(
            f"PDF size {len(content)} bytes exceeds limit {MAX_PDF_BYTES} bytes"
        )

    try:
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            if len(pdf.pages) > _MAX_PDF_PAGES:
                raise PdfTooLargeError(
                    f"PDF page count {len(pdf.pages)} exceeds limit {_MAX_PDF_PAGES}"
                )

            pages_text = []
            for page in pdf.pages:
                pages_text.append(page.extract_text() or "")
                # ページ単位でレイアウトキャッシュを解放し、大量ページ処理時の
                # メモリ蓄積を抑える
                page.flush_cache()
    except (PDFPasswordIncorrect, PDFEncryptionError) as exc:
        logger.info(f"pdf_text_service: encrypted PDF detected: {exc}")
        return PdfTextResult(text=None, failure_reason="failed_encrypted")

    text = "\n".join(pages_text).strip()
    if not text:
        logger.info("pdf_text_service: no extractable text (likely image PDF)")
        return PdfTextResult(text=None, failure_reason="failed_image")

    return PdfTextResult(text=text, failure_reason=None)
