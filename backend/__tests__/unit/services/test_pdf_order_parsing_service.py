from unittest.mock import MagicMock, patch

import pytest
from app.services.pdf_order_parsing_service import (
    _process_line_item,
    parse_pending_order_pdfs,
)
from app.services.pdf_text_service import PdfTextResult


@pytest.mark.unit
class TestParsePendingOrderPdfs:
    def _staging_row(self, **overrides):
        row = {
            "id": "att-1",
            "tenant_id": "tenant-1",
            "customer_id": 7,
            "source_raw": "本文 run_id=abc123",
            "storage_path": "tenant-1/inbox/msg-1/order.pdf",
            "original_filename": "order.pdf",
            "content_type": "application/pdf",
            "size_bytes": 1234,
            "parse_status": "pending",
        }
        row.update(overrides)
        return row

    def test_no_pending_rows_returns_zero_counts(self):
        mock_db = MagicMock()
        mock_db.table().select().is_().eq().execute.return_value = MagicMock(data=[])

        result = parse_pending_order_pdfs(mock_db)

        assert result == {"processed": 0, "orders_created": 0, "errors": 0}

    def test_encrypted_pdf_marks_failed_and_creates_no_order(self):
        mock_db = MagicMock()
        mock_db.table().select().is_().eq().execute.return_value = MagicMock(
            data=[self._staging_row()]
        )

        with (
            patch(
                "app.services.pdf_order_parsing_service.download_attachment",
                return_value=b"%PDF-fake",
            ),
            patch(
                "app.services.pdf_order_parsing_service.extract_text",
                return_value=PdfTextResult(
                    text=None, failure_reason="failed_encrypted"
                ),
            ),
            patch(
                "app.services.pdf_order_parsing_service.extract_order_lines"
            ) as mock_extract_lines,
        ):
            result = parse_pending_order_pdfs(mock_db)

        mock_extract_lines.assert_not_called()
        assert result == {"processed": 1, "orders_created": 0, "errors": 0}

        update_calls = mock_db.table().update.call_args_list
        assert any(
            c.args[0] == {"parse_status": "failed_encrypted"} for c in update_calls
        )

    def test_exception_during_processing_counts_as_error(self):
        mock_db = MagicMock()
        mock_db.table().select().is_().eq().execute.return_value = MagicMock(
            data=[self._staging_row()]
        )

        with patch(
            "app.services.pdf_order_parsing_service.download_attachment",
            side_effect=Exception("storage error"),
        ):
            result = parse_pending_order_pdfs(mock_db)

        assert result == {"processed": 0, "orders_created": 0, "errors": 1}


@pytest.mark.unit
class TestProcessLineItem:
    def _staging_row(self, **overrides):
        row = {
            "id": "att-1",
            "tenant_id": "tenant-1",
            "customer_id": 7,
            "source_raw": "本文",
            "storage_path": "tenant-1/inbox/msg-1/order.pdf",
            "original_filename": "order.pdf",
            "content_type": "application/pdf",
            "size_bytes": 1234,
        }
        row.update(overrides)
        return row

    def test_no_product_match_logs_and_skips(self):
        mock_db = MagicMock()
        line = {
            "product_name_raw": "謎の製品",
            "product_number_raw": None,
            "quantity": 10,
            "delivery_date": "2026-08-01",
            "certainty": "confirmed",
        }

        with (
            patch(
                "app.services.pdf_order_parsing_service.match_product_by_code",
                return_value=None,
            ),
            patch(
                "app.services.pdf_order_parsing_service.match_products",
                return_value={"product_id": None, "candidates": []},
            ),
        ):
            created = _process_line_item(mock_db, self._staging_row(), line)

        assert created is False
        log_insert = mock_db.table("order_parse_log").insert.call_args.args[0]
        assert log_insert["reason"] == "no_product_match"
        assert log_insert["order_attachment_id"] == "att-1"

    def test_duplicate_order_logs_and_skips(self):
        mock_db = MagicMock()
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"id": None, "inserted": False}]
        )
        line = {
            "product_name_raw": "製品A",
            "product_number_raw": "CODE-1",
            "quantity": 10,
            "delivery_date": "2026-08-01",
            "certainty": "confirmed",
        }

        with patch(
            "app.services.pdf_order_parsing_service.match_product_by_code",
            return_value=100,
        ):
            created = _process_line_item(mock_db, self._staging_row(), line)

        assert created is False
        log_insert = mock_db.table("order_parse_log").insert.call_args.args[0]
        assert log_insert["reason"] == "duplicate_skipped"

    def test_successful_line_creates_order_and_attachment(self):
        mock_db = MagicMock()
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"id": 555, "inserted": True}]
        )
        line = {
            "product_name_raw": "製品A",
            "product_number_raw": "CODE-1",
            "quantity": 10,
            "delivery_date": "2026-08-01",
            "certainty": "forecast",
        }

        with patch(
            "app.services.pdf_order_parsing_service.match_product_by_code",
            return_value=100,
        ):
            created = _process_line_item(mock_db, self._staging_row(), line)

        assert created is True

        rpc_call_args = mock_db.rpc.call_args_list[-1]
        assert rpc_call_args.args[0] == "create_order_skip_duplicate"
        rpc_params = rpc_call_args.args[1]
        assert rpc_params["p_product_id"] == 100
        assert rpc_params["p_status"] == "forecast"
        assert rpc_params["p_customer_id"] == 7

        attachment_insert = mock_db.table("order_attachments").insert.call_args.args[0]
        assert attachment_insert["order_id"] == 555
        assert attachment_insert["parse_status"] == "success"
        assert attachment_insert["storage_path"] == "tenant-1/inbox/msg-1/order.pdf"
