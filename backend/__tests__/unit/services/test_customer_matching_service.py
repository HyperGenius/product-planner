from unittest.mock import MagicMock

import pytest
from app.services.customer_matching_service import (
    extract_body_email_candidates,
    extract_customer_name,
    extract_effective_sender_email,
    extract_email_address,
    extract_fax_numbers,
    extract_sender_email,
    extract_sender_email_candidates,
    match_customer_by_pdf_text,
    normalize_fax_number,
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
class TestExtractBodyEmailCandidates:
    # メーラーの転送機能を介さず直接転送された場合の本文例（Issue #298）。
    # "From:"/"差出人:" ヘッダー行が存在しないため、署名欄のメールアドレスの
    # みが手がかりになる。
    _DIRECT_FORWARD_BODY = """\
カブトギ工業
兜木社長

いつもお世話になっております。


8月度(8/3分)の63Cの注文書を送付致します。
ご対応の程お願い致します。

---------------------------------------------------
株式会社 飯野製作所
購買課　　岡部宏美

〒329-1574
栃木県矢板市乙畑1855番地
TEL：0287-48-2221
FAX：0287-48-2223
e-mail: hiromi_okabe@iinoseisakusho.co.jp<mailto:hiromi_okabe@iinoseisakusho.co.jp>
---------------------------------------------------
"""

    def test_extracts_email_without_header_line(self):
        assert extract_body_email_candidates(self._DIRECT_FORWARD_BODY) == [
            "hiromi_okabe@iinoseisakusho.co.jp"
        ]

    def test_returns_empty_list_when_no_email_present(self):
        assert extract_body_email_candidates("こんにちは、注文をお願いします。") == []


@pytest.mark.unit
class TestExtractEmailAddress:
    def test_extracts_email_from_header_value_with_display_name(self):
        assert (
            extract_email_address("顧客太郎 <customer@example.com>")
            == "customer@example.com"
        )

    def test_extracts_bare_email_address(self):
        assert extract_email_address("customer@example.com") == "customer@example.com"

    def test_returns_none_when_no_email_present(self):
        assert extract_email_address("表示名のみ") is None


@pytest.mark.unit
class TestExtractEffectiveSenderEmail:
    def test_prefers_header_email_when_present(self):
        body = "From: taro@example.com\n本文\ncontact@signature.example.com\n"
        assert extract_effective_sender_email(body) == "taro@example.com"

    def test_falls_back_to_body_email_when_no_header(self):
        body = "本文中に署名 contact@signature.example.com があるのみ"
        assert extract_effective_sender_email(body) == "contact@signature.example.com"

    def test_returns_none_when_no_email_anywhere(self):
        assert extract_effective_sender_email("メールアドレスなし") is None

    def test_prefers_real_from_email_over_body_when_no_header(self):
        # Issue #311: 転送ヘッダーが本文に無い場合、実際のGmail Fromヘッダーの方が
        # 本文中の署名メールアドレスより信頼できるため優先する。
        body = "本文中に署名 contact@signature.example.com があるのみ"
        assert (
            extract_effective_sender_email(body, "real-sender@example.com")
            == "real-sender@example.com"
        )

    def test_header_email_still_wins_over_real_from_email(self):
        body = "From: taro@example.com\n本文\n"
        assert (
            extract_effective_sender_email(body, "real-sender@example.com")
            == "taro@example.com"
        )


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

    def test_direct_forward_without_header_uses_body_signature_name_hint(self):
        # Issue #298: 直接転送形式ではヘッダー行が本文化されないため、本文全体
        # からのフォールバック抽出で署名ブロックの会社名を使えることを確認する。
        mock_db = MagicMock()
        mock_db.table().select().eq().in_().execute.return_value = MagicMock(data=[])
        mock_db.table().select().eq().eq().limit().execute.return_value = MagicMock(
            data=[]
        )
        mock_db.table().insert().execute.return_value = MagicMock(data=[{"id": 7}])
        body = (
            "カブトギ工業\n"
            "兜木社長\n"
            "\n"
            "いつもお世話になっております。\n"
            "\n"
            "8月度(8/3分)の63Cの注文書を送付致します。\n"
            "ご対応の程お願い致します。\n"
            "\n"
            "---------------------------------------------------\n"
            "株式会社 飯野製作所\n"
            "購買課　　岡部宏美\n"
            "\n"
            "〒329-1574\n"
            "栃木県矢板市乙畑1855番地\n"
            "TEL：0287-48-2221\n"
            "FAX：0287-48-2223\n"
            "e-mail: hiromi_okabe@iinoseisakusho.co.jp"
            "<mailto:hiromi_okabe@iinoseisakusho.co.jp>\n"
            "---------------------------------------------------\n"
        )

        customer_id, created_draft = resolve_or_create_customer(
            mock_db, "tenant-1", body
        )

        assert customer_id == 7
        assert created_draft is True
        inserted_row = mock_db.table().insert.call_args.args[0]
        assert inserted_row["email"] == "hiromi_okabe@iinoseisakusho.co.jp"
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

    def test_placeholder_name_uses_jst_not_utc(self):
        """Gmail internalDate（UTC epoch millis）はJSTに変換した上で
        プレースホルダー顧客名に埋め込むこと（表示がJSTのユーザー向けのため）。"""
        mock_db = MagicMock()
        mock_db.table().insert().execute.return_value = MagicMock(data=[{"id": 6}])

        # 1751511600000ms = 2025-07-03 03:00 UTC = 2025-07-03 12:00 JST
        resolve_or_create_customer(
            mock_db, "tenant-1", "こんにちは、注文をお願いします。", "1751511600000"
        )

        inserted_row = mock_db.table().insert.call_args.args[0]
        assert inserted_row["name"] == "不明な顧客 (2025-07-03 12:00)"

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


@pytest.mark.unit
class TestResolveOrCreateCustomerRealFromPriority:
    """Issue #311: 転送ヘッダーが本文に無いメールは、実際のGmail Fromヘッダーと
    顧客マスタのメールアドレスとの突合を最優先で行うことを確認する。"""

    def test_real_from_email_matches_existing_customer_without_body_parsing(self):
        mock_db = MagicMock()
        mock_db.table().select().eq().eq().limit().execute.return_value = MagicMock(
            data=[{"id": 99}]
        )
        body = "こんにちは、注文をお願いします。"  # 転送ヘッダー無し・本文中にメールアドレスも無い

        customer_id, created_draft = resolve_or_create_customer(
            mock_db, "tenant-1", body, real_from_email="customer@example.com"
        )

        assert customer_id == 99
        assert created_draft is False
        # 実Fromヘッダーで一致確定した場合、本文全体からの積集合突合は行われない
        mock_db.table().select().eq().in_().execute.assert_not_called()
        mock_db.table().insert.assert_not_called()

    def test_forwarded_header_present_ignores_real_from_email(self):
        # 本文に転送ヘッダーがある場合は、実Fromヘッダーより従来の本文解析を優先する
        mock_db = MagicMock()
        mock_db.table().select().eq().in_().execute.return_value = MagicMock(
            data=[{"id": 1}]
        )
        body = "From: known@example.com\n"

        customer_id, created_draft = resolve_or_create_customer(
            mock_db,
            "tenant-1",
            body,
            real_from_email="someone-else@example.com",
        )

        assert customer_id == 1
        assert created_draft is False
        # 実Fromヘッダーでの単独突合は行われない（転送ヘッダーがあるため）
        mock_db.table().select().eq().eq().limit().execute.assert_not_called()

    def test_real_from_email_no_match_falls_back_to_body_wide_candidate_match(self):
        # Issue #298 の直接転送フォールバック（本文全体からのメールアドレス抽出）は、
        # 実Fromヘッダーが顧客マスタと一致しなかった場合も引き続き機能すること
        mock_db = MagicMock()
        mock_db.table().select().eq().eq().limit().execute.return_value = MagicMock(
            data=[]
        )
        mock_db.table().select().eq().in_().execute.return_value = MagicMock(
            data=[{"id": 50}]
        )
        body = (
            "いつもお世話になっております。\n"
            "---------------------------------------------------\n"
            "株式会社 飯野製作所\n"
            "購買課　　岡部宏美\n"
            "e-mail: hiromi_okabe@iinoseisakusho.co.jp\n"
            "---------------------------------------------------\n"
        )

        customer_id, created_draft = resolve_or_create_customer(
            mock_db,
            "tenant-1",
            body,
            real_from_email="internal-forwarder@company.example.com",
        )

        assert customer_id == 50
        assert created_draft is False
        mock_db.table().insert.assert_not_called()

    def test_real_from_email_used_as_creation_email_when_nothing_matches(self):
        mock_db = MagicMock()
        mock_db.table().select().eq().eq().limit().execute.return_value = MagicMock(
            data=[]
        )
        mock_db.table().insert().execute.return_value = MagicMock(data=[{"id": 8}])
        body = "こんにちは、注文をお願いします。"  # 転送ヘッダー無し・本文中にメールアドレスも無い

        customer_id, created_draft = resolve_or_create_customer(
            mock_db, "tenant-1", body, real_from_email="new-customer@example.com"
        )

        assert customer_id == 8
        assert created_draft is True
        inserted_row = mock_db.table().insert.call_args.args[0]
        assert inserted_row["email"] == "new-customer@example.com"
        assert inserted_row["name"] == "new-customer@example.com"

    def test_body_candidate_preferred_over_real_from_email_for_draft_creation(self):
        # 直接転送（Issue #298）では実Fromヘッダーが社内担当者のアドレスになるため、
        # 本文から候補が取れている場合はそちらを優先し、実Fromヘッダーで下書きを
        # 作成してしまわないこと（レビュー指摘の回帰テスト）
        mock_db = MagicMock()
        mock_db.table().select().eq().eq().limit().execute.return_value = MagicMock(
            data=[]
        )
        mock_db.table().select().eq().in_().execute.return_value = MagicMock(data=[])
        mock_db.table().insert().execute.return_value = MagicMock(data=[{"id": 9}])
        body = "ご注文をお願いします。\n署名: signature@customer.example.com\n"

        customer_id, created_draft = resolve_or_create_customer(
            mock_db,
            "tenant-1",
            body,
            real_from_email="internal-forwarder@company.example.com",
        )

        assert customer_id == 9
        assert created_draft is True
        inserted_row = mock_db.table().insert.call_args.args[0]
        assert inserted_row["email"] == "signature@customer.example.com"


@pytest.mark.unit
class TestMatchCustomerByPdfText:
    def _mock_db(self, customers):
        mock_db = MagicMock()
        mock_db.table().select().eq().execute.return_value = MagicMock(data=customers)
        return mock_db

    def test_resolves_unique_customer_by_name_substring(self):
        mock_db = self._mock_db(
            [
                {"id": 10, "name": "株式会社ABC製作所", "alias": None},
                {"id": 11, "name": "有限会社XYZ工業", "alias": None},
            ]
        )
        pdf_text = "注文書\n発注元: ABC製作所\n御中: 当社\n品番 A-1 数量 5"

        assert match_customer_by_pdf_text(mock_db, "tenant-1", pdf_text) == 10

    def test_resolves_via_alias(self):
        mock_db = self._mock_db(
            [{"id": 20, "name": "オオモリ精密株式会社", "alias": "大森精密"}]
        )

        assert (
            match_customer_by_pdf_text(mock_db, "tenant-1", "大森精密からの注文書")
            == 20
        )

    def test_returns_none_when_no_customer_matches(self):
        mock_db = self._mock_db([{"id": 30, "name": "無関係株式会社", "alias": None}])

        assert (
            match_customer_by_pdf_text(mock_db, "tenant-1", "ABC製作所からの注文書")
            is None
        )

    def test_returns_none_when_multiple_customers_match(self):
        mock_db = self._mock_db(
            [
                {"id": 40, "name": "ABC製作所", "alias": None},
                {"id": 41, "name": "XYZ工業", "alias": None},
            ]
        )
        pdf_text = "ABC製作所 と XYZ工業 の連名注文書"

        assert match_customer_by_pdf_text(mock_db, "tenant-1", pdf_text) is None

    def test_ignores_corp_affixes_and_whitespace_in_matching(self):
        mock_db = self._mock_db(
            [{"id": 50, "name": "  株式会社 ＡＢＣ  製作所 ", "alias": None}]
        )

        assert (
            match_customer_by_pdf_text(mock_db, "tenant-1", "（株）ＡＢＣ製作所　御中")
            == 50
        )

    def test_matches_across_fullwidth_halfwidth_difference(self):
        # DB は半角、PDF抽出テキストは全角（またはその逆）でも NFKC 正規化で一致する
        mock_db = self._mock_db([{"id": 51, "name": "ABC工業 123", "alias": None}])

        assert (
            match_customer_by_pdf_text(mock_db, "tenant-1", "ＡＢＣ工業　１２３ 御中")
            == 51
        )

    def test_returns_none_for_empty_or_none_text(self):
        mock_db = self._mock_db([{"id": 60, "name": "ABC製作所", "alias": None}])

        assert match_customer_by_pdf_text(mock_db, "tenant-1", None) is None
        assert match_customer_by_pdf_text(mock_db, "tenant-1", "   ") is None

    def test_ignores_too_short_customer_names(self):
        # 正規化後2文字以下の会社名は誤マッチしやすいため突合対象外
        mock_db = self._mock_db([{"id": 70, "name": "AB", "alias": None}])

        assert (
            match_customer_by_pdf_text(mock_db, "tenant-1", "ABさんからの注文") is None
        )

    def test_scopes_query_by_tenant_id(self):
        mock_db = self._mock_db([])

        match_customer_by_pdf_text(mock_db, "tenant-xyz", "何らかのテキスト")

        mock_db.table().select().eq.assert_any_call("tenant_id", "tenant-xyz")


_INTERNAL = frozenset({"president@example.com"})


@pytest.mark.unit
class TestResolveOrCreateCustomerInternalSender:
    """Issue #521: 社内転送者（社長など）からのメールは、差出人で顧客を突合・作成しない。"""

    def test_bodyless_mail_from_internal_sender_leaves_customer_unresolved(self):
        mock_db = MagicMock()

        customer_id, created_draft = resolve_or_create_customer(
            mock_db,
            "tenant-1",
            "",
            real_from_email="President@Example.com",
            internal_senders=_INTERNAL,
        )

        assert customer_id is None
        assert created_draft is False
        # 差出人での突合も下書き顧客の作成もしない
        mock_db.table().select().eq().eq().limit().execute.assert_not_called()
        mock_db.table().insert.assert_not_called()

    def test_forwarded_header_from_internal_sender_still_resolves_customer(self):
        # 社長が通常の転送機能で転送した場合は、従来どおり本文の転送ヘッダーで決める
        mock_db = MagicMock()
        mock_db.table().select().eq().in_().execute.return_value = MagicMock(
            data=[{"id": 1}]
        )

        customer_id, created_draft = resolve_or_create_customer(
            mock_db,
            "tenant-1",
            "From: buyer@customer.example.com\n注文します",
            real_from_email="president@example.com",
            internal_senders=_INTERNAL,
        )

        assert customer_id == 1
        assert created_draft is False

    def test_internal_sender_signature_is_not_used_as_customer_candidate(self):
        # 本文に社長自身の署名しか無ければ、社長のアドレスで下書き顧客を作らない
        mock_db = MagicMock()

        customer_id, created_draft = resolve_or_create_customer(
            mock_db,
            "tenant-1",
            "よろしくお願いします\n----------\n社長\npresident@example.com",
            real_from_email="president@example.com",
            internal_senders=_INTERNAL,
        )

        assert customer_id is None
        assert created_draft is False
        mock_db.table().insert.assert_not_called()

    def test_non_internal_sender_keeps_existing_behavior(self):
        mock_db = MagicMock()
        mock_db.table().select().eq().eq().limit().execute.return_value = MagicMock(
            data=[{"id": 99}]
        )

        customer_id, _ = resolve_or_create_customer(
            mock_db,
            "tenant-1",
            "",
            real_from_email="customer@example.com",
            internal_senders=_INTERNAL,
        )

        assert customer_id == 99

    def test_effective_sender_email_skips_internal_sender(self):
        assert (
            extract_effective_sender_email(
                "", "president@example.com", internal_senders=_INTERNAL
            )
            is None
        )
        assert (
            extract_effective_sender_email(
                "署名 buyer@customer.example.com",
                "president@example.com",
                internal_senders=_INTERNAL,
            )
            == "buyer@customer.example.com"
        )


@pytest.mark.unit
class TestFaxNumbers:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("03-1234-5678", "0312345678"),
            ("（０３）１２３４－５６７８", "0312345678"),
            ("0120-123-456", "0120123456"),
            ("090-1234-5678", "09012345678"),
            ("1234-5678", None),
            ("", None),
        ],
    )
    def test_normalize_fax_number(self, value, expected):
        assert normalize_fax_number(value) == expected

    def test_extracts_only_fax_labeled_numbers(self):
        text = (
            "サンプル工業株式会社 TEL 03-1111-2222 FAX 03-1234-5678\n"
            "ＦＡＸ：（０６）６１２３－４５６７\n"
            "2026年10月10日"
        )
        assert extract_fax_numbers(text) == {"0312345678", "0661234567"}

    def test_does_not_join_digits_across_lines_or_dates(self):
        assert extract_fax_numbers("FAX 03-1234-5678\n2026/10/10") == {"0312345678"}
        assert extract_fax_numbers("FAX:0312345678 2026/10/10") == {"0312345678"}

    def test_returns_empty_for_none(self):
        assert extract_fax_numbers(None) == set()


@pytest.mark.unit
class TestMatchCustomerByFaxNumber:
    """Issue #521: 会社名に加え、FAX 番号（customers.fax_number）でも顧客を照合する。"""

    def _mock_db(self, customers):
        mock_db = MagicMock()
        mock_db.table().select().eq().execute.return_value = MagicMock(data=customers)
        return mock_db

    def test_resolves_by_fax_number_in_text(self):
        mock_db = self._mock_db(
            [
                {
                    "id": 10,
                    "name": "株式会社ABC製作所",
                    "alias": None,
                    "fax_number": "03-1234-5678",
                },
                {
                    "id": 11,
                    "name": "有限会社XYZ工業",
                    "alias": None,
                    "fax_number": "06-6123-4567",
                },
            ]
        )
        # 会社名は載っていない（ロゴ画像等）が FAX 番号の見出しはある
        text = "注文書\nFAX (03)1234-5678\n宛先 当社 FAX 045-000-0000"

        assert match_customer_by_pdf_text(mock_db, "tenant-1", text) == 10

    def test_resolves_by_passed_fax_number(self):
        # 画像PDFでモデルに読み取らせた送信元の番号を渡す
        mock_db = self._mock_db(
            [
                {
                    "id": 20,
                    "name": "株式会社ABC製作所",
                    "alias": None,
                    "fax_number": "0312345678",
                }
            ]
        )

        assert (
            match_customer_by_pdf_text(mock_db, "tenant-1", None, ["03-1234-5678"])
            == 20
        )

    def test_fax_number_disambiguates_multiple_name_matches(self):
        mock_db = self._mock_db(
            [
                {"id": 40, "name": "ABC製作所", "alias": None, "fax_number": None},
                {
                    "id": 41,
                    "name": "XYZ工業",
                    "alias": None,
                    "fax_number": "03-1234-5678",
                },
            ]
        )
        text = "ABC製作所 と XYZ工業 の連名注文書 FAX 03-1234-5678"

        assert match_customer_by_pdf_text(mock_db, "tenant-1", text) == 41

    def test_conflicting_name_and_fax_matches_are_not_resolved(self):
        mock_db = self._mock_db(
            [
                {"id": 50, "name": "ABC製作所", "alias": None, "fax_number": None},
                {
                    "id": 51,
                    "name": "無関係株式会社",
                    "alias": None,
                    "fax_number": "03-1234-5678",
                },
            ]
        )

        assert (
            match_customer_by_pdf_text(
                mock_db, "tenant-1", "ABC製作所", ["03-1234-5678"]
            )
            is None
        )

    def test_name_match_wins_when_fax_is_ambiguous(self):
        mock_db = self._mock_db(
            [
                {
                    "id": 60,
                    "name": "ABC製作所",
                    "alias": None,
                    "fax_number": "03-1234-5678",
                },
                {
                    "id": 61,
                    "name": "ABC製作所 第二工場",
                    "alias": "別名工場",
                    "fax_number": "03-1234-5678",
                },
            ]
        )
        # 2社が同じ FAX 番号（判定不能）でも、会社名で一意なら会社名で決める
        assert (
            match_customer_by_pdf_text(
                mock_db, "tenant-1", "株式会社ABC製作所", ["03-1234-5678"]
            )
            == 60
        )
