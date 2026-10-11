import base64
import json
from types import SimpleNamespace
from unittest.mock import patch

import anthropic
import httpx
import pytest
from app.services.pdf_order_extraction_service import (
    PdfDocumentRejectedError,
    extract_order_lines_from_pdf,
)


def _response(payload, stop_reason="end_turn"):
    text = payload if isinstance(payload, str) else json.dumps(payload)
    return SimpleNamespace(
        stop_reason=stop_reason,
        content=[SimpleNamespace(type="text", text=text)],
    )


def _status_error(cls, status_code):
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    return cls(
        message="error",
        response=httpx.Response(status_code, request=request),
        body=None,
    )


_LINE = {
    "product_name_raw": "製品A",
    "product_number_raw": "A-100",
    "quantity": 5,
    "delivery_date": "2026-08-01",
    "line_order_no": None,
    "certainty": "confirmed",
}


@pytest.mark.unit
class TestExtractOrderLinesFromPdf:
    """画像PDF（FAX受信・スキャン）を PDF のまま Claude に渡して抽出する（Issue #520）。"""

    def test_sends_pdf_as_document_block_and_returns_lines(self):
        with patch("app.services.pdf_order_extraction_service._client") as mock_client:
            mock_client.messages.create.return_value = _response(
                {
                    "document_order_no": "PO-1",
                    "issuer_company_name": "  株式会社ABC製作所 ",
                    "issuer_fax_number": "03-1234-5678",
                    "line_items": [_LINE],
                }
            )
            result = extract_order_lines_from_pdf(b"%PDF-fax", "顧客固有の指示")

        assert result == {
            "document_order_no": "PO-1",
            "line_items": [_LINE],
            "issuer_company_name": "株式会社ABC製作所",
            "issuer_fax_number": "03-1234-5678",
        }
        kwargs = mock_client.messages.create.call_args.kwargs
        document, text = kwargs["messages"][0]["content"]
        assert document["type"] == "document"
        assert document["source"]["media_type"] == "application/pdf"
        assert base64.b64decode(document["source"]["data"]) == b"%PDF-fax"
        assert "顧客固有の指示" in text["text"]
        schema = kwargs["output_config"]["format"]["schema"]
        assert "issuer_company_name" in schema["required"]
        assert "issuer_fax_number" in schema["required"]

    def test_model_can_be_overridden_by_env(self, monkeypatch):
        monkeypatch.setenv("PDF_IMAGE_EXTRACTION_MODEL", "claude-sonnet-5-5")
        with patch("app.services.pdf_order_extraction_service._client") as mock_client:
            mock_client.messages.create.return_value = _response(
                {
                    "document_order_no": None,
                    "issuer_company_name": None,
                    "line_items": [],
                }
            )
            extract_order_lines_from_pdf(b"%PDF-fax")

        assert mock_client.messages.create.call_args.kwargs["model"] == (
            "claude-sonnet-5-5"
        )

    @pytest.mark.parametrize("stop_reason", ["refusal", "max_tokens"])
    def test_refusal_or_truncation_returns_empty(self, stop_reason):
        with patch("app.services.pdf_order_extraction_service._client") as mock_client:
            mock_client.messages.create.return_value = _response(
                '{"line_items": [', stop_reason=stop_reason
            )
            result = extract_order_lines_from_pdf(b"%PDF-fax")

        assert result == {
            "document_order_no": None,
            "line_items": [],
            "issuer_company_name": None,
            "issuer_fax_number": None,
        }

    def test_non_json_response_returns_empty(self):
        with patch("app.services.pdf_order_extraction_service._client") as mock_client:
            mock_client.messages.create.return_value = _response("読み取れません")
            result = extract_order_lines_from_pdf(b"%PDF-fax")

        assert result["line_items"] == []
        assert result["issuer_company_name"] is None

    @pytest.mark.parametrize(
        ("cls", "status_code"),
        [
            (anthropic.BadRequestError, 400),
            (anthropic.RequestTooLargeError, 413),
            (anthropic.UnprocessableEntityError, 422),
        ],
    )
    def test_rejected_document_raises_rejected_error(self, cls, status_code):
        with patch("app.services.pdf_order_extraction_service._client") as mock_client:
            mock_client.messages.create.side_effect = _status_error(cls, status_code)
            with pytest.raises(PdfDocumentRejectedError):
                extract_order_lines_from_pdf(b"%PDF-broken")

    @pytest.mark.parametrize(
        ("cls", "status_code"),
        [
            (anthropic.RateLimitError, 429),
            (anthropic.InternalServerError, 500),
            (anthropic.AuthenticationError, 401),
        ],
    )
    def test_transient_or_config_errors_propagate(self, cls, status_code):
        """一時的な失敗・設定ミスは読み取り不能扱いにせず、そのまま送出して
        ステージング行を pending のまま残す（次回の cron で再処理される）。"""
        with patch("app.services.pdf_order_extraction_service._client") as mock_client:
            mock_client.messages.create.side_effect = _status_error(cls, status_code)
            with pytest.raises(cls):
                extract_order_lines_from_pdf(b"%PDF-fax")
