from unittest.mock import patch

import pytest
from app.services.pdf_text_service import extract_text
from pdfminer.pdfdocument import PDFPasswordIncorrect
from pdfplumber.utils.exceptions import PdfminerException

_BLANK_PDF = b"""%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>
endobj
trailer
<< /Size 4 /Root 1 0 R >>
"""


def _build_text_pdf(text: str) -> bytes:
    content_stream = f"BT /F1 24 Tf 50 700 Td ({text}) Tj ET".encode()
    return (
        b"""%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length """
        + str(len(content_stream)).encode()
        + b""" >>
stream
"""
        + content_stream
        + b"""
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
trailer
<< /Size 6 /Root 1 0 R >>
"""
    )


@pytest.mark.unit
class TestExtractText:
    def test_pdf_with_text_returns_text(self):
        result = extract_text(_build_text_pdf("Hello Order PDF"))
        assert result.failure_reason is None
        assert result.text is not None
        assert "Hello Order PDF" in result.text

    def test_blank_pdf_returns_failed_image(self):
        result = extract_text(_BLANK_PDF)
        assert result.failure_reason == "failed_image"
        assert result.text is None

    def test_unreadable_content_raises(self):
        with pytest.raises(PdfminerException):
            extract_text(b"not a pdf at all")

    def test_encrypted_pdf_returns_failed_encrypted(self):
        with patch(
            "app.services.pdf_text_service.pdfplumber.open",
            side_effect=PDFPasswordIncorrect("password required"),
        ):
            result = extract_text(_BLANK_PDF)
        assert result.failure_reason == "failed_encrypted"
        assert result.text is None
