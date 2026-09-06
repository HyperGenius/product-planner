import base64
from unittest.mock import MagicMock, patch

import pytest
from app.services.gmail_service import (
    _b64url_decode,
    _get_attachments,
    _get_message_body,
    _get_real_from_email,
    _process_message,
    poll_unread_emails,
)


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
class TestB64UrlDecode:
    """固定 "==" 付与だと元データの長さによってはパディングが不足/過剰になりうるため、
    長さに応じて必要な分だけ補うことを確認する回帰テスト。"""

    @pytest.mark.parametrize("length", range(0, 12))
    def test_decodes_correctly_regardless_of_original_length(self, length):
        original = ("x" * length).encode("utf-8")
        encoded = base64.urlsafe_b64encode(original).decode().rstrip("=")
        assert _b64url_decode(encoded) == original


@pytest.mark.unit
class TestGetMessageBody:
    """PDF添付メール（multipart/mixed の中に multipart/alternative がネストする構造）で
    本文が空文字になってしまう不具合の回帰テスト。"""

    @staticmethod
    def _b64(text: str) -> str:
        return base64.urlsafe_b64encode(text.encode("utf-8")).decode().rstrip("=")

    def test_extracts_text_plain_nested_inside_multipart_alternative(self):
        text = "From: taro@example.com\n本文"
        msg = {
            "payload": {
                "mimeType": "multipart/mixed",
                "parts": [
                    {
                        "mimeType": "multipart/alternative",
                        "body": {},
                        "parts": [
                            {
                                "mimeType": "text/plain",
                                "body": {"data": self._b64(text)},
                            },
                            {
                                "mimeType": "text/html",
                                "body": {"data": self._b64("<p>本文</p>")},
                            },
                        ],
                    },
                    {
                        "mimeType": "application/pdf",
                        "filename": "order.pdf",
                        "body": {"attachmentId": "att-1"},
                    },
                ],
            }
        }

        assert _get_message_body(msg) == text

    def test_falls_back_to_text_html_when_no_text_plain_part(self):
        html = "<p>本文のみ</p>"
        msg = {
            "payload": {
                "mimeType": "multipart/mixed",
                "parts": [
                    {
                        "mimeType": "multipart/alternative",
                        "body": {},
                        "parts": [
                            {
                                "mimeType": "text/html",
                                "body": {"data": self._b64(html)},
                            },
                        ],
                    },
                ],
            }
        }

        assert _get_message_body(msg) == html


@pytest.mark.unit
class TestGetAttachments:
    """添付ファイル収集がネストした parts も再帰的に探索することの回帰テスト
    （Issue #384: 転送メールが message/rfc822 として添付される等、添付が
    2階層目以降に現れる構造で1つも取得できない不具合）。"""

    @staticmethod
    def _mock_service(payload_b64: str) -> MagicMock:
        mock_service = MagicMock()
        (mock_service.users().messages().attachments().get().execute.return_value) = {
            "data": payload_b64
        }
        return mock_service

    def test_collects_attachments_nested_below_top_level_parts(self):
        b64 = base64.urlsafe_b64encode(b"%PDF-1.4").decode().rstrip("=")
        payload = {
            "mimeType": "multipart/mixed",
            "parts": [
                {
                    "mimeType": "multipart/alternative",
                    "parts": [
                        {"mimeType": "text/plain", "body": {"data": ""}},
                    ],
                },
                {
                    "mimeType": "application/pdf",
                    "filename": "top_level.pdf",
                    "body": {"attachmentId": "att-top"},
                },
                {
                    "mimeType": "multipart/mixed",
                    "parts": [
                        {
                            "mimeType": "application/pdf",
                            "filename": "nested.pdf",
                            "body": {"attachmentId": "att-nested"},
                        },
                    ],
                },
            ],
        }

        results = _get_attachments(self._mock_service(b64), "msg-1", payload)

        assert [r["filename"] for r in results] == ["top_level.pdf", "nested.pdf"]
        assert all(r["data"] == b"%PDF-1.4" for r in results)

    def test_ignores_parts_without_attachment_id_or_filename(self):
        b64 = base64.urlsafe_b64encode(b"x").decode().rstrip("=")
        payload = {
            "parts": [
                {"mimeType": "text/plain", "body": {"data": "abc"}},
                {"mimeType": "application/pdf", "body": {"attachmentId": "no-name"}},
                {"mimeType": "image/png", "filename": "inline.png", "body": {}},
            ]
        }

        assert _get_attachments(self._mock_service(b64), "msg-1", payload) == []


@pytest.mark.unit
class TestGetRealFromEmail:
    """実際のGmail `From` ヘッダーからメールアドレスを抽出する関数のテスト
    （Issue #311: 転送ヘッダーが本文に無いメールの顧客マッチング精度向上）。"""

    def test_extracts_email_from_from_header(self):
        msg = {
            "payload": {
                "headers": [
                    {"name": "From", "value": "顧客太郎 <customer@example.com>"},
                    {"name": "Subject", "value": "発注のご相談"},
                ]
            }
        }
        assert _get_real_from_email(msg) == "customer@example.com"

    def test_header_name_matching_is_case_insensitive(self):
        msg = {"payload": {"headers": [{"name": "from", "value": "a@example.com"}]}}
        assert _get_real_from_email(msg) == "a@example.com"

    def test_returns_none_when_no_from_header(self):
        msg = {"payload": {"headers": [{"name": "Subject", "value": "件名のみ"}]}}
        assert _get_real_from_email(msg) is None

    def test_returns_none_when_no_headers(self):
        assert _get_real_from_email({"payload": {}}) is None


@pytest.mark.unit
class TestProcessMessagePdfStaging:
    """メール受信時のステージング保存分岐 (Issue #248, #280) の単体テスト。

    実際の抽出・order生成は parse_pending_order_pdfs（cron）が非同期に行うため、
    ここでは _process_message が常に order_attachments へステージング行を
    作成するだけであることを検証する。"""

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
                "app.services.gmail_service.extract_effective_sender_email",
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
        ):
            _process_message(mock_service, mock_db, "msg-1", "tenantA", {})

        # orders テーブルへの INSERT は発生しない（パースは後続の非同期処理）
        assert not any(
            call.args and call.args[0] == "orders"
            for call in mock_db.table.call_args_list
        )

        mock_upload_staged.assert_called_once_with(
            mock_db, "tenant-1", "msg-1", "order.pdf", b"%PDF-1.4", "application/pdf"
        )
        mock_resolve_customer.assert_called_once_with(
            mock_db, "tenant-1", "", "1751500000000", None
        )

        inserted_row = mock_db.table("order_attachments").insert.call_args.args[0]
        assert inserted_row["order_id"] is None
        assert inserted_row["tenant_id"] == "tenant-1"
        assert inserted_row["customer_id"] == 42
        assert inserted_row["gmail_message_id"] == "msg-1"
        assert inserted_row["storage_path"] == "tenant-1/inbox/msg-1/abc.pdf"
        assert inserted_row["parse_status"] == "pending"

    def test_non_pdf_attachment_is_staged_via_same_path_as_pdf(self):
        """非PDF添付メールも、PDF添付メールと同じくステージング保存され、
        即時のorder作成は行われないこと（Issue #280: 1ソース1回保存への統一）。"""
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
                        "filename": "memo.txt",
                        "content_type": "text/plain",
                        "data": b"hello",
                    }
                ],
            ),
            patch(
                "app.services.gmail_service.extract_effective_sender_email",
                return_value=None,
            ),
            patch(
                "app.services.gmail_service.resolve_or_create_customer",
                return_value=(7, True),
            ) as mock_resolve_customer,
            patch(
                "app.services.gmail_service.upload_staged_attachment",
                return_value="tenant-1/inbox/msg-2/def.txt",
            ) as mock_upload_staged,
        ):
            _process_message(mock_service, mock_db, "msg-2", "tenantA", {})

        mock_upload_staged.assert_called_once_with(
            mock_db, "tenant-1", "msg-2", "memo.txt", b"hello", "text/plain"
        )

        # メールアドレスが取れない場合も customer_id は必ず設定され、下書き作成の通知が記録される
        mock_resolve_customer.assert_called_once_with(
            mock_db, "tenant-1", "", "1751500000000", None
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
        assert not any(
            call.args and call.args[0] == "orders"
            for call in mock_db.table.call_args_list
        )

        inserted_row = mock_db.table("order_attachments").insert.call_args.args[0]
        assert inserted_row["order_id"] is None
        assert inserted_row["storage_path"] == "tenant-1/inbox/msg-2/def.txt"
        assert inserted_row["parse_status"] == "pending"

    def test_no_attachment_email_is_staged_with_empty_storage_path(self):
        """添付なしメールも同様にステージング保存され、storage_path は
        空文字で保存されること（parse_pending_order_pdfs 側で本文抽出に回る）。"""
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
                "app.services.gmail_service.extract_effective_sender_email",
                return_value="spam@example.com",
            ),
            patch(
                "app.services.gmail_service.resolve_or_create_customer",
                return_value=(3, False),
            ),
            patch(
                "app.services.gmail_service.upload_staged_attachment"
            ) as mock_upload_staged,
        ):
            _process_message(mock_service, mock_db, "msg-3", "tenantA", {})

        mock_upload_staged.assert_not_called()
        assert not any(
            call.args and call.args[0] == "orders"
            for call in mock_db.table.call_args_list
        )

        inserted_row = mock_db.table("order_attachments").insert.call_args.args[0]
        assert inserted_row["order_id"] is None
        assert inserted_row["storage_path"] == ""
        assert inserted_row["original_filename"] == ""
        assert inserted_row["content_type"] is None
        assert inserted_row["parse_status"] == "pending"

    def test_multiple_pdf_attachments_are_each_staged_as_separate_row(self):
        """複数顧客の注文書PDFを1通にまとめて添付したメールで、PDFごとに
        order_attachments のステージング行が作られること（Issue #384）。"""
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
                        "filename": "customer_a.pdf",
                        "content_type": "application/pdf",
                        "data": b"%PDF-A",
                    },
                    {
                        "filename": "customer_b.pdf",
                        "content_type": "application/pdf",
                        "data": b"%PDF-BB",
                    },
                    {
                        "filename": "customer_c.pdf",
                        "content_type": "application/pdf",
                        "data": b"%PDF-CCC",
                    },
                ],
            ),
            patch(
                "app.services.gmail_service.extract_effective_sender_email",
                return_value="boss@example.com",
            ),
            patch(
                "app.services.gmail_service.resolve_or_create_customer",
                return_value=(42, False),
            ),
            patch(
                "app.services.gmail_service.upload_staged_attachment",
                side_effect=lambda _db, _t, _m, filename, *_a: (
                    f"tenant-1/inbox/msg-1/{filename}"
                ),
            ) as mock_upload_staged,
        ):
            _process_message(mock_service, mock_db, "msg-1", "tenantA", {})

        assert mock_upload_staged.call_count == 3
        inserted_rows = [
            call.args[0]
            for call in mock_db.table("order_attachments").insert.call_args_list
        ]
        assert len(inserted_rows) == 3
        assert {row["storage_path"] for row in inserted_rows} == {
            "tenant-1/inbox/msg-1/customer_a.pdf",
            "tenant-1/inbox/msg-1/customer_b.pdf",
            "tenant-1/inbox/msg-1/customer_c.pdf",
        }
        assert {row["original_filename"] for row in inserted_rows} == {
            "customer_a.pdf",
            "customer_b.pdf",
            "customer_c.pdf",
        }
        assert {row["size_bytes"] for row in inserted_rows} == {6, 7, 8}
        for row in inserted_rows:
            assert row["order_id"] is None
            assert row["customer_id"] == 42
            assert row["gmail_message_id"] == "msg-1"
            assert row["parse_status"] == "pending"

    def test_non_pdf_attachments_are_ignored_when_a_pdf_is_present(self):
        """PDFと非PDFが混在する場合、PDFのみをステージングし非PDFは無視すること
        （Issue #384。従来の「PDFがあれば優先」を複数PDFへ拡張）。"""
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
                        "filename": "note.txt",
                        "content_type": "text/plain",
                        "data": b"hello",
                    },
                    {
                        "filename": "order_1.pdf",
                        "content_type": "application/pdf",
                        "data": b"%PDF-1",
                    },
                    {
                        "filename": "order_2.pdf",
                        "content_type": "application/pdf",
                        "data": b"%PDF-2",
                    },
                ],
            ),
            patch(
                "app.services.gmail_service.extract_effective_sender_email",
                return_value=None,
            ),
            patch(
                "app.services.gmail_service.resolve_or_create_customer",
                return_value=(1, False),
            ),
            patch(
                "app.services.gmail_service.upload_staged_attachment",
                side_effect=lambda _db, _t, _m, filename, *_a: f"path/{filename}",
            ) as mock_upload_staged,
        ):
            _process_message(mock_service, mock_db, "msg-1", "tenantA", {})

        staged_filenames = [c.args[3] for c in mock_upload_staged.call_args_list]
        assert staged_filenames == ["order_1.pdf", "order_2.pdf"]
        inserted_rows = [
            call.args[0]
            for call in mock_db.table("order_attachments").insert.call_args_list
        ]
        assert {row["original_filename"] for row in inserted_rows} == {
            "order_1.pdf",
            "order_2.pdf",
        }

    def test_real_from_header_is_passed_to_customer_matching(self):
        """実際のGmail `From` ヘッダーが resolve_or_create_customer に渡されること
        （Issue #311: 転送ヘッダーが本文に無いメールの顧客マッチング精度向上）。"""
        mock_service = MagicMock()
        mock_service.users().messages().get().execute.return_value = {
            "payload": {
                "parts": [],
                "headers": [
                    {"name": "From", "value": "顧客太郎 <customer@example.com>"},
                ],
            },
            "internalDate": "1751500000000",
        }
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
                "app.services.gmail_service.resolve_or_create_customer",
                return_value=(1, False),
            ) as mock_resolve_customer,
            patch("app.services.gmail_service.upload_staged_attachment"),
        ):
            _process_message(mock_service, mock_db, "msg-4", "tenantA", {})

        mock_resolve_customer.assert_called_once_with(
            mock_db, "tenant-1", "", "1751500000000", "customer@example.com"
        )
