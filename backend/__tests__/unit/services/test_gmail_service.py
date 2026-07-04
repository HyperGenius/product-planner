from unittest.mock import MagicMock, patch

import pytest
from app.services.gmail_service import _process_message, poll_unread_emails


@pytest.mark.unit
class TestPollUnreadEmails:
    def _set_required_env(self, monkeypatch):
        monkeypatch.setenv("GMAIL_CLIENT_ID", "client-id")
        monkeypatch.setenv("GMAIL_CLIENT_SECRET", "client-secret")
        monkeypatch.setenv("GMAIL_REFRESH_TOKEN", "refresh-token")

    def test_no_pending_labels_returns_zero(self, monkeypatch):
        self._set_required_env(monkeypatch)

        mock_service = MagicMock()
        mock_service.users().labels().list().execute.return_value = {"labels": []}

        with patch(
            "app.services.gmail_service._build_gmail_client", return_value=mock_service
        ):
            result = poll_unread_emails(MagicMock())

        assert result == {"processed": 0, "errors": 0}

    def test_messages_processed_and_count_returned(self, monkeypatch):
        self._set_required_env(monkeypatch)

        mock_service = MagicMock()
        mock_service.users().labels().list().execute.return_value = {
            "labels": [
                {"name": "pp-pending/tenantA", "id": "label-1"},
            ]
        }
        mock_service.users().messages().list().execute.return_value = {
            "messages": [{"id": "aaa"}, {"id": "bbb"}]
        }

        mock_db = MagicMock()
        with (
            patch(
                "app.services.gmail_service._build_gmail_client",
                return_value=mock_service,
            ),
            patch("app.services.gmail_service._process_message") as mock_process,
        ):
            result = poll_unread_emails(mock_db)

        assert result["processed"] == 2
        assert result["errors"] == 0
        assert mock_process.call_count == 2

    def test_missing_env_vars_raise_value_error(self, monkeypatch):
        monkeypatch.delenv("GMAIL_CLIENT_ID", raising=False)
        monkeypatch.delenv("GMAIL_CLIENT_SECRET", raising=False)
        monkeypatch.delenv("GMAIL_REFRESH_TOKEN", raising=False)

        with pytest.raises(ValueError, match="Missing Gmail OAuth env vars"):
            poll_unread_emails(MagicMock())

    def test_processing_error_increments_error_count(self, monkeypatch):
        self._set_required_env(monkeypatch)

        mock_service = MagicMock()
        mock_service.users().labels().list().execute.return_value = {
            "labels": [
                {"name": "pp-pending/tenantA", "id": "label-1"},
            ]
        }
        mock_service.users().messages().list().execute.return_value = {
            "messages": [{"id": "aaa"}]
        }

        mock_db = MagicMock()
        with (
            patch(
                "app.services.gmail_service._build_gmail_client",
                return_value=mock_service,
            ),
            patch(
                "app.services.gmail_service._process_message",
                side_effect=Exception("processing failed"),
            ),
        ):
            result = poll_unread_emails(mock_db)

        assert result["processed"] == 0
        assert result["errors"] == 1


@pytest.mark.unit
class TestProcessMessagePdfStaging:
    """PDF添付メールのステージング保存分岐 (Issue #248) の単体テスト。"""

    def _mock_gmail_service(self):
        mock_service = MagicMock()
        mock_service.users().messages().get().execute.return_value = {
            "payload": {"parts": []},
            "internalDate": "1751500000000",
        }
        return mock_service

    def test_pdf_attachment_stages_without_creating_order(self):
        mock_service = self._mock_gmail_service()
        mock_db = MagicMock()

        with (
            patch(
                "app.services.gmail_service._lookup_tenant_id",
                return_value="tenant-1",
            ),
            patch(
                "app.services.gmail_service._get_attachments",
                return_value=[
                    {
                        "filename": "order.pdf",
                        "content_type": "application/pdf",
                        "data": b"%PDF-1.4",
                    }
                ],
            ),
            patch(
                "app.services.gmail_service.extract_sender_email",
                return_value="customer@example.com",
            ),
            patch(
                "app.services.gmail_service.resolve_or_create_customer",
                return_value=(42, False),
            ) as mock_resolve_customer,
            patch(
                "app.services.gmail_service.upload_staged_attachment",
                return_value="tenant-1/inbox/msg-1/abc.pdf",
            ) as mock_upload_staged,
            patch("app.services.gmail_service.extract_email_fields") as mock_extract,
        ):
            _process_message(mock_service, mock_db, "msg-1", "tenantA", {})

        # Claudeによる単一フィールド抽出は呼ばれない（後続Issueに置き換わるため）
        mock_extract.assert_not_called()

        # orders テーブルへの INSERT は発生しない
        assert not any(
            call.args and call.args[0] == "orders"
            for call in mock_db.table.call_args_list
        )

        mock_upload_staged.assert_called_once_with(
            mock_db, "tenant-1", "msg-1", "order.pdf", b"%PDF-1.4", "application/pdf"
        )
        mock_resolve_customer.assert_called_once_with(
            mock_db, "tenant-1", "customer@example.com", "1751500000000"
        )

        inserted_row = mock_db.table("order_attachments").insert.call_args.args[0]
        assert inserted_row["order_id"] is None
        assert inserted_row["tenant_id"] == "tenant-1"
        assert inserted_row["customer_id"] == 42
        assert inserted_row["gmail_message_id"] == "msg-1"
        assert inserted_row["storage_path"] == "tenant-1/inbox/msg-1/abc.pdf"
        assert inserted_row["parse_status"] == "pending"

    def test_non_pdf_attachment_keeps_existing_immediate_order_flow(self):
        mock_service = self._mock_gmail_service()
        mock_db = MagicMock()
        mock_db.table("orders").insert().execute.return_value = MagicMock(
            data=[{"id": 99}]
        )

        with (
            patch(
                "app.services.gmail_service._lookup_tenant_id",
                return_value="tenant-1",
            ),
            patch(
                "app.services.gmail_service._get_attachments",
                return_value=[
                    {
                        "filename": "memo.txt",
                        "content_type": "text/plain",
                        "data": b"hello",
                    }
                ],
            ),
            patch(
                "app.services.gmail_service.extract_email_fields",
                return_value={
                    "product_name": "製品A",
                    "quantity": "<UNKNOWN>",
                    "deadline_date": "<UNKNOWN>",
                    "order_number": "<UNKNOWN>",
                },
            ),
            patch("app.services.gmail_service.extract_sender_email", return_value=None),
            patch(
                "app.services.gmail_service.match_products",
                return_value={"product_id": None, "candidates": []},
            ),
            patch(
                "app.services.gmail_service.resolve_or_create_customer",
                return_value=(7, True),
            ) as mock_resolve_customer,
            patch(
                "app.services.gmail_service.upload_attachment",
                return_value="tenant-1/orders/99/def.txt",
            ) as mock_upload,
            patch(
                "app.services.gmail_service.upload_staged_attachment"
            ) as mock_upload_staged,
        ):
            _process_message(mock_service, mock_db, "msg-2", "tenantA", {})

        # 既存フロー: 添付が非PDFなら即時orderが作成され、ステージング保存は呼ばれない
        mock_upload_staged.assert_not_called()
        mock_upload.assert_called_once()

        # メールアドレスが取れない場合も customer_id は必ず設定され、下書き作成の通知が記録される
        mock_resolve_customer.assert_called_once_with(
            mock_db, "tenant-1", None, "1751500000000"
        )
        notif_inserts = [
            call.args[0]
            for call in mock_db.table("notifications").insert.call_args_list
            if call.args and "notif_type" in call.args[0]
        ]
        assert len(notif_inserts) == 1
        assert notif_inserts[0]["notif_type"] == "customer_draft_created"
        assert notif_inserts[0]["source_id"] == "msg-2"
        assert notif_inserts[0]["detail"]["customer_id"] == 7
        assert any(
            call.args and call.args[0] == "orders"
            for call in mock_db.table.call_args_list
        )

    def test_no_extracted_fields_skips_order_and_creates_notification(self):
        """本文から注文項目が一切抽出できない場合、orderを作成せず
        non_order_email として通知のみ記録すること（顧客レコードも作成しない）。"""
        mock_service = self._mock_gmail_service()
        mock_db = MagicMock()

        with (
            patch(
                "app.services.gmail_service._lookup_tenant_id",
                return_value="tenant-1",
            ),
            patch(
                "app.services.gmail_service._get_attachments",
                return_value=[],
            ),
            patch(
                "app.services.gmail_service.extract_email_fields",
                return_value={
                    "product_name": "<UNKNOWN>",
                    "quantity": "<UNKNOWN>",
                    "deadline_date": "<UNKNOWN>",
                    "order_number": "<UNKNOWN>",
                },
            ),
            patch(
                "app.services.gmail_service.extract_sender_email",
                return_value="spam@example.com",
            ),
            patch(
                "app.services.gmail_service.resolve_or_create_customer"
            ) as mock_resolve_customer,
            patch("app.services.gmail_service.upload_attachment") as mock_upload,
        ):
            _process_message(mock_service, mock_db, "msg-3", "tenantA", {})

        mock_resolve_customer.assert_not_called()
        mock_upload.assert_not_called()
        assert not any(
            call.args and call.args[0] == "orders"
            for call in mock_db.table.call_args_list
        )

        notif_insert = mock_db.table("notifications").insert.call_args.args[0]
        assert notif_insert["notif_type"] == "non_order_email"
        assert notif_insert["source_table"] == "gmail_message"
        assert notif_insert["source_id"] == "msg-3"
