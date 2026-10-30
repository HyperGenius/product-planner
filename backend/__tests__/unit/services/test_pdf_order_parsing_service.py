from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from app.services.pdf_order_extraction_service import PdfDocumentRejectedError
from app.services.pdf_order_parsing_service import (
    _find_resent_order_id,
    _normalize_order_no_digits,
    _pick_resent_order_id,
    _process_line_item,
    _resolve_customer_order_no,
    generate_auto_customer_order_no,
    parse_pending_order_pdfs,
)
from app.services.pdf_text_service import PdfTextResult


@pytest.fixture(autouse=True)
def _no_pdf_customer_match():
    """PDF文面からの顧客再解決（Issue #385）を既定で無効化し、既存テストが
    メール単位で解決済みの customer_id をそのまま使う経路を検証できるようにする。
    再解決自体を検証するテストでは個別に return_value を上書きする。
    """
    with patch(
        "app.services.pdf_order_parsing_service.match_customer_by_pdf_text",
        return_value=None,
    ) as mock_match:
        yield mock_match


@pytest.fixture(autouse=True)
def _no_alias_match():
    """product_name_aliases による完全一致（Issue #347）を既定で無効化し、
    既存テストが pg_trgm・品番一致のフォールバック経路を検証できるようにする。
    別名一致自体を検証するテストでは個別に return_value を上書きする。
    """
    with patch(
        "app.services.pdf_order_parsing_service.match_product_by_alias",
        return_value=None,
    ) as mock_alias:
        yield mock_alias


@pytest.fixture(autouse=True)
def _no_embedded_code_match():
    """品名に埋もれた品番での照合（Issue #599）を既定で無効化し、既存テストが
    別名・品番一致・pg_trgm の経路だけを検証できるようにする。"""
    with patch(
        "app.services.pdf_order_parsing_service.match_product_by_embedded_code",
        return_value=None,
    ) as mock_embedded:
        yield mock_embedded


@pytest.fixture(autouse=True)
def _no_resent_order():
    """注文番号での再送の判定（Issue #599）を既定で無効化し、既存テストが
    RPC による dedupe の経路を検証できるようにする。判定のクエリ自体は
    TestResentDocument で検証する。"""
    with patch(
        "app.services.pdf_order_parsing_service._find_resent_order_id",
        return_value=None,
    ) as mock_resent:
        yield mock_resent


@pytest.fixture(autouse=True)
def _no_auto_simulate():
    """起票後の自動シミュレーション（Issue #477）を既定で無効化し、既存テストが
    起票まわりの DB 呼び出しだけを検証できるようにする。自動シミュの呼び出し有無を
    検証するテストではこのフィクスチャを引数で受け取る。シミュ自体のロジックは
    test_order_simulation_service.py で検証する。
    """
    with patch(
        "app.services.pdf_order_parsing_service.auto_simulate_intake_order",
        return_value=True,
    ) as mock_auto_sim:
        yield mock_auto_sim


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
        mock_db.table().select().is_().eq().order().limit().execute.return_value = (
            MagicMock(data=[])
        )

        result = parse_pending_order_pdfs(mock_db)

        assert result == {"processed": 0, "orders_created": 0, "errors": 0}

    def test_encrypted_pdf_creates_draft_order_with_known_info_only(self):
        """PDFが暗号化等で解析不能な場合でも、既知の情報（顧客等）だけで
        product_id・quantity・deadline_dateがNULLの下書きorderを起票し、
        ユーザーによる手動修正の起点とすること（Issue #304）。"""
        mock_db = MagicMock()
        mock_db.table().select().is_().eq().order().limit().execute.return_value = (
            MagicMock(data=[self._staging_row()])
        )
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 99, "action": "inserted"}]
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
        assert result == {"processed": 1, "orders_created": 1, "errors": 0}

        rpc_params = mock_db.rpc.call_args_list[-1].args[1]
        assert rpc_params["p_product_id"] is None
        assert rpc_params["p_quantity"] is None
        assert rpc_params["p_deadline_date"] is None
        assert rpc_params["p_customer_id"] == 7
        assert rpc_params["p_source_attachment_id"] == "att-1"
        # 確度も判定できないため内々示ではなく NULL（確度不明）で起票する（Issue #474）
        assert rpc_params["p_customer_certainty"] is None

        # ステージング行自体はorder紐付け済みとして "success" にする
        update_calls = mock_db.table().update.call_args_list
        assert any(c.args[0] == {"parse_status": "success"} for c in update_calls)

        # 新規order紐付け用のorder_attachments行には解析失敗理由を引き継ぐ
        attachment_insert = mock_db.table("order_attachments").insert.call_args.args[0]
        assert attachment_insert["order_id"] == 99
        assert attachment_insert["parse_status"] == "failed_encrypted"

        insert_calls = mock_db.table().insert.call_args_list
        assert any(
            c.args[0].get("notif_type") == "failed_encrypted" for c in insert_calls
        )

    def test_oversized_pdf_by_known_size_bytes_skips_download(self):
        """size_bytes が事前にMAX_PDF_BYTESを超えている場合、Storageダウンロード
        自体を行わずに拒否すること（レビュー指摘: ダウンロード前ガード）。"""
        mock_db = MagicMock()
        mock_db.table().select().is_().eq().order().limit().execute.return_value = (
            MagicMock(data=[self._staging_row(size_bytes=999_999_999)])
        )

        with (
            patch(
                "app.services.pdf_order_parsing_service.download_attachment"
            ) as mock_download,
            patch(
                "app.services.pdf_order_parsing_service.extract_text"
            ) as mock_extract_text,
        ):
            result = parse_pending_order_pdfs(mock_db)

        mock_download.assert_not_called()
        mock_extract_text.assert_not_called()
        assert result == {"processed": 1, "orders_created": 0, "errors": 0}

        log_insert = mock_db.table("order_parse_log").insert.call_args.args[0]
        assert log_insert["reason"] == "failed_too_large"

        update_calls = mock_db.table().update.call_args_list
        assert any(c.args[0] == {"parse_status": "success"} for c in update_calls)

    def test_pdf_too_large_error_during_extraction_does_not_stay_pending(self):
        """extract_text() が PdfTooLargeError を送出した場合も、ステージング行を
        pending のまま残さないこと。pending のまま残すと `.order("created_at")
        .limit(N)` のバッチが常にこの行を先頭に選び続け、後続の正常な添付の処理を
        止めてしまう（スターベーション、レビュー指摘）。"""
        from app.services.pdf_text_service import PdfTooLargeError

        mock_db = MagicMock()
        mock_db.table().select().is_().eq().order().limit().execute.return_value = (
            MagicMock(data=[self._staging_row()])
        )

        with (
            patch(
                "app.services.pdf_order_parsing_service.download_attachment",
                return_value=b"%PDF-fake",
            ),
            patch(
                "app.services.pdf_order_parsing_service.extract_text",
                side_effect=PdfTooLargeError("too many pages"),
            ),
        ):
            result = parse_pending_order_pdfs(mock_db)

        assert result == {"processed": 1, "orders_created": 0, "errors": 0}

        log_insert = mock_db.table("order_parse_log").insert.call_args.args[0]
        assert log_insert["reason"] == "failed_too_large"

        update_calls = mock_db.table().update.call_args_list
        assert any(c.args[0] == {"parse_status": "success"} for c in update_calls)

    def test_unresolved_customer_is_created_as_null_customer(self):
        """社内転送者からのメールで顧客が決まらなかったステージング行
        （customer_id=None）は、customer_id=NULL（顧客不明）の受注として起票する
        （Issue #521。以前は不整合として例外にしていた）。"""
        mock_db = MagicMock()
        mock_db.table().select().is_().eq().order().limit().execute.return_value = (
            MagicMock(data=[self._staging_row(customer_id=None)])
        )
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 99, "action": "inserted"}]
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
        ):
            result = parse_pending_order_pdfs(mock_db)

        assert result == {"processed": 1, "orders_created": 1, "errors": 0}
        rpc_params = mock_db.rpc.call_args_list[-1].args[1]
        assert rpc_params["p_customer_id"] is None

    def test_pdf_with_no_order_lines_falls_back_to_body_extraction(self):
        """PDFの内容が注文と無関係で明細が0件の場合、メール本文から抽出した
        line_itemsを使ってorderが作成されること（Issue #278/#280）。"""
        mock_db = MagicMock()
        mock_db.table().select().is_().eq().order().limit().execute.return_value = (
            MagicMock(data=[self._staging_row()])
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
                return_value={"document_order_no": None, "line_items": []},
            ),
            patch(
                "app.services.pdf_order_parsing_service.extract_email_order_lines",
                return_value={
                    "document_order_no": None,
                    "line_items": [
                        {
                            "product_name_raw": "製品A",
                            "product_number_raw": None,
                            "quantity": 5,
                            "delivery_date": "2026-08-01",
                            "certainty": "confirmed",
                        }
                    ],
                },
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
        mock_db.table().select().is_().eq().order().limit().execute.return_value = (
            MagicMock(data=[self._staging_row()])
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
                return_value={"document_order_no": None, "line_items": []},
            ),
            patch(
                "app.services.pdf_order_parsing_service.extract_email_order_lines",
                return_value={
                    "document_order_no": None,
                    "line_items": line_items,
                },
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
        mock_db.table().select().is_().eq().order().limit().execute.return_value = (
            MagicMock(data=[self._staging_row()])
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
                return_value={"document_order_no": None, "line_items": []},
            ),
            patch(
                "app.services.pdf_order_parsing_service.extract_email_order_lines",
                return_value={"document_order_no": None, "line_items": []},
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

        # 既に non_order_email の parse_log があるため no_order_created は二重に
        # 記録しない（Issue #357）
        assert not any(c.get("reason") == "no_order_created" for c in insert_calls)

    def test_all_lines_deduped_notifies_no_order_created(self):
        """自動抽出は成功したが全明細が既存注文と重複し upsert が
        skipped_no_change を返した場合、parse_status='success' だけで終わらず
        no_order_created の parse_log と通知を記録すること（Issue #357）。"""
        mock_db = MagicMock()
        mock_db.table().select().is_().eq().order().limit().execute.return_value = (
            MagicMock(data=[self._staging_row()])
        )
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": None, "action": "skipped_no_change"}]
        )
        # _notify_if_no_order_created の「既存 parse_log あり?」チェックは空を返す
        mock_db.table().select().eq().limit().execute.return_value = MagicMock(data=[])

        with (
            patch(
                "app.services.pdf_order_parsing_service.download_attachment",
                return_value=b"%PDF-fake",
            ),
            patch(
                "app.services.pdf_order_parsing_service.extract_text",
                return_value=PdfTextResult(text="注文書", failure_reason=None),
            ),
            patch(
                "app.services.pdf_order_parsing_service.extract_order_lines",
                return_value={
                    "document_order_no": None,
                    "line_items": [
                        {
                            "product_name_raw": "FILTER COMP",
                            "product_number_raw": "F-1",
                            "quantity": 20000,
                            "delivery_date": "2026-08-31",
                            "certainty": "confirmed",
                        }
                    ],
                },
            ),
            patch(
                "app.services.pdf_order_parsing_service.match_product_by_code",
                return_value=100,
            ),
        ):
            result = parse_pending_order_pdfs(mock_db)

        assert result == {"processed": 1, "orders_created": 0, "errors": 0}

        insert_calls = [
            c.args[0] for c in mock_db.table().insert.call_args_list if c.args
        ]
        log_insert = next(
            c for c in insert_calls if c.get("reason") == "no_order_created"
        )
        assert log_insert["order_attachment_id"] == "att-1"

        notif_insert = next(
            c for c in insert_calls if c.get("notif_type") == "no_order_created"
        )
        assert notif_insert["source_table"] == "order_parse_log"

        # ステージング行は success に更新される（再処理ループには戻さない）
        update_calls = mock_db.table().update.call_args_list
        assert any(c.args[0] == {"parse_status": "success"} for c in update_calls)

    def test_non_pdf_staging_row_skips_pdf_extraction_and_uses_email_body(self):
        """非PDF添付・添付なしメール由来のステージング行（Issue #280）は、
        PDFテキスト抽出を経由せず直接メール本文から抽出すること。"""
        mock_db = MagicMock()
        mock_db.table().select().is_().eq().order().limit().execute.return_value = (
            MagicMock(
                data=[
                    self._staging_row(
                        storage_path="",
                        original_filename="",
                        content_type=None,
                        size_bytes=None,
                    )
                ]
            )
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
                return_value={
                    "document_order_no": None,
                    "line_items": [
                        {
                            "product_name_raw": "製品B",
                            "product_number_raw": "CODE-B",
                            "quantity": 3,
                            "delivery_date": "2026-11-30",
                            "certainty": "forecast_tentative",
                        }
                    ],
                },
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
        mock_db.table().select().is_().eq().order().limit().execute.return_value = (
            MagicMock(data=[self._staging_row()])
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

    def test_alias_exact_match_takes_priority_over_code_and_trgm(self, _no_alias_match):
        """product_name_aliases の完全一致（Issue #347）は products.code の完全一致
        や pg_trgm 検索より優先され、一致すればそれらはスキップされること。"""
        mock_db = MagicMock()
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 555, "action": "inserted"}]
        )
        _no_alias_match.return_value = 4242
        line = {
            "product_name_raw": "謎の表記ゆれ製品",
            "product_number_raw": None,
            "quantity": 10,
            "delivery_date": "2026-08-01",
            "certainty": "confirmed",
        }

        with (
            patch(
                "app.services.pdf_order_parsing_service.match_product_by_code",
            ) as mock_code,
            patch(
                "app.services.pdf_order_parsing_service.match_products",
            ) as mock_trgm,
        ):
            created = _process_line_item(mock_db, self._staging_row(), line)

        assert created is True
        mock_code.assert_not_called()
        mock_trgm.assert_not_called()
        # 別名検索は明細ごとに解決済みの customer_id でスコープされる（Issue #349）
        assert _no_alias_match.call_args.args == (
            mock_db,
            "tenant-1",
            7,
            "謎の表記ゆれ製品",
        )
        rpc_params = mock_db.rpc.call_args_list[-1].args[1]
        assert rpc_params["p_product_id"] == 4242

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

    @pytest.mark.parametrize(
        "certainty_overrides",
        [
            # 許容値(confirmed/forecast/forecast_tentative)以外
            {"certainty": "予定"},
            # null
            {"certainty": None},
            # キー自体が未指定
            {},
        ],
        ids=["unexpected_value", "null", "missing"],
    )
    def test_unknown_certainty_is_passed_as_null(self, certainty_overrides):
        """Claude抽出結果の確度が想定外の値・未指定（揺れ・スキーマ変更等）の場合、
        orders.customer_certainty のCHECK制約に違反せず、かつ内々示と誤認されない
        よう NULL（確度不明）でRPCへ渡すこと（Issue #474）。"""
        mock_db = MagicMock()
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 555, "action": "inserted"}]
        )
        line = {
            "product_name_raw": "製品A",
            "product_number_raw": "CODE-1",
            "quantity": 10,
            "delivery_date": "2026-08-01",
            **certainty_overrides,
        }

        with patch(
            "app.services.pdf_order_parsing_service.match_product_by_code",
            return_value=100,
        ):
            created = _process_line_item(mock_db, self._staging_row(), line)

        assert created is True
        rpc_params = mock_db.rpc.call_args_list[-1].args[1]
        assert rpc_params["p_customer_certainty"] is None

    @pytest.mark.parametrize(
        "certainty", ["confirmed", "forecast", "forecast_tentative"]
    )
    def test_valid_certainty_is_passed_through(self, certainty):
        """許容値の確度はそのままRPCへ渡すこと。"""
        mock_db = MagicMock()
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 555, "action": "inserted"}]
        )
        line = {
            "product_name_raw": "製品A",
            "product_number_raw": "CODE-1",
            "quantity": 10,
            "delivery_date": "2026-08-01",
            "certainty": certainty,
        }

        with patch(
            "app.services.pdf_order_parsing_service.match_product_by_code",
            return_value=100,
        ):
            _process_line_item(mock_db, self._staging_row(), line)

        rpc_params = mock_db.rpc.call_args_list[-1].args[1]
        assert rpc_params["p_customer_certainty"] == certainty

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

    # --- Issue #477: 起票後の自動シミュレーション ---------------------------------

    _LINE = {
        "product_name_raw": "製品A",
        "product_number_raw": "CODE-1",
        "quantity": 10,
        "delivery_date": "2026-08-01",
        "certainty": "confirmed",
    }

    @pytest.mark.parametrize("action", ["inserted", "updated"])
    def test_inserted_or_updated_order_is_auto_simulated(
        self, _no_auto_simulate, action
    ):
        """inserted / updated の受注は起票後に自動シミュを呼ぶ（updated は数量変更後の
        シミュ納期へ更新するための再シミュ）。"""
        mock_db = MagicMock()
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 555, "action": action}]
        )

        with patch(
            "app.services.pdf_order_parsing_service.match_product_by_code",
            return_value=100,
        ):
            created = _process_line_item(mock_db, self._staging_row(), self._LINE)

        assert created is True
        _no_auto_simulate.assert_called_once_with(mock_db, "tenant-1", 555)

    @pytest.mark.parametrize(
        "action", ["skipped_no_change", "skipped_downgrade", "skipped_draft_conflict"]
    )
    def test_skipped_order_is_not_auto_simulated(self, _no_auto_simulate, action):
        """skipped_* は起票していないため自動シミュしない（cron 再実行で二重計算しない）。"""
        mock_db = MagicMock()
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 42, "action": action}]
        )

        with patch(
            "app.services.pdf_order_parsing_service.match_product_by_code",
            return_value=100,
        ):
            _process_line_item(mock_db, self._staging_row(), self._LINE)

        _no_auto_simulate.assert_not_called()

    def test_unmatched_product_order_is_not_auto_simulated(self, _no_auto_simulate):
        """製品未照合（product_id=NULL）の下書きは自動シミュの対象外。"""
        mock_db = MagicMock()
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 999, "action": "inserted"}]
        )

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
            created = _process_line_item(mock_db, self._staging_row(), self._LINE)

        assert created is True
        _no_auto_simulate.assert_not_called()

    def test_auto_simulate_failure_does_not_affect_intake(self, _no_auto_simulate):
        """自動シミュが失敗（False）しても起票自体は成功扱いのまま。"""
        _no_auto_simulate.return_value = False
        mock_db = MagicMock()
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 555, "action": "inserted"}]
        )

        with patch(
            "app.services.pdf_order_parsing_service.match_product_by_code",
            return_value=100,
        ):
            created = _process_line_item(mock_db, self._staging_row(), self._LINE)

        assert created is True
        _no_auto_simulate.assert_called_once()


@pytest.mark.unit
class TestCustomerOrderNoResolution:
    """Issue #366: 顧客側の注文番号（customer_order_no）の解決と採番。"""

    def test_line_order_no_takes_priority_over_document_order_no(self):
        line = {"line_order_no": " L-99 "}
        assert _resolve_customer_order_no(line, "C1868", "AUTO-xxxx") == "L-99"

    def test_line_order_no_circled_number_is_normalized(self):
        # 昭和製作所: 明細表の連番 ① を文書番号へ付与した line_order_no（Issue #370）
        assert (
            _resolve_customer_order_no({"line_order_no": "C1869-①"}, "C1869", None)
            == "C1869-1"
        )
        assert (
            _resolve_customer_order_no({"line_order_no": " C1869-⑪ "}, "C1869", None)
            == "C1869-11"
        )

    def test_document_order_no_circled_number_is_normalized(self):
        assert _resolve_customer_order_no({}, "Ｃ1869-⑳", None) == "Ｃ1869-20"

    def test_falls_back_to_document_order_no_when_line_order_no_missing(self):
        for line in ({}, {"line_order_no": None}, {"line_order_no": "  "}):
            assert _resolve_customer_order_no(line, " C1868 ", "AUTO-xxxx") == "C1868"

    def test_falls_back_to_auto_order_no_when_no_number_in_document(self):
        assert (
            _resolve_customer_order_no({}, None, "AUTO-abc1234567") == "AUTO-abc1234567"
        )

    def test_returns_none_when_nothing_available(self):
        assert _resolve_customer_order_no({}, None, None) is None

    def test_auto_order_no_is_deterministic_for_same_document(self):
        text = "注文一覧表 2026年7月29日  FILTER COMP"
        assert generate_auto_customer_order_no(
            42, text
        ) == generate_auto_customer_order_no(
            42, "  注文一覧表\n2026年7月29日\tFILTER COMP "
        )

    def test_auto_order_no_differs_by_customer_and_content(self):
        text = "注文一覧表"
        assert generate_auto_customer_order_no(
            1, text
        ) != generate_auto_customer_order_no(2, text)
        assert generate_auto_customer_order_no(
            1, "A"
        ) != generate_auto_customer_order_no(1, "B")

    def test_auto_order_no_is_none_for_empty_text(self):
        assert generate_auto_customer_order_no(1, "") is None
        assert generate_auto_customer_order_no(1, "   ") is None
        assert generate_auto_customer_order_no(1, None) is None

    def test_process_line_item_passes_line_order_no_to_rpc(self):
        mock_db = MagicMock()
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 1, "action": "inserted"}]
        )
        line = {
            "product_name_raw": "製品A",
            "product_number_raw": "CODE-1",
            "quantity": 10,
            "delivery_date": "2026-08-01",
            "certainty": "confirmed",
            "line_order_no": "C1868-3",
        }
        staging_row = {
            "id": "att-1",
            "tenant_id": "tenant-1",
            "customer_id": 7,
            "source_raw": "本文",
            "storage_path": "p/x.pdf",
            "original_filename": "x.pdf",
            "content_type": "application/pdf",
        }
        with patch(
            "app.services.pdf_order_parsing_service.match_product_by_code",
            return_value=100,
        ):
            created = _process_line_item(
                mock_db, staging_row, line, "C1868", "AUTO-fallback01"
            )

        assert created is True
        rpc_params = mock_db.rpc.call_args_list[-1].args[1]
        assert rpc_params["p_customer_order_no"] == "C1868-3"

    def test_process_line_item_normalizes_circled_line_order_no(self):
        mock_db = MagicMock()
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 1, "action": "inserted"}]
        )
        line = {
            "product_name_raw": "製品A",
            "product_number_raw": "CODE-1",
            "quantity": 10,
            "delivery_date": "2026-08-01",
            "certainty": "confirmed",
            "line_order_no": "C1869-①",
        }
        staging_row = {
            "id": "att-1",
            "tenant_id": "tenant-1",
            "customer_id": 5,
            "source_raw": "本文",
            "storage_path": "p/x.pdf",
            "original_filename": "x.pdf",
            "content_type": "application/pdf",
        }
        with patch(
            "app.services.pdf_order_parsing_service.match_product_by_code",
            return_value=100,
        ):
            _process_line_item(mock_db, staging_row, line, "C1869", "AUTO-1")

        rpc_params = mock_db.rpc.call_args_list[-1].args[1]
        assert rpc_params["p_customer_order_no"] == "C1869-1"

    def test_process_line_item_falls_back_to_document_then_auto(self):
        mock_db = MagicMock()
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 1, "action": "inserted"}]
        )
        base_line = {
            "product_name_raw": "製品A",
            "product_number_raw": "CODE-1",
            "quantity": 10,
            "delivery_date": "2026-08-01",
            "certainty": "confirmed",
        }
        staging_row = {
            "id": "att-1",
            "tenant_id": "tenant-1",
            "customer_id": 7,
            "source_raw": "本文",
            "storage_path": "p/x.pdf",
            "original_filename": "x.pdf",
            "content_type": "application/pdf",
        }
        with patch(
            "app.services.pdf_order_parsing_service.match_product_by_code",
            return_value=100,
        ):
            _process_line_item(mock_db, staging_row, dict(base_line), "C1868", "AUTO-1")
            assert (
                mock_db.rpc.call_args_list[-1].args[1]["p_customer_order_no"] == "C1868"
            )
            _process_line_item(mock_db, staging_row, dict(base_line), None, "AUTO-1")
            assert (
                mock_db.rpc.call_args_list[-1].args[1]["p_customer_order_no"]
                == "AUTO-1"
            )


@pytest.mark.unit
class TestNormalizeOrderNoDigits:
    """Issue #370: 丸数字・全角数字を半角アラビア数字へ正規化する。"""

    def test_circled_numbers_within_first_block(self):
        assert _normalize_order_no_digits("①") == "1"
        assert _normalize_order_no_digits("⑩") == "10"
        assert _normalize_order_no_digits("⑳") == "20"

    def test_circled_numbers_above_twenty_are_non_contiguous_block(self):
        # ㉑ 以降は ① ブロックと非連続。単純なコードポイント演算では扱えない領域
        assert _normalize_order_no_digits("㉑") == "21"
        assert _normalize_order_no_digits("㉟") == "35"
        assert _normalize_order_no_digits("㊱") == "36"
        assert _normalize_order_no_digits("㊿") == "50"

    def test_fullwidth_digits(self):
        assert _normalize_order_no_digits("Ｃ１８６９－１１") == "Ｃ1869－11"

    def test_mixed_string_only_touches_digit_symbols(self):
        assert _normalize_order_no_digits("C1869-⑪") == "C1869-11"

    def test_ascii_only_is_noop(self):
        for value in ("C1868-3", "AUTO-abc1234567", "L-99", ""):
            assert _normalize_order_no_digits(value) == value

    def test_idempotent(self):
        once = _normalize_order_no_digits("C1869-⑪")
        assert _normalize_order_no_digits(once) == once


@pytest.mark.unit
class TestPerPdfCustomerResolution:
    """束ね添付メール（1通にN顧客の注文書PDF）で、各PDFの文面から顧客を
    解決し直し、正しい顧客へ紐づけて起票する（Issue #385）。"""

    def _staging_row(self, **overrides):
        # customer_id=7 は「メール単位で1回だけ解決した」値。束ね添付では
        # 全ステージング行がこの同じ値を持ち、多くの場合は誤っている。
        row = {
            "id": "att-1",
            "tenant_id": "tenant-1",
            "customer_id": 7,
            "gmail_message_id": "msg-1",
            "source_raw": "本文",
            "storage_path": "tenant-1/inbox/msg-1/order.pdf",
            "original_filename": "order.pdf",
            "content_type": "application/pdf",
            "size_bytes": 1234,
            "parse_status": "pending",
        }
        row.update(overrides)
        return row

    def _patches(self):
        return (
            patch(
                "app.services.pdf_order_parsing_service.download_attachment",
                return_value=b"%PDF-fake",
            ),
            patch(
                "app.services.pdf_order_parsing_service.extract_text",
                return_value=PdfTextResult(
                    text="発注元 ABC製作所", failure_reason=None
                ),
            ),
            patch(
                "app.services.pdf_order_parsing_service.extract_order_lines",
                return_value={
                    "document_order_no": "PO-1",
                    "line_items": [
                        {
                            "product_name_raw": "製品A",
                            "product_number_raw": None,
                            "quantity": 5,
                            "delivery_date": "2026-08-01",
                            "certainty": "confirmed",
                        }
                    ],
                },
            ),
            patch(
                "app.services.pdf_order_parsing_service.match_product_by_code",
                return_value=None,
            ),
            patch(
                "app.services.pdf_order_parsing_service.match_products",
                return_value={"product_id": 100, "candidates": []},
            ),
        )

    def test_order_is_created_for_customer_resolved_from_pdf_text(
        self, _no_pdf_customer_match
    ):
        _no_pdf_customer_match.return_value = 55

        mock_db = MagicMock()
        mock_db.table().select().is_().eq().order().limit().execute.return_value = (
            MagicMock(data=[self._staging_row()])
        )
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 42, "action": "inserted"}]
        )

        p1, p2, p3, p4, p5 = self._patches()
        with p1, p2, p3, p4, p5:
            result = parse_pending_order_pdfs(mock_db)

        assert result == {"processed": 1, "orders_created": 1, "errors": 0}
        rpc_params = mock_db.rpc.call_args_list[-1].args[1]
        # メール単位の 7 ではなく、PDF文面から解決した 55 で起票される
        assert rpc_params["p_customer_id"] == 55

    def test_falls_back_to_email_level_customer_when_pdf_unresolved(
        self, _no_pdf_customer_match
    ):
        _no_pdf_customer_match.return_value = None

        mock_db = MagicMock()
        mock_db.table().select().is_().eq().order().limit().execute.return_value = (
            MagicMock(data=[self._staging_row()])
        )
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 42, "action": "inserted"}]
        )

        p1, p2, p3, p4, p5 = self._patches()
        with p1, p2, p3, p4, p5:
            result = parse_pending_order_pdfs(mock_db)

        assert result == {"processed": 1, "orders_created": 1, "errors": 0}
        rpc_params = mock_db.rpc.call_args_list[-1].args[1]
        assert rpc_params["p_customer_id"] == 7

    def test_customer_extraction_prompt_is_looked_up_with_resolved_customer(
        self, _no_pdf_customer_match
    ):
        _no_pdf_customer_match.return_value = 55

        mock_db = MagicMock()
        mock_db.table().select().is_().eq().order().limit().execute.return_value = (
            MagicMock(data=[self._staging_row()])
        )
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 42, "action": "inserted"}]
        )

        p1, p2, p3, p4, p5 = self._patches()
        with p1, p2, p3, p4, p5:
            parse_pending_order_pdfs(mock_db)

        # _get_customer_extraction_prompt が再解決後の customer_id で引かれる
        mock_db.table().select().eq().eq.assert_any_call("id", 55)

    def test_body_fallback_keeps_email_level_customer_not_pdf_resolved(
        self, _no_pdf_customer_match
    ):
        """PDFから明細が0件でメール本文へフォールバックする場合、本文由来の受注は
        PDF文面から再解決した顧客ではなく、メール単位で解決済みの customer_id で
        起票されること（PDF文面の顧客解決を本文経路へ波及させない）。"""
        _no_pdf_customer_match.return_value = 55

        mock_db = MagicMock()
        mock_db.table().select().is_().eq().order().limit().execute.return_value = (
            MagicMock(data=[self._staging_row()])
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
                    text="無関係な文書 ABC製作所", failure_reason=None
                ),
            ),
            patch(
                "app.services.pdf_order_parsing_service.extract_order_lines",
                return_value={"document_order_no": None, "line_items": []},
            ),
            patch(
                "app.services.pdf_order_parsing_service.extract_email_order_lines",
                return_value={
                    "document_order_no": None,
                    "line_items": [
                        {
                            "product_name_raw": "製品A",
                            "product_number_raw": None,
                            "quantity": 5,
                            "delivery_date": "2026-08-01",
                            "certainty": "confirmed",
                        }
                    ],
                },
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
        assert rpc_params["p_customer_id"] == 7

    def test_unreadable_pdf_does_not_attempt_pdf_text_resolution(
        self, _no_pdf_customer_match
    ):
        mock_db = MagicMock()
        mock_db.table().select().is_().eq().order().limit().execute.return_value = (
            MagicMock(data=[self._staging_row()])
        )
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 99, "action": "inserted"}]
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
        ):
            parse_pending_order_pdfs(mock_db)

        _no_pdf_customer_match.assert_not_called()
        rpc_params = mock_db.rpc.call_args_list[-1].args[1]
        assert rpc_params["p_customer_id"] == 7


@pytest.mark.unit
class TestImagePdfExtraction:
    """テキストを持たない画像PDF（FAX受信・スキャン）を Claude に画像として読ませて
    起票する（Issue #520）。"""

    _LINE = {
        "product_name_raw": "製品A",
        "product_number_raw": None,
        "quantity": 5,
        "delivery_date": "2026-08-01",
        "line_order_no": None,
        "certainty": "confirmed",
    }

    def _staging_row(self, **overrides):
        # 社長が件名・本文なしで転送してくるため、本文は空。customer_id=7 は
        # 社長のアドレスから解決された（誤った）メール単位の値を想定する。
        row = {
            "id": "att-1",
            "tenant_id": "tenant-1",
            "customer_id": 7,
            "gmail_message_id": "msg-1",
            "source_raw": "",
            "storage_path": "tenant-1/inbox/msg-1/fax.pdf",
            "original_filename": "fax.pdf",
            "content_type": "application/pdf",
            "size_bytes": 1234,
            "parse_status": "pending",
        }
        row.update(overrides)
        return row

    def _mock_db(self, action="inserted"):
        mock_db = MagicMock()
        mock_db.table().select().is_().eq().order().limit().execute.return_value = (
            MagicMock(data=[self._staging_row()])
        )
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 42, "action": action}]
        )
        # 既存の parse_log なし・顧客固有の抽出指示なし
        mock_db.table().select().eq().limit().execute.return_value = MagicMock(data=[])
        mock_db.table().select().eq().eq().limit().execute.return_value = MagicMock(
            data=[]
        )
        return mock_db

    def _base_patches(self):
        return (
            patch(
                "app.services.pdf_order_parsing_service.download_attachment",
                return_value=b"%PDF-fax",
            ),
            patch(
                "app.services.pdf_order_parsing_service.extract_text",
                return_value=PdfTextResult(text=None, failure_reason="failed_image"),
            ),
            patch(
                "app.services.pdf_order_parsing_service.match_product_by_code",
                return_value=None,
            ),
            patch(
                "app.services.pdf_order_parsing_service.match_products",
                return_value={"product_id": 100, "candidates": []},
            ),
        )

    @staticmethod
    def _parse_log_reasons(mock_db):
        return [
            c.args[0]["reason"]
            for c in mock_db.table().insert.call_args_list
            if isinstance(c.args[0], dict) and "reason" in c.args[0]
        ]

    def test_image_pdf_lines_are_created_as_orders(self):
        mock_db = self._mock_db()
        p1, p2, p3, p4 = self._base_patches()
        with (
            p1,
            p2,
            p3,
            p4,
            patch(
                "app.services.pdf_order_parsing_service.extract_order_lines_from_pdf",
                return_value={
                    "document_order_no": "PO-1",
                    "line_items": [self._LINE, {**self._LINE, "quantity": 10}],
                    "issuer_company_name": None,
                },
            ) as mock_image_extract,
            patch(
                "app.services.pdf_order_parsing_service.extract_order_lines"
            ) as mock_text_extract,
            patch(
                "app.services.pdf_order_parsing_service.extract_email_order_lines"
            ) as mock_body_extract,
        ):
            result = parse_pending_order_pdfs(mock_db)

        assert result == {"processed": 1, "orders_created": 2, "errors": 0}
        # PDFのバイト列をそのまま画像抽出に渡し、テキスト抽出・本文抽出は行わない
        assert mock_image_extract.call_args.args[0] == b"%PDF-fax"
        mock_text_extract.assert_not_called()
        mock_body_extract.assert_not_called()

        upsert_calls = [
            c
            for c in mock_db.rpc.call_args_list
            if c.args and c.args[0] == "upsert_order_by_dedupe_key"
        ]
        assert [c.args[1]["p_quantity"] for c in upsert_calls] == [5, 10]
        assert all(c.args[1]["p_customer_order_no"] == "PO-1" for c in upsert_calls)

        # 起票した受注の添付行は要確認表示用の success_image
        attachment_inserts = [
            c.args[0]
            for c in mock_db.table().insert.call_args_list
            if isinstance(c.args[0], dict) and "order_id" in c.args[0]
        ]
        assert [a["parse_status"] for a in attachment_inserts] == [
            "success_image",
            "success_image",
        ]
        assert self._parse_log_reasons(mock_db) == ["image_extracted"]

        update_calls = mock_db.table().update.call_args_list
        assert any(c.args[0] == {"parse_status": "success"} for c in update_calls)

    def test_customer_is_re_resolved_from_issuer_company_name(
        self, _no_pdf_customer_match
    ):
        _no_pdf_customer_match.return_value = 55
        mock_db = self._mock_db()
        p1, p2, p3, p4 = self._base_patches()
        with (
            p1,
            p2,
            p3,
            p4,
            patch(
                "app.services.pdf_order_parsing_service.extract_order_lines_from_pdf",
                return_value={
                    "document_order_no": None,
                    "line_items": [self._LINE],
                    "issuer_company_name": "株式会社ABC製作所",
                    "issuer_fax_number": "03-1234-5678",
                    "issuer_phone_number": "03-1234-5670",
                },
            ),
        ):
            parse_pending_order_pdfs(mock_db)

        assert _no_pdf_customer_match.call_args.args[1:] == (
            "tenant-1",
            "株式会社ABC製作所",
            ["03-1234-5678", "03-1234-5670"],
        )
        rpc_params = mock_db.rpc.call_args_list[-1].args[1]
        assert rpc_params["p_customer_id"] == 55

    def test_re_extracts_with_resolved_customer_prompt(self, _no_pdf_customer_match):
        _no_pdf_customer_match.return_value = 55
        mock_db = self._mock_db()
        p1, p2, p3, p4 = self._base_patches()
        with (
            p1,
            p2,
            p3,
            p4,
            patch(
                "app.services.pdf_order_parsing_service._get_customer_extraction_prompt",
                side_effect=lambda _db, _tenant, customer_id: (
                    "数量はケース数×12で換算する" if customer_id == 55 else None
                ),
            ),
            patch(
                "app.services.pdf_order_parsing_service.extract_order_lines_from_pdf",
                side_effect=[
                    {
                        "document_order_no": None,
                        "line_items": [self._LINE],
                        "issuer_company_name": "ABC製作所",
                    },
                    {
                        "document_order_no": None,
                        "line_items": [{**self._LINE, "quantity": 60}],
                        "issuer_company_name": "ABC製作所",
                    },
                ],
            ) as mock_image_extract,
        ):
            result = parse_pending_order_pdfs(mock_db)

        assert result["orders_created"] == 1
        assert [c.args[1] for c in mock_image_extract.call_args_list] == [
            None,
            "数量はケース数×12で換算する",
        ]
        rpc_params = mock_db.rpc.call_args_list[-1].args[1]
        assert rpc_params["p_customer_id"] == 55
        assert rpc_params["p_quantity"] == 60

    @pytest.mark.parametrize("failure", ["no_lines", "rejected"])
    def test_unreadable_image_falls_back_to_empty_draft(self, failure):
        mock_db = self._mock_db()
        p1, p2, p3, p4 = self._base_patches()
        image_extract_kwargs: dict[str, Any] = (
            {
                "return_value": {
                    "document_order_no": None,
                    "line_items": [],
                    "issuer_company_name": None,
                }
            }
            if failure == "no_lines"
            else {"side_effect": PdfDocumentRejectedError("status=400")}
        )
        with (
            p1,
            p2,
            p3,
            p4,
            patch(
                "app.services.pdf_order_parsing_service.extract_order_lines_from_pdf",
                **image_extract_kwargs,
            ),
        ):
            result = parse_pending_order_pdfs(mock_db)

        assert result == {"processed": 1, "orders_created": 1, "errors": 0}
        rpc_params = mock_db.rpc.call_args_list[-1].args[1]
        assert rpc_params["p_product_id"] is None
        assert rpc_params["p_quantity"] is None
        assert rpc_params["p_customer_id"] == 7
        attachment_insert = mock_db.table("order_attachments").insert.call_args.args[0]
        assert attachment_insert["parse_status"] == "failed_image"
        assert self._parse_log_reasons(mock_db) == ["failed_image"]

    def test_transient_api_error_keeps_row_pending_for_retry(self):
        mock_db = self._mock_db()
        p1, p2, p3, p4 = self._base_patches()
        with (
            p1,
            p2,
            p3,
            p4,
            patch(
                "app.services.pdf_order_parsing_service.extract_order_lines_from_pdf",
                side_effect=RuntimeError("overloaded"),
            ),
        ):
            result = parse_pending_order_pdfs(mock_db)

        assert result == {"processed": 0, "orders_created": 0, "errors": 1}
        # 空の下書きを作らず、ステージング行も pending のまま次回の cron に回す
        assert not any(
            c.args and c.args[0] == "upsert_order_by_dedupe_key"
            for c in mock_db.rpc.call_args_list
        )
        update_calls = mock_db.table().update.call_args_list
        assert not any(c.args[0] == {"parse_status": "success"} for c in update_calls)

    def test_all_lines_skipped_notifies_no_order_created_without_image_log(self):
        mock_db = self._mock_db(action="skipped_no_change")
        p1, p2, p3, p4 = self._base_patches()
        with (
            p1,
            p2,
            p3,
            p4,
            patch(
                "app.services.pdf_order_parsing_service.extract_order_lines_from_pdf",
                return_value={
                    "document_order_no": None,
                    "line_items": [self._LINE],
                    "issuer_company_name": None,
                },
            ),
        ):
            result = parse_pending_order_pdfs(mock_db)

        assert result == {"processed": 1, "orders_created": 0, "errors": 0}
        assert self._parse_log_reasons(mock_db) == ["no_order_created"]

    def test_unresolved_customer_skips_alias_and_supersede(self, _no_alias_match):
        """社内転送者からのメールで顧客が決まらない場合（Issue #521）、顧客不明の
        受注として起票し、顧客単位の別名辞書・内示の無効化は行わない。"""
        mock_db = self._mock_db()
        mock_db.table().select().is_().eq().order().limit().execute.return_value = (
            MagicMock(data=[self._staging_row(customer_id=None)])
        )
        p1, p2, p3, p4 = self._base_patches()
        with (
            p1,
            p2,
            p3,
            p4,
            patch(
                "app.services.pdf_order_parsing_service.extract_order_lines_from_pdf",
                return_value={
                    "document_order_no": None,
                    "line_items": [self._LINE],
                    "issuer_company_name": "読み取れた社名",
                    "issuer_fax_number": None,
                },
            ),
        ):
            result = parse_pending_order_pdfs(mock_db)

        assert result["orders_created"] == 1
        rpc_params = mock_db.rpc.call_args_list[-1].args[1]
        assert rpc_params["p_customer_id"] is None
        _no_alias_match.assert_not_called()
        update_calls = mock_db.table().update.call_args_list
        assert not any("superseded_at" in c.args[0] for c in update_calls)


@pytest.mark.unit
class TestRepairOrderIntake:
    """修理と判定した注文書は、製品・工程を持たない修理の下書きを1件起票する（Issue #493）。"""

    _REPAIR_EXTRACTION: dict[str, Any] = {
        "document_order_no": "R-0001",
        "order_type": "repair",
        "subject": "基板 はんだ補修",
        "line_items": [
            {
                "product_name_raw": "補修部1〜3ヶ所",
                "product_number_raw": None,
                "quantity": 11,
                "delivery_date": "2026-11-10",
                "line_order_no": None,
                "certainty": "confirmed",
            },
            {
                "product_name_raw": "補修部4〜6ヶ所",
                "product_number_raw": None,
                "quantity": 1,
                "delivery_date": "2026-11-05",
                "line_order_no": None,
                "certainty": "confirmed",
            },
        ],
    }

    def _staging_row(self, **overrides):
        row = {
            "id": "att-1",
            "tenant_id": "tenant-1",
            "customer_id": 7,
            "gmail_message_id": "msg-1",
            "source_raw": "本文",
            "storage_path": "tenant-1/inbox/msg-1/repair.pdf",
            "original_filename": "repair.pdf",
            "content_type": "application/pdf",
            "size_bytes": 1234,
            "parse_status": "pending",
        }
        row.update(overrides)
        return row

    def _mock_db(self, *, repair_insert_error: Exception | None = None):
        mock_db = MagicMock()
        mock_db.table().select().is_().eq().order().limit().execute.return_value = (
            MagicMock(data=[self._staging_row()])
        )
        # 既存の parse_log なし・顧客固有の抽出指示なし
        mock_db.table().select().eq().limit().execute.return_value = MagicMock(data=[])
        mock_db.table().select().eq().eq().limit().execute.return_value = MagicMock(
            data=[]
        )

        def insert(payload):
            chain = MagicMock()
            if payload.get("order_type") == "repair" and repair_insert_error:
                chain.execute.side_effect = repair_insert_error
            else:
                chain.execute.return_value = MagicMock(data=[{"id": 77}])
            return chain

        mock_db.table().insert.side_effect = insert
        return mock_db

    @staticmethod
    def _inserts(mock_db):
        return [
            c.args[0]
            for c in mock_db.table().insert.call_args_list
            if c.args and isinstance(c.args[0], dict)
        ]

    def _run_text_pdf(self, mock_db, extraction):
        with (
            patch(
                "app.services.pdf_order_parsing_service.download_attachment",
                return_value=b"%PDF-fake",
            ),
            patch(
                "app.services.pdf_order_parsing_service.extract_text",
                return_value=PdfTextResult(
                    text="件名 基板 はんだ補修", failure_reason=None
                ),
            ),
            patch(
                "app.services.pdf_order_parsing_service.extract_order_lines",
                return_value=extraction,
            ),
            patch(
                "app.services.pdf_order_parsing_service.extract_email_order_lines"
            ) as mock_body_extract,
        ):
            result = parse_pending_order_pdfs(mock_db)
        return result, mock_body_extract

    def test_repair_pdf_creates_single_repair_draft(self, _no_auto_simulate):
        mock_db = self._mock_db()

        result, mock_body_extract = self._run_text_pdf(mock_db, self._REPAIR_EXTRACTION)

        assert result == {"processed": 1, "orders_created": 1, "errors": 0}
        # 明細ごとの起票（upsert_order_by_dedupe_key）・本文フォールバック・自動シミュは通らない
        assert not [
            c
            for c in mock_db.rpc.call_args_list
            if c.args and c.args[0] == "upsert_order_by_dedupe_key"
        ]
        mock_body_extract.assert_not_called()
        _no_auto_simulate.assert_not_called()

        repair_inserts = [i for i in self._inserts(mock_db) if "order_type" in i]
        assert repair_inserts == [
            {
                "tenant_id": "tenant-1",
                "order_type": "repair",
                "customer_id": 7,
                "work_description": (
                    "基板 はんだ補修\n・補修部1〜3ヶ所 ×11\n・補修部4〜6ヶ所 ×1"
                ),
                # 明細の納期のうち最も早い日
                "deadline_date": "2026-11-05",
                "customer_certainty": "confirmed",
                "customer_order_no": "R-0001",
                "status": "draft",
                "source_type": "email",
                "source_raw": "本文",
                "source_attachment_id": "att-1",
            }
        ]
        attachment_inserts = [i for i in self._inserts(mock_db) if "order_id" in i]
        assert len(attachment_inserts) == 1
        assert attachment_inserts[0]["order_id"] == 77
        assert attachment_inserts[0]["parse_status"] == "success"

        update_calls = mock_db.table().update.call_args_list
        assert any(c.args[0] == {"parse_status": "success"} for c in update_calls)

    def test_mixed_certainty_is_null_and_auto_order_no_is_used(self):
        mock_db = self._mock_db()
        extraction = {
            **self._REPAIR_EXTRACTION,
            "document_order_no": None,
            "line_items": [
                {**self._REPAIR_EXTRACTION["line_items"][0], "certainty": "forecast"},
                self._REPAIR_EXTRACTION["line_items"][1],
            ],
        }

        self._run_text_pdf(mock_db, extraction)

        (repair_insert,) = [i for i in self._inserts(mock_db) if "order_type" in i]
        assert repair_insert["customer_certainty"] is None
        # 文書に注文番号が無ければ、文書内容から決定的に採番した番号で重複を防ぐ
        assert repair_insert["customer_order_no"] == generate_auto_customer_order_no(
            7, "件名 基板 はんだ補修"
        )

    def test_duplicate_repair_is_skipped_without_overwriting(self):
        from postgrest.exceptions import APIError

        mock_db = self._mock_db(
            repair_insert_error=APIError(
                {
                    "code": "23505",
                    "message": 'duplicate key value violates unique constraint "orders_repair_customer_order_no_key"',
                }
            )
        )
        # 直前に記録した repair_duplicate_skipped を「既存の parse_log」として読み返す
        mock_db.table().select().eq().limit().execute.return_value = MagicMock(
            data=[{"id": "log-1"}]
        )

        result, _ = self._run_text_pdf(mock_db, self._REPAIR_EXTRACTION)

        assert result == {"processed": 1, "orders_created": 0, "errors": 0}
        # 既存の注文は UPDATE しない（ステージング行の parse_status 更新のみ）
        update_payloads = [c.args[0] for c in mock_db.table().update.call_args_list]
        assert update_payloads == [{"parse_status": "success"}]
        inserts = self._inserts(mock_db)
        assert not [i for i in inserts if "order_id" in i]
        reasons = [i["reason"] for i in inserts if "reason" in i]
        # 重複スキップの理由が残るので、起票0件の通知（no_order_created）は出さない
        assert reasons == ["repair_duplicate_skipped"]

    def test_other_insert_error_is_raised(self):
        from postgrest.exceptions import APIError

        mock_db = self._mock_db(
            repair_insert_error=APIError({"code": "23514", "message": "check"})
        )

        result, _ = self._run_text_pdf(mock_db, self._REPAIR_EXTRACTION)

        assert result == {"processed": 0, "orders_created": 0, "errors": 1}

    def test_repair_without_subject_and_lines_uses_existing_flow(self):
        """件名も明細も無ければ作業内容を組めないので、従来どおり本文へフォールバックする。"""
        mock_db = self._mock_db()
        extraction: dict[str, Any] = {
            "document_order_no": None,
            "order_type": "repair",
            "subject": None,
            "line_items": [],
        }

        with patch(
            "app.services.pdf_order_parsing_service.extract_email_order_lines",
            return_value={"document_order_no": None, "line_items": []},
        ):
            with (
                patch(
                    "app.services.pdf_order_parsing_service.download_attachment",
                    return_value=b"%PDF-fake",
                ),
                patch(
                    "app.services.pdf_order_parsing_service.extract_text",
                    return_value=PdfTextResult(text="本文", failure_reason=None),
                ),
                patch(
                    "app.services.pdf_order_parsing_service.extract_order_lines",
                    return_value=extraction,
                ),
            ):
                result = parse_pending_order_pdfs(mock_db)

        assert result["orders_created"] == 0
        assert not [i for i in self._inserts(mock_db) if "order_type" in i]

    def test_production_extraction_keeps_line_item_flow(self):
        mock_db = self._mock_db()
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 42, "action": "inserted"}]
        )
        extraction = {**self._REPAIR_EXTRACTION, "order_type": "production"}

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
            result, _ = self._run_text_pdf(mock_db, extraction)

        assert result["orders_created"] == 2
        assert not [i for i in self._inserts(mock_db) if "order_type" in i]

    def test_image_pdf_repair_marks_success_image(self):
        mock_db = self._mock_db()

        with (
            patch(
                "app.services.pdf_order_parsing_service.download_attachment",
                return_value=b"%PDF-fax",
            ),
            patch(
                "app.services.pdf_order_parsing_service.extract_text",
                return_value=PdfTextResult(text=None, failure_reason="failed_image"),
            ),
            patch(
                "app.services.pdf_order_parsing_service.extract_order_lines_from_pdf",
                return_value={**self._REPAIR_EXTRACTION, "issuer_company_name": None},
            ),
        ):
            result = parse_pending_order_pdfs(mock_db)

        assert result == {"processed": 1, "orders_created": 1, "errors": 0}
        inserts = self._inserts(mock_db)
        (repair_insert,) = [i for i in inserts if "order_type" in i]
        assert repair_insert["customer_order_no"] == "R-0001"
        (attachment_insert,) = [i for i in inserts if "order_id" in i]
        assert attachment_insert["parse_status"] == "success_image"
        assert [i["reason"] for i in inserts if "reason" in i] == ["image_extracted"]


@pytest.mark.unit
class TestEmbeddedCodeFallback:
    """品名に埋もれた品番での照合を最後の手段として使う（Issue #599）。"""

    _LINE = {
        "product_name_raw": "TEST01ﾌｨﾙﾀｰ QX5501A φ10.0×10L",
        "product_number_raw": None,
        "quantity": 2000,
        "delivery_date": "2026-10-21",
        "certainty": "confirmed",
    }

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

    def test_embedded_code_is_used_when_other_matching_fails(
        self, _no_embedded_code_match
    ):
        mock_db = MagicMock()
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 42, "action": "skipped_downgrade"}]
        )
        _no_embedded_code_match.return_value = 321

        with patch(
            "app.services.pdf_order_parsing_service.match_products",
            return_value={"product_id": None, "candidates": []},
        ):
            created = _process_line_item(mock_db, self._staging_row(), self._LINE)

        assert created is False
        assert _no_embedded_code_match.call_args.args == (
            mock_db,
            "tenant-1",
            7,
            ["TEST01ﾌｨﾙﾀｰ QX5501A φ10.0×10L", None],
        )
        # 製品が決まったので、製品付きの既存受注と同じ dedupe キーで RPC に渡る
        rpc_params = mock_db.rpc.call_args_list[-1].args[1]
        assert rpc_params["p_product_id"] == 321
        reasons = [
            c.args[0].get("reason") for c in mock_db.table().insert.call_args_list
        ]
        assert "no_product_match" not in reasons

    def test_not_used_when_code_matches(self, _no_embedded_code_match):
        mock_db = MagicMock()
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 42, "action": "skipped_no_change"}]
        )
        line = {**self._LINE, "product_number_raw": "QX5501A"}

        with patch(
            "app.services.pdf_order_parsing_service.match_product_by_code",
            return_value=321,
        ):
            _process_line_item(mock_db, self._staging_row(), line)

        _no_embedded_code_match.assert_not_called()

    def test_not_used_for_unknown_customer(self, _no_embedded_code_match):
        mock_db = MagicMock()
        mock_db.rpc().execute.return_value = MagicMock(
            data=[{"order_id": 42, "action": "inserted"}]
        )

        with patch(
            "app.services.pdf_order_parsing_service.match_products",
            return_value={"product_id": None, "candidates": []},
        ):
            _process_line_item(mock_db, self._staging_row(customer_id=None), self._LINE)

        _no_embedded_code_match.assert_not_called()


@pytest.mark.unit
class TestPickResentOrderId:
    _CANDIDATES = [
        {"id": 1, "product_id": 10, "quantity": 2000, "deadline_date": "2026-10-21"},
        {"id": 2, "product_id": 11, "quantity": 500, "deadline_date": "2026-10-21"},
    ]

    def test_matches_by_product(self):
        assert _pick_resent_order_id(self._CANDIDATES, 11, 999, "2026-12-01") == 2

    def test_unmatched_product_matches_by_deadline_and_quantity(self):
        assert _pick_resent_order_id(self._CANDIDATES, None, 2000, "2026-10-21") == 1

    def test_unmatched_product_without_deadline_returns_none(self):
        assert _pick_resent_order_id(self._CANDIDATES, None, 2000, None) is None

    def test_split_deliveries_of_same_product_return_none(self):
        # 同じ製品の分納が複数あると、どの受注の再送か決められない
        candidates = [
            {
                "id": 1,
                "product_id": 10,
                "quantity": 1000,
                "deadline_date": "2026-10-21",
            },
            {
                "id": 2,
                "product_id": 10,
                "quantity": 1000,
                "deadline_date": "2026-11-21",
            },
        ]

        assert _pick_resent_order_id(candidates, 10, 1000, "2026-10-21") is None

    def test_different_product_is_not_resend(self):
        assert _pick_resent_order_id(self._CANDIDATES, 99, 2000, "2026-10-21") is None


@pytest.mark.unit
class TestResentDocument:
    """承認依頼以降に進んだ受注の注文書の再送（Issue #599）。"""

    _LINE = {
        "product_name_raw": "TEST01ﾌｨﾙﾀｰ QX5501A φ10.0×10L",
        "product_number_raw": None,
        "quantity": 2000,
        "delivery_date": "2026-10-21",
        "certainty": "confirmed",
    }

    def _staging_row(self, **overrides):
        row = {
            "id": "att-2",
            "tenant_id": "tenant-1",
            "customer_id": 7,
            "source_raw": "本文",
            "storage_path": "tenant-1/inbox/msg-2/order.pdf",
            "original_filename": "order.pdf",
            "content_type": "application/pdf",
            "size_bytes": 1234,
        }
        row.update(overrides)
        return row

    def test_resent_document_is_attached_to_existing_order_without_rpc(
        self, _no_resent_order
    ):
        mock_db = MagicMock()
        _no_resent_order.return_value = 500
        # 既存の受注には、まだこのファイルが添付されていない
        mock_db.table().select().eq().eq().eq().limit().execute.return_value = (
            MagicMock(data=[])
        )

        with patch(
            "app.services.pdf_order_parsing_service.match_products",
            return_value={"product_id": None, "candidates": []},
        ):
            created = _process_line_item(
                mock_db,
                self._staging_row(),
                self._LINE,
                document_order_no="PO-1",
                attachment_parse_status="success_image",
            )

        assert created is False
        mock_db.rpc.assert_not_called()
        assert _no_resent_order.call_args.args == (
            mock_db,
            "tenant-1",
            7,
            "PO-1",
            None,
            2000,
            "2026-10-21",
        )

        inserts = [c.args[0] for c in mock_db.table().insert.call_args_list]
        attachment = inserts[0]
        assert attachment["order_id"] == 500
        assert attachment["storage_path"] == "tenant-1/inbox/msg-2/order.pdf"
        assert attachment["parse_status"] == "success_image"
        log = inserts[1]
        assert log["reason"] == "resent_document"
        assert log["order_attachment_id"] == "att-2"
        assert log["detail"]["order_id"] == 500
        # 正常な運用なので、照合失敗・その他の通知は出さない
        assert len(inserts) == 2

    def test_already_attached_file_is_not_attached_twice(self, _no_resent_order):
        mock_db = MagicMock()
        _no_resent_order.return_value = 500
        mock_db.table().select().eq().eq().eq().limit().execute.return_value = (
            MagicMock(data=[{"id": "existing-attachment"}])
        )

        _process_line_item(
            mock_db, self._staging_row(), self._LINE, document_order_no="PO-1"
        )

        inserts = [c.args[0] for c in mock_db.table().insert.call_args_list]
        assert [i.get("reason") for i in inserts] == ["resent_document"]

    def test_body_line_without_attachment_only_logs(self, _no_resent_order):
        mock_db = MagicMock()
        _no_resent_order.return_value = 500

        _process_line_item(
            mock_db,
            self._staging_row(storage_path=""),
            self._LINE,
            document_order_no="PO-1",
        )

        inserts = [c.args[0] for c in mock_db.table().insert.call_args_list]
        assert [i.get("reason") for i in inserts] == ["resent_document"]

    def test_find_queries_protected_orders_with_same_order_no(self):
        mock_db = MagicMock()
        query = mock_db.table().select().eq().eq().eq().eq().in_()
        query.execute.return_value = MagicMock(
            data=[
                {
                    "id": 500,
                    "product_id": 10,
                    "quantity": 2000,
                    "deadline_date": "2026-10-21",
                }
            ]
        )

        result = _find_resent_order_id(
            mock_db, "tenant-1", 7, "PO-1", 10, 2000, "2026-10-21"
        )

        assert result == 500
        status_filter = mock_db.table().select().eq().eq().eq().eq().in_.call_args
        assert status_filter.args[0] == "status"
        # 下書きは対象外（数量改定・確度昇格は RPC に任せる）
        assert "draft" not in status_filter.args[1]
        assert "in_progress" in status_filter.args[1]

    @pytest.mark.parametrize(
        ("customer_id", "order_no"), [(None, "PO-1"), (7, None), (7, "")]
    )
    def test_find_without_customer_or_order_no_skips_query(self, customer_id, order_no):
        mock_db = MagicMock()

        result = _find_resent_order_id(
            mock_db, "tenant-1", customer_id, order_no, 10, 2000, "2026-10-21"
        )

        assert result is None
        mock_db.table.assert_not_called()
