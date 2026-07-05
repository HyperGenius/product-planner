from unittest.mock import MagicMock

import pytest
from app.services.customer_matching_service import (
    extract_customer_name,
    extract_sender_email,
    extract_sender_email_candidates,
    resolve_or_create_customer,
)


@pytest.mark.unit
class TestExtractSenderEmailCandidates:
    def test_returns_all_unique_candidates_in_order(self):
        body = (
            "From: forwarder@internal.example.com\n"
            "Sent: ...\n"
            "\n"
            "-----元のメッセージ-----\n"
            "From: original_sender@customer.example.com\n"
            "Sent: ...\n"
        )
        assert extract_sender_email_candidates(body) == [
            "forwarder@internal.example.com",
            "original_sender@customer.example.com",
        ]

    def test_deduplicates_repeated_candidates(self):
        body = "From: taro@example.com\n...\n差出人: taro@example.com\n"
        assert extract_sender_email_candidates(body) == ["taro@example.com"]

    def test_returns_empty_list_when_no_forwarded_header(self):
        assert extract_sender_email_candidates("こんにちは、注文をお願いします。") == []


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

    def test_multiple_forwarded_headers_uses_the_last_one(self):
        # 多段転送で複数の From: が本文に残っている場合、一番奥（最初にメールを
        # 書いた本人）が実際の顧客であることが多いため、最後の出現を採用する。
        body = (
            "From: forwarder@internal.example.com\n"
            "Sent: ...\n"
            "\n"
            "-----元のメッセージ-----\n"
            "From: original_sender@customer.example.com\n"
            "Sent: ...\n"
        )
        assert extract_sender_email(body) == "original_sender@customer.example.com"


@pytest.mark.unit
class TestExtractCustomerName:
    _FORWARDED_BODY_WITH_SIGNATURE = """\
From: hiromi_okabe@iinoseisakusho.co.jp <hiromi_okabe@iinoseisakusho.co.jp>
Sent: Friday, June 19, 2026 5:50 PM
To: tsy@kabutogi-filter.com
Subject: 7月度内示の件

カブトギ工業
兜木社長

いつもお世話になっております。

7月度の内示を送付致します。
ご確認の程お願い致します。

---------------------------------------------------
株式会社 飯野製作所
グローバル生産管理部
購買課　　岡部宏美

〒329-1574
栃木県矢板市乙畑1855番地
TEL：0287-48-2221
FAX：0287-48-2223
e-mail: hiromi_okabe@iinoseisakusho.co.jp
---------------------------------------------------
"""

    def test_extracts_company_and_person_name_from_signature_block(self):
        email = "hiromi_okabe@iinoseisakusho.co.jp"
        name = extract_customer_name(self._FORWARDED_BODY_WITH_SIGNATURE, email)
        assert name == "株式会社 飯野製作所 岡部宏美"

    def test_returns_none_when_email_not_found_in_body(self):
        assert (
            extract_customer_name("本文に一致するメールがない", "x@example.com") is None
        )

    def test_returns_none_when_no_signature_block_present(self):
        body = "From: taro@example.com\n本文のみで署名なし"
        assert extract_customer_name(body, "taro@example.com") is None


@pytest.mark.unit
class TestResolveOrCreateCustomer:
    def test_single_candidate_intersection_match_is_not_modified(self):
        mock_db = MagicMock()
        mock_db.table().select().eq().in_().execute.return_value = MagicMock(
            data=[{"id": 1}]
        )
        body = "From: known@example.com\n"

        customer_id, created_draft = resolve_or_create_customer(
            mock_db, "tenant-1", body
        )

        assert customer_id == 1
        assert created_draft is False
        # 既存顧客が1件に確定した場合は insert が呼ばれない（statusは変更しない）
        mock_db.table().insert.assert_not_called()

    def test_zero_candidate_intersection_falls_back_and_creates_draft(self):
        mock_db = MagicMock()
        # 候補集合との突合(0件) → 単一メールでの再検索(0件) → 新規作成
        mock_db.table().select().eq().in_().execute.return_value = MagicMock(data=[])
        mock_db.table().select().eq().eq().limit().execute.return_value = MagicMock(
            data=[]
        )
        mock_db.table().insert().execute.return_value = MagicMock(data=[{"id": 2}])
        body = "From: new@example.com\n"

        customer_id, created_draft = resolve_or_create_customer(
            mock_db, "tenant-1", body
        )

        assert customer_id == 2
        assert created_draft is True
        inserted_row = mock_db.table().insert.call_args.args[0]
        assert inserted_row["status"] == "draft"
        assert inserted_row["email"] == "new@example.com"
        assert inserted_row["name"] == "new@example.com"

    def test_zero_candidate_intersection_uses_signature_name_hint(self):
        mock_db = MagicMock()
        mock_db.table().select().eq().in_().execute.return_value = MagicMock(data=[])
        mock_db.table().select().eq().eq().limit().execute.return_value = MagicMock(
            data=[]
        )
        mock_db.table().insert().execute.return_value = MagicMock(data=[{"id": 6}])
        body = (
            "From: hiromi_okabe@iinoseisakusho.co.jp\n"
            "Subject: 7月度内示の件\n"
            "\n"
            "---------------------------------------------------\n"
            "株式会社 飯野製作所\n"
            "グローバル生産管理部\n"
            "購買課　　岡部宏美\n"
            "\n"
            "e-mail: hiromi_okabe@iinoseisakusho.co.jp\n"
            "---------------------------------------------------\n"
        )

        customer_id, created_draft = resolve_or_create_customer(
            mock_db, "tenant-1", body
        )

        assert customer_id == 6
        assert created_draft is True
        inserted_row = mock_db.table().insert.call_args.args[0]
        assert inserted_row["name"] == "株式会社 飯野製作所 岡部宏美"

    def test_ambiguous_candidate_intersection_falls_back_to_last_candidate(self):
        mock_db = MagicMock()
        # 積集合が2件（相見積もり等で判定不能）→ 最後に出現した候補で単一検索にフォールバック
        mock_db.table().select().eq().in_().execute.return_value = MagicMock(
            data=[{"id": 10}, {"id": 11}]
        )
        mock_db.table().select().eq().eq().limit().execute.return_value = MagicMock(
            data=[{"id": 11}]
        )
        body = "From: a@example.com\n...\n差出人: b@example.com\n"

        customer_id, created_draft = resolve_or_create_customer(
            mock_db, "tenant-1", body
        )

        assert customer_id == 11
        assert created_draft is False
        mock_db.table().insert.assert_not_called()

    def test_no_candidates_at_all_creates_draft_with_placeholder_name(self):
        mock_db = MagicMock()
        mock_db.table().insert().execute.return_value = MagicMock(data=[{"id": 3}])

        customer_id, created_draft = resolve_or_create_customer(
            mock_db, "tenant-1", "こんにちは、注文をお願いします。", "1751511600000"
        )

        assert customer_id == 3
        assert created_draft is True
        # 顧客検索は行われない（候補メールアドレスが無いので紐付けようがない）
        mock_db.table().select.assert_not_called()
        inserted_row = mock_db.table().insert.call_args.args[0]
        assert inserted_row["status"] == "draft"
        assert "email" not in inserted_row
        assert inserted_row["name"].startswith("不明な顧客 (")

    def test_no_candidates_and_no_received_at_falls_back_to_now(self):
        mock_db = MagicMock()
        mock_db.table().insert().execute.return_value = MagicMock(data=[{"id": 4}])

        customer_id, created_draft = resolve_or_create_customer(
            mock_db, "tenant-1", "本文のみ"
        )

        assert customer_id == 4
        assert created_draft is True
        inserted_row = mock_db.table().insert.call_args.args[0]
        assert inserted_row["name"].startswith("不明な顧客 (")

    def test_invalid_received_at_falls_back_to_now(self):
        mock_db = MagicMock()
        mock_db.table().insert().execute.return_value = MagicMock(data=[{"id": 5}])

        customer_id, created_draft = resolve_or_create_customer(
            mock_db, "tenant-1", "本文のみ", "not-a-timestamp"
        )

        assert customer_id == 5
        assert created_draft is True
        inserted_row = mock_db.table().insert.call_args.args[0]
        assert inserted_row["name"].startswith("不明な顧客 (")
