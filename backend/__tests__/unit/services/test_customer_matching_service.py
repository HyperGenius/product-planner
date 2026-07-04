from unittest.mock import MagicMock

import pytest
from app.services.customer_matching_service import (
    extract_sender_email,
    resolve_or_create_customer,
)


@pytest.mark.unit
class TestExtractSenderEmail:
    def test_extracts_email_from_english_forwarded_header(self):
        body = "---------- Forwarded message ----------\nFrom: Taro Yamada <taro@example.com>\n"
        assert extract_sender_email(body) == "taro@example.com"

    def test_extracts_email_from_japanese_forwarded_header(self):
        body = "差出人: taro@example.com\n宛先: ...\n"
        assert extract_sender_email(body) == "taro@example.com"

    def test_returns_none_when_no_forwarded_header(self):
        assert extract_sender_email("こんにちは、注文をお願いします。") is None


@pytest.mark.unit
class TestResolveOrCreateCustomer:
    def test_existing_customer_found_by_email_is_not_modified(self):
        mock_db = MagicMock()
        mock_db.table().select().eq().eq().limit().execute.return_value = MagicMock(
            data=[{"id": 1}]
        )

        customer_id, created_draft = resolve_or_create_customer(
            mock_db, "tenant-1", "known@example.com"
        )

        assert customer_id == 1
        assert created_draft is False
        # 既存顧客が見つかった場合は insert が呼ばれない（statusは変更しない）
        mock_db.table().insert.assert_not_called()

    def test_new_customer_with_email_is_created_as_draft(self):
        mock_db = MagicMock()
        mock_db.table().select().eq().eq().limit().execute.return_value = MagicMock(
            data=[]
        )
        mock_db.table().insert().execute.return_value = MagicMock(data=[{"id": 2}])

        customer_id, created_draft = resolve_or_create_customer(
            mock_db, "tenant-1", "new@example.com"
        )

        assert customer_id == 2
        assert created_draft is True
        inserted_row = mock_db.table().insert.call_args.args[0]
        assert inserted_row["status"] == "draft"
        assert inserted_row["email"] == "new@example.com"
        assert inserted_row["name"] == "new@example.com"

    def test_no_email_always_creates_draft_with_placeholder_name(self):
        mock_db = MagicMock()
        mock_db.table().insert().execute.return_value = MagicMock(data=[{"id": 3}])

        customer_id, created_draft = resolve_or_create_customer(
            mock_db, "tenant-1", None, "1751511600000"
        )

        assert customer_id == 3
        assert created_draft is True
        # 顧客検索は行われない（email が無いので紐付けようがない）
        mock_db.table().select.assert_not_called()
        inserted_row = mock_db.table().insert.call_args.args[0]
        assert inserted_row["status"] == "draft"
        assert "email" not in inserted_row
        assert inserted_row["name"].startswith("不明な顧客 (")

    def test_no_email_and_no_received_at_falls_back_to_now(self):
        mock_db = MagicMock()
        mock_db.table().insert().execute.return_value = MagicMock(data=[{"id": 4}])

        customer_id, created_draft = resolve_or_create_customer(
            mock_db, "tenant-1", None
        )

        assert customer_id == 4
        assert created_draft is True
        inserted_row = mock_db.table().insert.call_args.args[0]
        assert inserted_row["name"].startswith("不明な顧客 (")

    def test_invalid_received_at_falls_back_to_now(self):
        mock_db = MagicMock()
        mock_db.table().insert().execute.return_value = MagicMock(data=[{"id": 5}])

        customer_id, created_draft = resolve_or_create_customer(
            mock_db, "tenant-1", None, "not-a-timestamp"
        )

        assert customer_id == 5
        assert created_draft is True
        inserted_row = mock_db.table().insert.call_args.args[0]
        assert inserted_row["name"].startswith("不明な顧客 (")
