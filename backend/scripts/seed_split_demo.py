"""
手動分割機能（Issue #280 Phase3、POST /orders/{id}/split）を手元で確認するための
デモデータ投入スクリプト。

実際のメール受信 → 抽出パイプラインは通さず、1通のメールに複数月分の内示数量が
誤って1件にマージされてしまった想定の draft 注文と、その起票元となる
order_attachments のステージング行（source_attachment_id が参照する行）を
直接投入する。フロントエンドの注文詳細ページ (/orders/{id}) を開くと
「分割」ボタンが表示され、実際に分割APIを試せる。

冪等性: 固定の gmail_message_id で検索し、既存があれば再利用・更新する
（複数回実行しても重複しない）。

Usage:
    cd backend && python scripts/seed_split_demo.py

Required environment variables (.env): seed_scenario.py と共通
    SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, TEST_USER_EMAIL, TEST_USER_PASS,
    TEST_TENANT_ID
"""

import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from seed_scenario import init_client  # noqa: E402 (認証済みクライアント取得を再利用)

DEMO_GMAIL_MESSAGE_ID = "seed-split-demo-b115105"
DEMO_PRODUCT_CODE = "B115105"
DEMO_PRODUCT_NAME = "分割デモ部品B115105"
DEMO_CUSTOMER_NAME = "分割デモ商事"

# Issue #280 で報告された実例（部品番号B115105、6ヶ月分の内示が1レコードに
# マージされてしまったケース）を模したメール本文
DEMO_SOURCE_RAW = """件名: 内示のご連絡

いつもお世話になっております。分割デモ商事です。
下記の通り、部品番号 B115105 について今後6ヶ月分の内示数量をご連絡いたします。

10月: 5,000個
11月: 5,200個
12月: 4,800個
1月: 5,500個
2月: 5,100個
3月: 5,400個

よろしくお願いいたします。
"""

# 6ヶ月分の合計（5000+5200+4800+5500+5100+5400）が1明細に誤ってマージされた想定
MERGED_QUANTITY = 31000


def ensure_customer(client, tenant_id: str) -> int:
    existing = (
        client.table("customers")
        .select("id")
        .eq("tenant_id", tenant_id)
        .eq("name", DEMO_CUSTOMER_NAME)
        .execute()
    )
    if existing.data:
        return int(existing.data[0]["id"])

    created = (
        client.table("customers")
        .insert({"tenant_id": tenant_id, "name": DEMO_CUSTOMER_NAME})
        .execute()
    )
    return int(created.data[0]["id"])


def ensure_product(client, tenant_id: str) -> int:
    response = (
        client.table("products")
        .upsert(
            {
                "tenant_id": tenant_id,
                "code": DEMO_PRODUCT_CODE,
                "name": DEMO_PRODUCT_NAME,
            },
            on_conflict="tenant_id, code",
        )
        .execute()
    )
    return int(response.data[0]["id"])


def ensure_staging_attachment(client, tenant_id: str, customer_id: int) -> str:
    """
    order_attachments のステージング行（order_id IS NULL）を作成・更新する。
    実運用では poll_unread_emails() がINSERTし、parse_pending_order_pdfs() が
    処理完了後に parse_status='success' に更新する行に相当する。
    """
    existing = (
        client.table("order_attachments")
        .select("id")
        .eq("tenant_id", tenant_id)
        .eq("gmail_message_id", DEMO_GMAIL_MESSAGE_ID)
        .is_("order_id", "null")
        .execute()
    )
    if existing.data:
        staging_id = existing.data[0]["id"]
        client.table("order_attachments").update(
            {"customer_id": customer_id, "source_raw": DEMO_SOURCE_RAW}
        ).eq("id", staging_id).execute()
        return staging_id

    created = (
        client.table("order_attachments")
        .insert(
            {
                "tenant_id": tenant_id,
                "order_id": None,
                "storage_path": "",
                "original_filename": "",
                "customer_id": customer_id,
                "source_raw": DEMO_SOURCE_RAW,
                "gmail_message_id": DEMO_GMAIL_MESSAGE_ID,
                "parse_status": "success",
            }
        )
        .execute()
    )
    return created.data[0]["id"]


def ensure_merged_order(
    client,
    tenant_id: str,
    product_id: int,
    customer_id: int,
    staging_id: str,
) -> int:
    existing = (
        client.table("orders")
        .select("id")
        .eq("tenant_id", tenant_id)
        .eq("source_attachment_id", staging_id)
        .execute()
    )
    if existing.data:
        order_id = existing.data[0]["id"]
        client.table("orders").update(
            {
                "status": "draft",
                "product_id": product_id,
                "customer_id": customer_id,
                "quantity": MERGED_QUANTITY,
            }
        ).eq("id", order_id).execute()
    else:
        created = (
            client.table("orders")
            .insert(
                {
                    "tenant_id": tenant_id,
                    "product_id": product_id,
                    "customer_id": customer_id,
                    "quantity": MERGED_QUANTITY,
                    "deadline_date": "2026-10-01",
                    "status": "draft",
                    "source_type": "email",
                    "customer_certainty": "forecast",
                    "source_raw": DEMO_SOURCE_RAW,
                    "extracted_product_name": DEMO_PRODUCT_NAME,
                    "source_attachment_id": staging_id,
                }
            )
            .execute()
        )
        order_id = created.data[0]["id"]

    # 実運用の _process_line_item と同じパターンで、注文自身に紐づく
    # order_attachments 行も複製しておく（添付ファイルパネルの表示確認用）
    real_attachment = (
        client.table("order_attachments")
        .select("id")
        .eq("order_id", order_id)
        .execute()
    )
    if not real_attachment.data:
        client.table("order_attachments").insert(
            {
                "tenant_id": tenant_id,
                "order_id": order_id,
                "storage_path": "",
                "original_filename": "",
                "customer_id": customer_id,
                "source_raw": DEMO_SOURCE_RAW,
                "gmail_message_id": DEMO_GMAIL_MESSAGE_ID,
                "parse_status": "failed_no_attachment",
            }
        ).execute()

    return order_id


def main() -> None:
    print("\n" + "=" * 60)
    print("🚀 Seeding split-demo data (Issue #280 Phase3)")
    print("=" * 60)

    client, tenant_id = init_client()

    customer_id = ensure_customer(client, tenant_id)
    print(f"✓ Customer ready: {DEMO_CUSTOMER_NAME} (ID: {customer_id})")

    product_id = ensure_product(client, tenant_id)
    print(f"✓ Product ready: {DEMO_PRODUCT_CODE} (ID: {product_id})")

    staging_id = ensure_staging_attachment(client, tenant_id, customer_id)
    print(f"✓ Source staging row ready (order_attachments.id: {staging_id})")

    order_id = ensure_merged_order(
        client, tenant_id, product_id, customer_id, staging_id
    )
    print(f"✓ Merged draft order ready (orders.id: {order_id})")

    print(f"\n{'=' * 60}")
    print(f"✅ Done! /orders/{order_id} を開いて「分割」ボタンを確認してください")
    print(f"{'=' * 60}\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)
