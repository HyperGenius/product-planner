"""
E2E テスト: 受注PDF自動パース＋複数order生成フロー (Issue #249)

order-attachments バケットに事前アップロード済みの実PDF（飯野製作所フォーマット、
複数品番・複数納期・確度混在の注文一覧表）を対象に、実際の Supabase と Claude API
を使って parse_pending_order_pdfs() を実行し、以下を検証する:

  - 配線・データフロー: ステージング行 → テキスト抽出 → Claude抽出 → 製品照合 →
    order生成 → order_attachments紐付け、という一連の処理が実際に完走すること
  - 抽出精度: 実在する製品については正しい数量・納期でorderが生成されること、
    実在しない製品については誤って別製品にマッチせず no_product_match として
    スキップされること（品番が1文字違いの類似製品が製品マスタに存在するケース）

事前準備:
  1. conftest.py の pdf_order_parsing_staging_row フィクスチャのドキュメント参照
     （対象PDFのstorage_path、ANTHROPIC_API_KEY、対象テナントの製品マスタ）

実行:
  cd backend && pytest __tests__/e2e/test_pdf_order_parsing_flow.py -v --run-e2e
"""

from typing import Any, cast

import pytest
from app.services.attachment_service import create_signed_url
from app.services.pdf_order_parsing_service import parse_pending_order_pdfs

# PDF内に実在する製品の品番。product_matching_service の名寄せ
# (pg_trgm, 自動確定しきい値あり) 経由でマッチすることを想定。
# 製品マスタ側の登録名は "22750-50P-0000-1"（末尾の0埋めなし）のため、
# 検索には両表記に共通するプレフィックスを用いる。
_EXISTING_PRODUCT_NUMBER = "22750-50P-0000-01"
_EXISTING_PRODUCT_NAME_SEARCH_PREFIX = "22750-50P"
# PDF内に記載されているが、製品マスタには存在しない品番。
# よく似た別製品 (1文字違い) が製品マスタに存在するため、
# 誤って別製品にマッチしないことを検証する対象。
_MISSING_PRODUCT_NUMBER = "25760-63C-0000-01-01"


@pytest.mark.e2e
class TestPdfOrderParsingFlow:
    def test_staged_pdf_is_parsed_into_orders_with_correct_matching(
        self,
        pdf_order_parsing_staging_row: dict[str, Any],
        admin_db,
        e2e_tenant_id: str,
    ) -> None:
        attachment_id = pdf_order_parsing_staging_row["id"]
        run_id = pdf_order_parsing_staging_row["_run_id"]

        # --- パース実行（実 Supabase Storage + 実 Claude API を使用） ---
        result = parse_pending_order_pdfs(admin_db)
        assert result["errors"] == 0, (
            f"parse_pending_order_pdfs returned errors: {result}"
        )

        # --- 配線・データフロー: ステージング行が success になる ---
        staging_result = (
            admin_db.table("order_attachments")
            .select("parse_status")
            .eq("id", attachment_id)
            .execute()
        )
        staging_rows = cast(list[dict[str, Any]], staging_result.data or [])
        assert len(staging_rows) == 1
        assert staging_rows[0]["parse_status"] == "success"

        # --- このテスト実行で生成された orders を取得 ---
        orders_result = (
            admin_db.table("orders")
            .select("*")
            .eq("tenant_id", e2e_tenant_id)
            .like("source_raw", f"%run_id={run_id}%")
            .execute()
        )
        orders = cast(list[dict[str, Any]], orders_result.data or [])
        assert len(orders) >= 1, (
            "実在する製品について少なくとも1件orderが生成されるはず"
        )

        # --- 抽出精度: 実在する製品 (22750-50P-...) について正しくマッチし、
        #     正しい数量・妥当な納期で order が生成されていること ---
        products_result = (
            admin_db.table("products")
            .select("id")
            .eq("tenant_id", e2e_tenant_id)
            .ilike("name", f"%{_EXISTING_PRODUCT_NAME_SEARCH_PREFIX}%")
            .execute()
        )
        existing_product_rows = cast(list[dict[str, Any]], products_result.data or [])
        assert len(existing_product_rows) == 1, (
            f"テスト前提: 製品マスタに '{_EXISTING_PRODUCT_NAME_SEARCH_PREFIX}' を含む製品が"
            "1件だけ登録されている必要があります"
        )
        existing_product_id = existing_product_rows[0]["id"]

        orders_for_existing_product = [
            order for order in orders if order["product_id"] == existing_product_id
        ]
        assert len(orders_for_existing_product) >= 1, (
            f"'{_EXISTING_PRODUCT_NUMBER}' に対応する製品(id={existing_product_id})の"
            f"orderが生成されていません。生成されたorders: {orders}"
        )
        for order in orders_for_existing_product:
            assert order["quantity"] == 15000
            assert order["status"] in ("confirmed", "forecast", "forecast_tentative")
            assert order["customer_id"] == pdf_order_parsing_staging_row["customer_id"]

        deadline_dates = {
            order["deadline_date"] for order in orders_for_existing_product
        }
        assert deadline_dates <= {"2026-07-13", "2026-07-27"}, (
            f"想定外の納期でorderが生成されました: {deadline_dates}"
        )

        # --- 抽出精度: 存在しない製品 (25760-63C-...) は、1文字違いの類似デコイ製品
        #     (22760-63C-...) に誤ってマッチせず、無理に order を生成しないこと ---
        decoy_products_result = (
            admin_db.table("products")
            .select("id")
            .eq("tenant_id", e2e_tenant_id)
            .ilike("name", "%22760-63C%")
            .execute()
        )
        decoy_product_rows = cast(
            list[dict[str, Any]], decoy_products_result.data or []
        )
        assert len(decoy_product_rows) == 1, (
            "テスト前提: 製品マスタにデコイ製品 '22760-63C-...' が"
            "1件だけ登録されている必要があります"
        )
        decoy_product_id = decoy_product_rows[0]["id"]
        assert not any(order["product_id"] == decoy_product_id for order in orders), (
            f"'{_MISSING_PRODUCT_NUMBER}' がデコイ製品(id={decoy_product_id})に"
            f"誤ってマッチしました: {orders}"
        )

        log_result = (
            admin_db.table("order_parse_log")
            .select("*")
            .eq("order_attachment_id", attachment_id)
            .execute()
        )
        logs = cast(list[dict[str, Any]], log_result.data or [])
        no_match_logs = [log for log in logs if log["reason"] == "no_product_match"]
        assert any(
            _MISSING_PRODUCT_NUMBER in str(log.get("detail", {}))
            for log in no_match_logs
        ), (
            f"'{_MISSING_PRODUCT_NUMBER}' が no_product_match として "
            f"order_parse_log に記録されていません: {logs}"
        )

        # --- 生成された order の添付ファイルが既存エンドポイント経由で
        #     ダウンロード可能であること（/orders/{order_id}/attachments が
        #     変更なしで流用できることの確認） ---
        att_result = (
            admin_db.table("order_attachments")
            .select("storage_path, parse_status")
            .eq("order_id", orders_for_existing_product[0]["id"])
            .execute()
        )
        attachments = cast(list[dict[str, Any]], att_result.data or [])
        assert len(attachments) == 1
        assert attachments[0]["parse_status"] == "success"

        signed_url = create_signed_url(admin_db, attachments[0]["storage_path"])
        assert signed_url.startswith("http")
