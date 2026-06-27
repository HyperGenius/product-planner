"""
Gmail受注下書きサンプルデータ投入スクリプト.

Gmail連携機能（GMAIL_ORDER_INTAKE）で生成される下書き受注のサンプルを
ローカル開発環境に投入します。下書き確認UI（フェーズ7）の開発・動作確認用。

以下の3パターンを2件ずつ、計6件のdraft orderを作成します:
  A: 単一製品マッチ済み (product_id解決済み、product_candidates=null)
  B: 複数候補あり     (product_id=null、product_candidates=[...])
  C: マッチなし       (product_id=null、product_candidates=null)

冪等性: order_number の一意制約を利用してupsertするため、複数回実行しても安全。

Usage:
    python scripts/seed_gmail_drafts.py

Required environment variables (.env):
    SUPABASE_URL
    SUPABASE_PUBLISHABLE_KEY
    TEST_USER_EMAIL
    TEST_USER_PASS
    TEST_TENANT_ID
"""

import json
import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

from supabase import Client, create_client  # type: ignore

load_dotenv()

DATA_FILE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..",
    "data",
    "gmail_drafts",
    "orders.json",
)


def init_client() -> tuple[Client, str]:
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
    email = os.environ.get("TEST_USER_EMAIL", "")
    password = os.environ.get("TEST_USER_PASS", "")
    tenant_id = os.environ.get("TEST_TENANT_ID", "")

    if not all([url, key, email, password, tenant_id]):
        raise ValueError(
            "Required environment variables are missing: "
            "SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, TEST_USER_EMAIL, TEST_USER_PASS, TEST_TENANT_ID"
        )

    client = create_client(url, key)
    res = client.auth.sign_in_with_password({"email": email, "password": password})
    if not res.session:
        raise ValueError("Authentication failed")

    print(f"✅ Authenticated as {email}")
    return client, tenant_id


def fetch_product_map(client: Client, tenant_id: str) -> dict[str, int]:
    """製品コード → product_id のマッピングを取得する."""
    res = (
        client.table("products").select("id, code").eq("tenant_id", tenant_id).execute()
    )
    return {row["code"]: int(row["id"]) for row in (res.data or [])}


def resolve_candidates(
    candidates: list[dict] | None, product_map: dict[str, int]
) -> list[dict] | None:
    """product_candidatesのproduct_codeをproduct_idに変換する."""
    if not candidates:
        return None

    resolved = []
    for c in candidates:
        code = c.get("product_code")
        if code and code in product_map:
            resolved.append(
                {
                    "product_id": product_map[code],
                    "name": c["name"],
                    "score": c["score"],
                }
            )
        else:
            print(
                f"  ⚠️  Product code not found in candidates: {code}, skipping candidate"
            )
    return resolved if resolved else None


def seed_gmail_drafts() -> None:
    print("\n" + "=" * 60)
    print("🚀 Seeding Gmail draft orders")
    print("=" * 60)

    client, tenant_id = init_client()

    with open(DATA_FILE, encoding="utf-8") as f:
        orders_data = json.load(f)

    print("\n📦 Fetching product map...")
    product_map = fetch_product_map(client, tenant_id)
    print(f"  Found {len(product_map)} products: {list(product_map.keys())}")

    print("\n📦 Inserting draft orders...")
    inserted = 0
    skipped = 0

    for order in orders_data:
        order_number = order["order_number"]
        product_code = order.get("product_code")

        product_id: int | None = None
        if product_code:
            if product_code not in product_map:
                print(
                    f"  ⚠️  Product code not found: {product_code}, skipping {order_number}"
                )
                skipped += 1
                continue
            product_id = product_map[product_code]

        candidates = resolve_candidates(order.get("product_candidates"), product_map)

        record: dict = {
            "tenant_id": tenant_id,
            "order_number": order_number,
            "product_id": product_id,
            "quantity": order.get("quantity"),
            "deadline_date": order.get("deadline_date"),
            "status": order.get("status", "draft"),
            "source_type": order.get("source_type", "email"),
            "source_raw": order.get("source_raw"),
            "extracted_product_name": order.get("extracted_product_name"),
            "product_candidates": candidates,
        }

        client.table("orders").upsert(
            record,
            on_conflict="tenant_id, order_number",
        ).execute()

        pattern = (
            "A（単一マッチ）"
            if product_id
            else ("B（複数候補）" if candidates else "C（マッチなし）")
        )
        print(f"  ✓ {order_number} — パターン{pattern}")
        inserted += 1

    print(f"\n{'=' * 60}")
    print(f"✅ Done: {inserted} orders upserted, {skipped} skipped")
    print(f"{'=' * 60}\n")


if __name__ == "__main__":
    try:
        seed_gmail_drafts()
    except Exception as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)
