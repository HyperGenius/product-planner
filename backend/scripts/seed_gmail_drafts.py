"""
Gmail受注下書きサンプルデータ投入スクリプト.

Gmail連携機能（GMAIL_ORDER_INTAKE）で生成される下書き受注のサンプルを
ローカル開発環境に投入します。下書き確認UI（フェーズ7）の開発・動作確認用。

以下の3パターンを2件ずつ、計6件のdraft orderを作成します:
  A: 単一製品マッチ済み (product_id解決済み、product_candidates=null)
  B: 複数候補あり     (product_id=null、product_candidates=[...])
  C: マッチなし       (product_id=null、product_candidates=null)

冪等性: order_number が重複した場合はスキップするため、複数回実行しても安全。

Usage:
    python scripts/seed_gmail_drafts.py           # 実際に投入
    python scripts/seed_gmail_drafts.py --dry-run  # DBに書き込まず内容を確認

Required environment variables (.env):
    SUPABASE_URL
    SUPABASE_API_KEY
    TEST_USER_EMAIL
    TEST_USER_PASS
    TEST_TENANT_ID
    BACKEND_URL  # 省略時: http://localhost:8081 (docker-compose) / http://localhost:8000 (uvicorn直接)
"""

import argparse
import json
import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

import requests
from dotenv import load_dotenv
from get_token import get_access_token

load_dotenv()

DATA_FILE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..",
    "data",
    "gmail_drafts",
    "orders.json",
)


def build_headers(token: str, tenant_id: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "x-tenant-id": tenant_id,
        "Content-Type": "application/json",
    }


def fetch_product_map(headers: dict, backend_url: str) -> dict[str, int]:
    """製品コード → product_id のマッピングを取得する."""
    res = requests.get(f"{backend_url}/products/", headers=headers)
    if res.status_code != 200:
        raise Exception(f"Failed to fetch products: {res.status_code} {res.text}")
    return {p["code"]: int(p["id"]) for p in res.json() if p.get("code")}


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


def seed_gmail_drafts(dry_run: bool = False) -> None:
    print("\n" + "=" * 60)
    print("🚀 Seeding Gmail draft orders" + (" [DRY RUN]" if dry_run else ""))
    print("=" * 60)

    email = os.environ.get("TEST_USER_EMAIL", "")
    password = os.environ.get("TEST_USER_PASS", "")
    tenant_id = os.environ.get("TEST_TENANT_ID", "")
    backend_url = os.environ.get("BACKEND_URL", "http://localhost:8081")

    if not all([email, password, tenant_id]):
        raise ValueError(
            "Required environment variables are missing: "
            "TEST_USER_EMAIL, TEST_USER_PASS, TEST_TENANT_ID"
        )

    token = get_access_token(email, password)
    if not token:
        raise ValueError("Authentication failed")

    headers = build_headers(token, tenant_id)

    with open(DATA_FILE, encoding="utf-8") as f:
        orders_data = json.load(f)

    print("\n📦 Fetching product map...")
    product_map = fetch_product_map(headers, backend_url)
    print(f"  Found {len(product_map)} products: {list(product_map.keys())}")

    action = "Would insert" if dry_run else "Inserting"
    print(f"\n📦 {action} draft orders...")
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

        payload = {
            "order_number": order_number,
            "product_id": product_id,
            "quantity": order.get("quantity"),
            "deadline_date": order.get("deadline_date"),
            "source_type": order.get("source_type", "email"),
            "source_raw": order.get("source_raw"),
            "extracted_product_name": order.get("extracted_product_name"),
            "product_candidates": candidates,
        }

        pattern = (
            "A（単一マッチ）"
            if product_id
            else ("B（複数候補）" if candidates else "C（マッチなし）")
        )

        if dry_run:
            print(f"  [DRY RUN] {order_number} — パターン{pattern}")
            print(
                f"    product_id={product_id}, quantity={payload['quantity']}, deadline={payload['deadline_date']}"
            )
            print(f"    extracted_product_name={payload['extracted_product_name']!r}")
            n_candidates = len(candidates) if candidates else 0
            print(f"    product_candidates={n_candidates}件")
            inserted += 1
            continue

        res = requests.post(f"{backend_url}/orders/", headers=headers, json=payload)

        if res.status_code == 400 and "注文番号は既に使用" in res.text:
            print(f"  - {order_number} — スキップ（既存）")
            skipped += 1
        elif res.status_code != 200:
            raise Exception(
                f"Failed to create order {order_number}: {res.status_code} {res.text}"
            )
        else:
            print(f"  ✓ {order_number} — パターン{pattern}")
            inserted += 1

    print(f"\n{'=' * 60}")
    if dry_run:
        print(f"✅ Dry run: {inserted} orders would be inserted, {skipped} skipped")
        print("   実際に投入するには --dry-run を外して実行してください")
    else:
        print(f"✅ Done: {inserted} orders inserted, {skipped} skipped")
    print(f"{'=' * 60}\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Gmail受注下書きサンプルデータ投入スクリプト"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="DBに書き込まず、投入予定の内容を表示する",
    )
    args = parser.parse_args()

    try:
        seed_gmail_drafts(dry_run=args.dry_run)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)
