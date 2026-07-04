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

        insert_calls = mock_db.table().insert.call_args_list
        assert any(c.args[0]["notif_type"] == "failed_encrypted" for c in insert_calls)

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
        insert_calls = mock_db.table().insert.call_args_list
        log_insert = insert_calls[0].args[0]
        assert log_insert["reason"] == "no_product_match"
        assert log_insert["order_attachment_id"] == "att-1"
        notif_insert = insert_calls[1].args[0]
        assert notif_insert["notif_type"] == "no_product_match"
        assert notif_insert["source_table"] == "order_parse_log"

    def test_falls_back_to_name_search_using_product_number_raw(self):
        """
        products.code が未整備で name 列に品番文字列が入っているテナントでは、
        code完全一致に失敗した後、product_number_raw で products.name を
        pg_trgm検索するフォールバックが機能すること。
        """
        mock_db = MagicMock()
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 555, "action": "inserted"}]
        )
        line = {
            "product_name_raw": "FILTER COMP （φ10.6）",
            "product_number_raw": "22750-50P-0000-01",
            "quantity": 15000,
            "delivery_date": "2026-07-13",
            "certainty": "confirmed",
        }

        def fake_match_products(db, tenant_id, query_text):
            if query_text == "22750-50P-0000-01":
                return {"product_id": 10534, "candidates": []}
            return {"product_id": None, "candidates": []}

        with (
            patch(
                "app.services.pdf_order_parsing_service.match_product_by_code",
                return_value=None,
            ),
            patch(
                "app.services.pdf_order_parsing_service.match_products",
                side_effect=fake_match_products,
            ) as mock_match_products,
        ):
            created = _process_line_item(mock_db, self._staging_row(), line)

        assert created is True
        # product_name_raw ではなく product_number_raw で先にマッチしたはず
        first_call_query = mock_match_products.call_args_list[0].args[2]
        assert first_call_query == "22750-50P-0000-01"
        rpc_params = mock_db.rpc.call_args_list[-1].args[1]
        assert rpc_params["p_product_id"] == 10534

    def test_downgrade_skipped_logs_and_skips(self):
        mock_db = MagicMock()
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 42, "action": "skipped_downgrade"}]
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
        insert_calls = mock_db.table().insert.call_args_list
        log_insert = insert_calls[0].args[0]
        assert log_insert["reason"] == "downgrade_skipped"
        notif_insert = insert_calls[1].args[0]
        assert notif_insert["notif_type"] == "downgrade_skipped"

    def test_draft_conflict_logs_and_skips(self):
        mock_db = MagicMock()
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 42, "action": "skipped_draft_conflict"}]
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
        insert_calls = mock_db.table().insert.call_args_list
        log_insert = insert_calls[0].args[0]
        assert log_insert["reason"] == "draft_conflict_skipped"
        notif_insert = insert_calls[1].args[0]
        assert notif_insert["notif_type"] == "draft_conflict_skipped"

    def test_no_change_skips_without_logging(self):
        mock_db = MagicMock()
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 42, "action": "skipped_no_change"}]
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
        mock_db.table("order_parse_log").insert.assert_not_called()

    def test_successful_line_creates_order_and_attachment(self):
        mock_db = MagicMock()
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 555, "action": "inserted"}]
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
        assert rpc_call_args.args[0] == "upsert_order_by_dedupe_key"
        rpc_params = rpc_call_args.args[1]
        assert rpc_params["p_product_id"] == 100
        assert rpc_params["p_status"] == "forecast"
        assert rpc_params["p_customer_id"] == 7

        attachment_insert = mock_db.table("order_attachments").insert.call_args.args[0]
        assert attachment_insert["order_id"] == 555
        assert attachment_insert["parse_status"] == "success"
        assert attachment_insert["storage_path"] == "tenant-1/inbox/msg-1/order.pdf"

    def test_inserted_order_marks_superseded_orders(self):
        """新規orderが挿入された場合、同一(tenant,customer,product)で
        別deadline_dateの旧forecastレコードにsuperseded_atがセットされること。"""
        mock_db = MagicMock()
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 999, "action": "inserted"}]
        )
        line = {
            "product_name_raw": "製品A",
            "product_number_raw": "CODE-1",
            "quantity": 10,
            "delivery_date": "2026-09-01",
            "certainty": "confirmed",
        }

        with patch(
            "app.services.pdf_order_parsing_service.match_product_by_code",
            return_value=100,
        ):
            created = _process_line_item(mock_db, self._staging_row(), line)

        assert created is True

        orders_table_calls = mock_db.table.call_args_list
        assert any(c.args[0] == "orders" for c in orders_table_calls)

        update_mock = mock_db.table("orders").update
        assert "superseded_at" in update_mock.call_args.args[0]

        eq1 = update_mock.return_value.eq
        assert eq1.call_args.args == ("tenant_id", "tenant-1")
        eq2 = eq1.return_value.eq
        assert eq2.call_args.args == ("customer_id", 7)
        eq3 = eq2.return_value.eq
        assert eq3.call_args.args == ("product_id", 100)
        neq = eq3.return_value.neq
        assert neq.call_args.args == ("deadline_date", "2026-09-01")

    def test_updated_order_creates_attachment_without_log(self):
        """既存orderがupdateされた場合もorder_attachmentsに新しいPDFを紐付けるが、
        order_parse_logへの記録は行わない。"""
        mock_db = MagicMock()
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 777, "action": "updated"}]
        )
        line = {
            "product_name_raw": "製品A",
            "product_number_raw": "CODE-1",
            "quantity": 20,
            "delivery_date": "2026-08-01",
            "certainty": "confirmed",
        }

        with patch(
            "app.services.pdf_order_parsing_service.match_product_by_code",
            return_value=100,
        ):
            created = _process_line_item(mock_db, self._staging_row(), line)

        assert created is True
        insert_calls = mock_db.table("order_attachments").insert.call_args_list
        assert len(insert_calls) == 1
        attachment_insert = insert_calls[0].args[0]
        assert attachment_insert["order_id"] == 777
        assert not any("reason" in c.args[0] for c in insert_calls)
