from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from app.services import extraction_prompt_preview_service as service
from app.services.pdf_order_extraction_service import PdfDocumentRejectedError
from app.services.pdf_order_parsing_service import read_line_item
from app.services.pdf_text_service import PdfTextResult, PdfTooLargeError

_TENANT_ID = "tenant-1"
_CUSTOMER_ID = 7
_ATTACHMENT = {
    "id": "att-1",
    "tenant_id": _TENANT_ID,
    "customer_id": _CUSTOMER_ID,
    "storage_path": "tenant-1/inbox/msg-1/order.pdf",
    "original_filename": "order.pdf",
    "content_type": "application/pdf",
    "size_bytes": 1234,
    "created_at": "2026-10-01T00:00:00+00:00",
}


def _extraction(**overrides: Any) -> dict[str, Any]:
    data: dict[str, Any] = {
        "document_order_no": "C100",
        "line_items": [
            {
                "product_name_raw": "部品A",
                "product_number_raw": "A-1",
                "quantity": 10,
                "delivery_date": "2026-11-01",
                "line_order_no": None,
                "certainty": "confirmed",
            }
        ],
        "order_type": "production",
        "subject": None,
    }
    data.update(overrides)
    return data


@pytest.fixture
def db():
    mock = MagicMock()
    mock.table.return_value.select.return_value.eq.return_value.in_.return_value.execute.return_value.data = [
        {"id": 42, "code": "A-1", "name": "部品A"}
    ]
    return mock


@pytest.fixture(autouse=True)
def _download():
    with patch.object(
        service, "download_attachment", return_value=b"%PDF-1.4"
    ) as mock_download:
        yield mock_download


@pytest.fixture(autouse=True)
def _resolve_product():
    with patch(
        "app.services.pdf_order_parsing_service._resolve_product_id",
        return_value=42,
    ) as mock_resolve:
        yield mock_resolve


def _text_pdf(text: str = "注文書 C100"):
    return patch.object(
        service,
        "extract_text",
        return_value=PdfTextResult(text=text, failure_reason=None),
    )


@pytest.mark.unit
class TestPreviewExtraction:
    def test_text_pdf_is_read_with_both_prompts(self, db):
        with (
            _text_pdf(),
            patch.object(
                service,
                "extract_order_lines",
                side_effect=[_extraction(), _extraction(document_order_no="C200")],
            ) as mock_extract,
        ):
            preview = service.preview_extraction(
                db, _TENANT_ID, _CUSTOMER_ID, _ATTACHMENT, "今の指示", "  新しい指示 "
            )

        assert [c.args for c in mock_extract.call_args_list] == [
            ("注文書 C100", "今の指示"),
            ("注文書 C100", "新しい指示"),
        ]
        assert preview.source == "text"
        assert preview.same_prompt is False
        assert preview.current is not None and preview.edited is not None
        assert preview.current.document_order_no == "C100"
        assert preview.edited.document_order_no == "C200"
        line = preview.current.line_items[0]
        assert line.product_id == 42
        assert line.customer_order_no == "C100"
        assert line.certainty == "confirmed"
        assert preview.products == {42: {"id": 42, "code": "A-1", "name": "部品A"}}

    def test_same_prompt_reads_only_once(self, db):
        with (
            _text_pdf(),
            patch.object(
                service, "extract_order_lines", return_value=_extraction()
            ) as mock_extract,
        ):
            preview = service.preview_extraction(
                db, _TENANT_ID, _CUSTOMER_ID, _ATTACHMENT, "指示", " 指示\n"
            )

        assert mock_extract.call_count == 1
        assert preview.same_prompt is True
        assert preview.current is preview.edited

    def test_empty_prompt_is_treated_as_no_prompt(self, db):
        with (
            _text_pdf(),
            patch.object(
                service, "extract_order_lines", return_value=_extraction()
            ) as mock_extract,
        ):
            service.preview_extraction(
                db, _TENANT_ID, _CUSTOMER_ID, _ATTACHMENT, "今の指示", "   "
            )

        assert mock_extract.call_args_list[1].args == ("注文書 C100", None)

    def test_image_pdf_is_read_as_document(self, db):
        with (
            patch.object(
                service,
                "extract_text",
                return_value=PdfTextResult(text=None, failure_reason="failed_image"),
            ),
            patch.object(
                service,
                "extract_order_lines_from_pdf",
                return_value={**_extraction(), "issuer_company_name": "A社"},
            ) as mock_extract,
            patch.object(service, "extract_order_lines") as mock_text_extract,
        ):
            preview = service.preview_extraction(
                db, _TENANT_ID, _CUSTOMER_ID, _ATTACHMENT, None, "指示"
            )

        assert preview.source == "image"
        assert [c.args for c in mock_extract.call_args_list] == [
            (b"%PDF-1.4", None),
            (b"%PDF-1.4", "指示"),
        ]
        mock_text_extract.assert_not_called()

    def test_image_pdf_rejected_by_api_is_reported_per_prompt(self, db):
        with (
            patch.object(
                service,
                "extract_text",
                return_value=PdfTextResult(text=None, failure_reason="failed_image"),
            ),
            patch.object(
                service,
                "extract_order_lines_from_pdf",
                side_effect=[PdfDocumentRejectedError("rejected"), _extraction()],
            ),
        ):
            preview = service.preview_extraction(
                db, _TENANT_ID, _CUSTOMER_ID, _ATTACHMENT, None, "指示"
            )

        assert preview.current is not None and preview.edited is not None
        assert preview.current.error == "document_rejected"
        assert preview.current.fallback == "unreadable_draft"
        assert preview.edited.error is None
        assert len(preview.edited.line_items) == 1

    def test_encrypted_pdf_does_not_call_claude(self, db):
        with (
            patch.object(
                service,
                "extract_text",
                return_value=PdfTextResult(
                    text=None, failure_reason="failed_encrypted"
                ),
            ),
            patch.object(service, "extract_order_lines") as mock_text_extract,
            patch.object(service, "extract_order_lines_from_pdf") as mock_image_extract,
        ):
            preview = service.preview_extraction(
                db, _TENANT_ID, _CUSTOMER_ID, _ATTACHMENT, None, "指示"
            )

        assert preview.unreadable_reason == "failed_encrypted"
        assert preview.current is None and preview.edited is None
        mock_text_extract.assert_not_called()
        mock_image_extract.assert_not_called()

    def test_oversized_pdf_by_known_size_skips_download(self, db, _download):
        with patch.object(service, "MAX_PDF_BYTES", 100):
            preview = service.preview_extraction(
                db, _TENANT_ID, _CUSTOMER_ID, _ATTACHMENT, None, "指示"
            )

        assert preview.unreadable_reason == "failed_too_large"
        _download.assert_not_called()

    def test_pdf_too_large_while_reading_is_unreadable(self, db):
        with patch.object(
            service, "extract_text", side_effect=PdfTooLargeError("too many pages")
        ):
            preview = service.preview_extraction(
                db, _TENANT_ID, _CUSTOMER_ID, _ATTACHMENT, None, "指示"
            )

        assert preview.unreadable_reason == "failed_too_large"

    def test_no_lines_from_text_pdf_falls_back_to_email_body(self, db):
        with (
            _text_pdf(),
            patch.object(
                service, "extract_order_lines", return_value=_extraction(line_items=[])
            ),
        ):
            preview = service.preview_extraction(
                db, _TENANT_ID, _CUSTOMER_ID, _ATTACHMENT, None, None
            )

        assert preview.current is not None
        assert preview.current.fallback == "email_body"
        assert preview.products == {}

    def test_repair_order_has_no_fallback(self, db):
        with (
            _text_pdf(),
            patch.object(
                service,
                "extract_order_lines",
                return_value=_extraction(
                    line_items=[], order_type="repair", subject="金型修理"
                ),
            ),
        ):
            preview = service.preview_extraction(
                db, _TENANT_ID, _CUSTOMER_ID, _ATTACHMENT, None, None
            )

        assert preview.current is not None
        assert preview.current.is_repair is True
        assert preview.current.subject == "金型修理"
        assert preview.current.fallback is None

    def test_does_not_write_to_db(self, db):
        with (
            _text_pdf(),
            patch.object(service, "extract_order_lines", return_value=_extraction()),
        ):
            service.preview_extraction(
                db, _TENANT_ID, _CUSTOMER_ID, _ATTACHMENT, "今の指示", "新しい指示"
            )

        table = db.table.return_value
        table.insert.assert_not_called()
        table.update.assert_not_called()
        table.upsert.assert_not_called()
        table.delete.assert_not_called()
        db.rpc.assert_not_called()


@pytest.mark.unit
class TestFindCustomerPdfAttachment:
    def _staging_result(self, db, rows):
        chain = db.table.return_value.select.return_value.eq.return_value.is_.return_value.eq.return_value.neq.return_value
        chain.eq.return_value.limit.return_value.execute.return_value.data = rows
        return chain

    def test_returns_row_of_same_customer(self):
        db = MagicMock()
        chain = self._staging_result(db, [_ATTACHMENT])

        row = service.find_customer_pdf_attachment(
            db, _TENANT_ID, _CUSTOMER_ID, "att-1"
        )

        assert row == _ATTACHMENT
        db.table.return_value.select.return_value.eq.assert_called_with(
            "tenant_id", _TENANT_ID
        )
        chain.eq.assert_called_with("id", "att-1")

    def test_returns_none_when_not_found_in_tenant(self):
        db = MagicMock()
        self._staging_result(db, [])

        assert (
            service.find_customer_pdf_attachment(db, _TENANT_ID, _CUSTOMER_ID, "att-x")
            is None
        )

    def test_other_customer_attachment_requires_an_order_of_this_customer(self):
        db = MagicMock()
        self._staging_result(db, [{**_ATTACHMENT, "customer_id": 99}])
        orders = db.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value

        orders.data = []
        assert (
            service.find_customer_pdf_attachment(db, _TENANT_ID, _CUSTOMER_ID, "att-1")
            is None
        )

        orders.data = [{"id": 1}]
        assert (
            service.find_customer_pdf_attachment(db, _TENANT_ID, _CUSTOMER_ID, "att-1")
            is not None
        )


@pytest.mark.unit
class TestReadLineItem:
    def test_resolves_order_no_certainty_and_product(self, _resolve_product):
        reading = read_line_item(
            MagicMock(),
            _TENANT_ID,
            _CUSTOMER_ID,
            {
                "product_name_raw": "  部品A ",
                "product_number_raw": "A-1",
                "quantity": 10,
                "delivery_date": "2026-11-01",
                "line_order_no": "①",
                "certainty": "unknown",
            },
            "C100",
            "AUTO-1",
        )

        assert reading.extracted_product_name == "部品A"
        assert reading.customer_order_no == "1"
        assert reading.line_order_no == "①"
        assert reading.certainty is None
        assert reading.product_id == 42
        assert reading.has_valid_quantity is True
        _resolve_product.assert_called_once_with(
            _resolve_product.call_args.args[0],
            _TENANT_ID,
            _CUSTOMER_ID,
            "A-1",
            "  部品A ",
        )

    def test_non_integer_quantity_is_invalid(self):
        reading = read_line_item(
            MagicMock(),
            _TENANT_ID,
            None,
            {"product_name_raw": "部品A", "quantity": "10個"},
            None,
            None,
        )

        assert reading.has_valid_quantity is False
