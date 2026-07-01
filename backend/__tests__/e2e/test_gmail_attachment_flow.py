"""
E2E テスト: Gmail 添付ファイル保存フロー

事前準備:
  1. Gmail に `pp-pending/{E2E_GMAIL_TENANT_NAME}` ラベルを作成
  2. Supabase の gmail_label_tenants テーブルに対象テナントを登録
  3. .env に必要な環境変数を設定 (conftest.py のドキュメント参照)

実行:
  cd backend && pytest __tests__/e2e/ -v --run-e2e
"""

import time
from typing import Any

import pytest
from app.services.gmail_service import poll_unread_emails


@pytest.mark.e2e
class TestGmailAttachmentFlow:
    """Gmail → Supabase Storage の添付ファイル保存フロー E2E テスト"""

    def test_pdf_attachment_is_staged_without_creating_order(
        self,
        inject_email_with_pdf: dict[str, Any],
        admin_db,
    ) -> None:
        """
        PDF 添付付きメールを受信したとき (Issue #248):
        - orders レコードは作成されない（パース処理は後続Issue）
        - order_attachments にステージング行（order_id=NULL, parse_status='pending'）が作成される
        - Supabase Storage の {tenant_id}/inbox/{gmail_message_id}/ に PDF ファイルが保存される
        """
        run_id = inject_email_with_pdf["run_id"]
        pdf_filename = inject_email_with_pdf["pdf_filename"]
        message_id = inject_email_with_pdf["message_id"]

        # Gmail ポーリングを実行
        result = poll_unread_emails(admin_db)
        assert result["errors"] == 0, f"poll_unread_emails returned errors: {result}"
        assert result["processed"] >= 1

        # Gmail の処理完了を少し待つ（ラベル移動が非同期のため）
        time.sleep(1)

        # --- orders レコードが作成されないことの検証 ---
        order_result = (
            admin_db.table("orders")
            .select("id")
            .like("source_raw", f"%run_id={run_id}%")
            .execute()
        )
        assert not (order_result.data or []), (
            f"Expected no order to be created for PDF attachment email, "
            f"got {order_result.data}"
        )

        # --- order_attachments ステージング行の検証 ---
        att_result = (
            admin_db.table("order_attachments")
            .select("*")
            .is_("order_id", "null")
            .like("source_raw", f"%run_id={run_id}%")
            .execute()
        )
        attachments = att_result.data or []
        assert len(attachments) == 1, (
            f"Expected 1 staged order_attachment, got {len(attachments)}. "
            f"run_id={run_id}"
        )
        attachment = attachments[0]
        assert attachment["order_id"] is None
        assert attachment["gmail_message_id"] == message_id
        assert attachment["parse_status"] == "pending"
        assert attachment["original_filename"] == pdf_filename
        assert attachment["content_type"] == "application/pdf"
        assert attachment["size_bytes"] is not None and attachment["size_bytes"] > 0

        tenant_id = attachment["tenant_id"]
        storage_path = attachment["storage_path"]
        assert storage_path.startswith(f"{tenant_id}/inbox/{message_id}/"), (
            f"Unexpected storage_path prefix: {storage_path!r}"
        )
        assert storage_path.endswith(".pdf"), (
            f"Expected .pdf extension in storage_path: {storage_path!r}"
        )

        # --- Supabase Storage にファイルが存在することを検証 ---
        storage_list = admin_db.storage.from_("order-attachments").list(
            f"{tenant_id}/inbox/{message_id}"
        )
        stored_filenames = [f["name"] for f in (storage_list or [])]
        stored_name = storage_path.rsplit("/", 1)[-1]
        assert stored_name in stored_filenames, (
            f"PDF file not found in Storage. "
            f"Expected '{stored_name}', found: {stored_filenames}"
        )

    def test_email_without_attachment_is_handled_gracefully(
        self,
        inject_email_without_attachment: dict[str, Any],
        admin_db,
    ) -> None:
        """
        添付なしメールを受信したとき:
        - orders レコードが作成される（処理は継続する）
        - order_attachments レコードが parse_status='failed_no_attachment' で作成される
        """
        run_id = inject_email_without_attachment["run_id"]

        # Gmail ポーリングを実行
        result = poll_unread_emails(admin_db)
        assert result["errors"] == 0, f"poll_unread_emails returned errors: {result}"
        assert result["processed"] >= 1

        time.sleep(1)

        # --- orders レコードの検証 ---
        order_result = (
            admin_db.table("orders")
            .select("id, source_type")
            .like("source_raw", f"%run_id={run_id}%")
            .execute()
        )
        orders = order_result.data or []
        assert len(orders) == 1, f"Expected 1 order, got {len(orders)}. run_id={run_id}"
        order = orders[0]
        assert order["source_type"] == "email"

        # --- order_attachments レコードの検証 ---
        att_result = (
            admin_db.table("order_attachments")
            .select("parse_status, storage_path")
            .eq("order_id", order["id"])
            .execute()
        )
        attachments = att_result.data or []
        assert len(attachments) == 1, (
            f"Expected 1 order_attachment, got {len(attachments)}."
        )
        assert attachments[0]["parse_status"] == "failed_no_attachment"
        assert attachments[0]["storage_path"] == ""

    def test_signed_url_is_accessible_for_staged_attachment(
        self,
        inject_email_with_pdf: dict[str, Any],
        admin_db,
    ) -> None:
        """
        PDF ステージング行 (order_id=NULL) の storage_path からも
        署名付き URL を生成できることを確認する。
        """
        from app.services.attachment_service import create_signed_url

        run_id = inject_email_with_pdf["run_id"]

        # ポーリング実行
        result = poll_unread_emails(admin_db)
        assert result["errors"] == 0

        time.sleep(1)

        # order_attachments ステージング行から storage_path を取得
        att_result = (
            admin_db.table("order_attachments")
            .select("storage_path, parse_status")
            .is_("order_id", "null")
            .like("source_raw", f"%run_id={run_id}%")
            .execute()
        )
        attachments = att_result.data or []
        assert len(attachments) == 1
        attachment = attachments[0]
        assert attachment["parse_status"] == "pending"

        # 署名付き URL を生成できることを確認
        signed_url = create_signed_url(admin_db, attachment["storage_path"])
        assert signed_url.startswith("http"), (
            f"Expected a valid URL, got: {signed_url!r}"
        )
