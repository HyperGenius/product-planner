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
            "gmail_message_id": "msg-1",
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

    def test_pdf_with_no_order_lines_falls_back_to_body_extraction(self):
        """PDFの内容が注文と無関係で明細が0件の場合、メール本文から抽出した
        line_itemsを使ってorderが作成されること（Issue #278/#280）。"""
        mock_db = MagicMock()
        mock_db.table().select().is_().eq().execute.return_value = MagicMock(
            data=[self._staging_row()]
        )
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 42, "action": "inserted"}]
        )

        with (
            patch(
                "app.services.pdf_order_parsing_service.download_attachment",
                return_value=b"%PDF-fake",
            ),
            patch(
                "app.services.pdf_order_parsing_service.extract_text",
                return_value=PdfTextResult(
                    text="無関係な文書です", failure_reason=None
                ),
            ),
            patch(
                "app.services.pdf_order_parsing_service.extract_order_lines",
                return_value=[],
            ),
            patch(
                "app.services.pdf_order_parsing_service.extract_email_order_lines",
                return_value=[
                    {
                        "product_name_raw": "製品A",
                        "product_number_raw": None,
                        "quantity": 5,
                        "delivery_date": "2026-08-01",
                        "certainty": "confirmed",
                    }
                ],
            ),
            patch(
                "app.services.pdf_order_parsing_service.match_product_by_code",
                return_value=None,
            ),
            patch(
                "app.services.pdf_order_parsing_service.match_products",
                return_value={"product_id": 100, "candidates": []},
            ),
        ):
            result = parse_pending_order_pdfs(mock_db)

        assert result == {"processed": 1, "orders_created": 1, "errors": 0}

        rpc_params = mock_db.rpc.call_args_list[-1].args[1]
        assert rpc_params["p_product_id"] == 100
        assert rpc_params["p_quantity"] == 5
        assert rpc_params["p_customer_id"] == 7
        assert rpc_params["p_source_type"] == "email"
        assert rpc_params["p_source_attachment_id"] == "att-1"

        attachment_insert = mock_db.table("order_attachments").insert.call_args.args[0]
        assert attachment_insert["order_id"] == 42
        assert attachment_insert["storage_path"] == "tenant-1/inbox/msg-1/order.pdf"

    def test_body_fallback_with_multiple_line_items_creates_multiple_orders(self):
        """1通のメールに部品番号ごとの複数月分の内示数量が含まれる場合
        （Issue #280の実例）、line_items配列として複数明細を抽出し、
        それぞれ別のorderとして作成すること。"""
        mock_db = MagicMock()
        mock_db.table().select().is_().eq().execute.return_value = MagicMock(
            data=[self._staging_row()]
        )
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 1, "action": "inserted"}]
        )

        line_items = [
            {
                "product_name_raw": "B115105",
                "product_number_raw": "B115105",
                "quantity": q,
                "delivery_date": f"2026-{month:02d}-01",
                "certainty": "forecast",
            }
            for month, q in zip(range(10, 13), [100, 110, 120], strict=True)
        ]

        with (
            patch(
                "app.services.pdf_order_parsing_service.download_attachment",
                return_value=b"%PDF-fake",
            ),
            patch(
                "app.services.pdf_order_parsing_service.extract_text",
                return_value=PdfTextResult(
                    text="無関係な文書です", failure_reason=None
                ),
            ),
            patch(
                "app.services.pdf_order_parsing_service.extract_order_lines",
                return_value=[],
            ),
            patch(
                "app.services.pdf_order_parsing_service.extract_email_order_lines",
                return_value=line_items,
            ),
            patch(
                "app.services.pdf_order_parsing_service.match_product_by_code",
                return_value=100,
            ),
        ):
            result = parse_pending_order_pdfs(mock_db)

        assert result == {"processed": 1, "orders_created": 3, "errors": 0}

    def test_pdf_and_body_both_yield_no_order_notifies_non_order_email(self):
        """PDFに明細がなく、メール本文からも注文情報が抽出できない場合、
        orderは作成せず non_order_email として通知のみ記録すること。"""
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
                    text="無関係な文書です", failure_reason=None
                ),
            ),
            patch(
                "app.services.pdf_order_parsing_service.extract_order_lines",
                return_value=[],
            ),
            patch(
                "app.services.pdf_order_parsing_service.extract_email_order_lines",
                return_value=[],
            ),
        ):
            result = parse_pending_order_pdfs(mock_db)

        assert result == {"processed": 1, "orders_created": 0, "errors": 0}

        insert_calls = [
            c.args[0] for c in mock_db.table().insert.call_args_list if c.args
        ]
        assert not any(c.get("status") == "draft" for c in insert_calls)

        log_insert = next(
            c for c in insert_calls if c.get("reason") == "non_order_email"
        )
        assert log_insert["order_attachment_id"] == "att-1"

        notif_insert = next(
            c for c in insert_calls if c.get("notif_type") == "non_order_email"
        )
        assert notif_insert["source_table"] == "gmail_message"
        assert notif_insert["source_id"] == "msg-1"

    def test_non_pdf_staging_row_skips_pdf_extraction_and_uses_email_body(self):
        """非PDF添付・添付なしメール由来のステージング行（Issue #280）は、
        PDFテキスト抽出を経由せず直接メール本文から抽出すること。"""
        mock_db = MagicMock()
        mock_db.table().select().is_().eq().execute.return_value = MagicMock(
            data=[
                self._staging_row(
                    storage_path="",
                    original_filename="",
                    content_type=None,
                    size_bytes=None,
                )
            ]
        )
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 9, "action": "inserted"}]
        )

        with (
            patch(
                "app.services.pdf_order_parsing_service.download_attachment"
            ) as mock_download,
            patch(
                "app.services.pdf_order_parsing_service.extract_text"
            ) as mock_extract_text,
            patch(
                "app.services.pdf_order_parsing_service.extract_email_order_lines",
                return_value=[
                    {
                        "product_name_raw": "製品B",
                        "product_number_raw": "CODE-B",
                        "quantity": 3,
                        "delivery_date": "2026-11-30",
                        "certainty": "forecast_tentative",
                    }
                ],
            ),
            patch(
                "app.services.pdf_order_parsing_service.match_product_by_code",
                return_value=200,
            ),
        ):
            result = parse_pending_order_pdfs(mock_db)

        mock_download.assert_not_called()
        mock_extract_text.assert_not_called()
        assert result == {"processed": 1, "orders_created": 1, "errors": 0}

        attachment_insert = mock_db.table("order_attachments").insert.call_args.args[0]
        assert attachment_insert["order_id"] == 9
        assert attachment_insert["parse_status"] == "failed_no_attachment"
        assert attachment_insert["storage_path"] == ""

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

    def test_no_product_match_logs_and_creates_null_product_draft(self):
        """製品マッチング失敗時も明細をドロップせず、product_id=NULLで下書きを
        作成する（Issue #296）。ログ・通知は従来どおり記録した上で処理を継続する。"""
        mock_db = MagicMock()
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 999, "action": "inserted"}]
        )
        line = {
            "product_name_raw": "  謎の製品  ",
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

        assert created is True
        insert_calls = mock_db.table().insert.call_args_list
        log_insert = insert_calls[0].args[0]
        assert log_insert["reason"] == "no_product_match"
        assert log_insert["order_attachment_id"] == "att-1"
        notif_insert = insert_calls[1].args[0]
        assert notif_insert["notif_type"] == "no_product_match"
        assert notif_insert["source_table"] == "order_parse_log"

        rpc_params = mock_db.rpc.call_args_list[-1].args[1]
        assert rpc_params["p_product_id"] is None
        # extracted_product_name は TRIM() のみ行い、それ以外の正規化はしない
        assert rpc_params["p_extracted_product_name"] == "謎の製品"

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

    def test_invalid_quantity_type_skips_without_calling_rpc(self):
        """quantityがint/None以外の想定外の型（スキーマ崩れ等）の場合、
        不整合なorderを作らないよう明細をスキップし、ログのみ記録すること。"""
        mock_db = MagicMock()
        line = {
            "product_name_raw": "製品A",
            "product_number_raw": "CODE-1",
            "quantity": "約100個",
            "delivery_date": "2026-08-01",
            "certainty": "confirmed",
        }

        with patch(
            "app.services.pdf_order_parsing_service.match_product_by_code",
            return_value=100,
        ):
            created = _process_line_item(mock_db, self._staging_row(), line)

        assert created is False
        mock_db.rpc.assert_not_called()
        log_insert = mock_db.table("order_parse_log").insert.call_args.args[0]
        assert log_insert["reason"] == "invalid_quantity"
        assert log_insert["detail"]["quantity"] == "約100個"

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
        assert rpc_params["p_customer_certainty"] == "forecast"
        assert rpc_params["p_customer_id"] == 7
        assert rpc_params["p_source_attachment_id"] == "att-1"

        attachment_insert = mock_db.table("order_attachments").insert.call_args.args[0]
        assert attachment_insert["order_id"] == 555
        assert attachment_insert["parse_status"] == "success"
        assert attachment_insert["storage_path"] == "tenant-1/inbox/msg-1/order.pdf"

    def test_no_storage_path_marks_attachment_failed_no_attachment(self):
        """添付なしメール由来のステージング行（storage_path=""）から生成された
        orderの order_attachments 行は parse_status='failed_no_attachment' で
        作成されること（フロントエンドの表示分岐と揃える）。"""
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
            created = _process_line_item(
                mock_db,
                self._staging_row(
                    storage_path="", original_filename="", content_type=None
                ),
                line,
            )

        assert created is True
        attachment_insert = mock_db.table("order_attachments").insert.call_args.args[0]
        assert attachment_insert["parse_status"] == "failed_no_attachment"

    def test_unknown_certainty_falls_back_to_forecast_tentative(self):
        """Claude抽出結果が想定外の値（揺れ・スキーマ変更等）を返した場合でも、
        orders.customer_certainty のCHECK制約に違反しないよう
        forecast_tentative にフォールバックしてRPCへ渡すこと。"""
        mock_db = MagicMock()
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 555, "action": "inserted"}]
        )
        line = {
            "product_name_raw": "製品A",
            "product_number_raw": "CODE-1",
            "quantity": 10,
            "delivery_date": "2026-08-01",
            "certainty": "予定",  # 許容値(confirmed/forecast/forecast_tentative)以外
        }

        with patch(
            "app.services.pdf_order_parsing_service.match_product_by_code",
            return_value=100,
        ):
            created = _process_line_item(mock_db, self._staging_row(), line)

        assert created is True
        rpc_params = mock_db.rpc.call_args_list[-1].args[1]
        assert rpc_params["p_customer_certainty"] == "forecast_tentative"

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

    def test_quantity_above_threshold_notifies_multi_order_suspected(self):
        """1明細の数量が閾値を超える場合、複数受注が1明細にマージされた疑いを
        検知して multi_order_suspected を通知すること（Issue #280）。
        通知はあくまで情報提供であり、order作成自体はブロックしない。"""
        mock_db = MagicMock()
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 555, "action": "inserted"}]
        )
        line = {
            "product_name_raw": "B115105",
            "product_number_raw": "B115105",
            "quantity": 999_999,
            "delivery_date": "2026-08-01",
            "certainty": "forecast",
        }

        with patch(
            "app.services.pdf_order_parsing_service.match_product_by_code",
            return_value=100,
        ):
            created = _process_line_item(mock_db, self._staging_row(), line)

        assert created is True
        insert_calls = [
            c.args[0] for c in mock_db.table().insert.call_args_list if c.args
        ]
        log_insert = next(
            c for c in insert_calls if c.get("reason") == "multi_order_suspected"
        )
        assert log_insert["detail"]["quantity"] == 999_999
        notif_insert = next(
            c for c in insert_calls if c.get("notif_type") == "multi_order_suspected"
        )
        assert notif_insert["source_table"] == "order_parse_log"

    def test_quantity_below_threshold_does_not_notify(self):
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
            _process_line_item(mock_db, self._staging_row(), line)

        insert_calls = [
            c.args[0] for c in mock_db.table().insert.call_args_list if c.args
        ]
        assert not any(c.get("reason") == "multi_order_suspected" for c in insert_calls)
