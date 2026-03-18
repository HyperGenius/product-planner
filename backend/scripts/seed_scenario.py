"""
シナリオベースのデモデータ投入スクリプト.

このスクリプトは冪等性を保証しており、複数回実行してもエラーになりません。
既存のデータがある場合は更新、なければ作成されます (UPSERT)。

Usage:
    python scripts/seed_scenario.py standard_demo

Note:
    各テーブルのユニーク制約に基づいてupsertを実行します:
    - equipment_groups: (tenant_id, name)
    - equipments: (tenant_id, name)
    - equipment_group_members: (equipment_group_id, equipment_id)
    - products: (tenant_id, code)
    - process_routings: (product_id, sequence_order)
    - orders: (tenant_id, order_number)
"""

import argparse
import json
import os
import sys
from typing import Any

# プロジェクトルートへのパス追加
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

from supabase import Client, create_client  # type: ignore

load_dotenv()


def load_json(base_path: str, filename: str) -> list[dict[str, Any]] | None:
    """JSONファイルを読み込む."""
    path = os.path.join(base_path, filename)
    if not os.path.exists(path):
        print(f"⚠️  File not found: {path}")
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def init_client() -> tuple[Client, str]:
    """Supabaseクライアントを初期化し、認証済みクライアントとテナントIDを返す."""
    # 環境変数から取得
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
    test_user_email = os.environ.get("TEST_USER_EMAIL", "")
    test_user_pass = os.environ.get("TEST_USER_PASS", "")
    tenant_id = os.environ.get("TEST_TENANT_ID", "")

    if not all([url, key, test_user_email, test_user_pass, tenant_id]):
        raise ValueError(
            "Required environment variables are missing: "
            "SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, TEST_USER_EMAIL, TEST_USER_PASS, TEST_TENANT_ID"
        )

    # Supabaseクライアントを作成
    client = create_client(url, key)

    # メール/パスワードでサインイン
    res = client.auth.sign_in_with_password(
        {"email": test_user_email, "password": test_user_pass}
    )
    if not res.session:
        raise ValueError("Failed to authenticate")

    print(f"✅ Authenticated as {test_user_email}")
    return client, tenant_id


def resolve_path(scenario_name: str) -> str:
    """シナリオディレクトリのパスを解決する."""
    # スクリプトの親ディレクトリ（プロジェクトルート）を取得
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    base_path = os.path.join(project_root, "data", "scenarios", scenario_name)

    if not os.path.exists(base_path):
        raise ValueError(f"Scenario directory not found: {base_path}")

    return base_path


def import_groups(client: Client, tenant_id: str, base_path: str) -> dict[str, int]:
    """
    設備グループと設備をインポートする

    Returns:
        group_name -> group_id のマッピング辞書
    """
    print("\n📦 Importing equipment groups and machines...")

    data = load_json(base_path, "01_groups.json")
    if not data:
        print("⚠️  No groups data found, skipping...")
        return {}

    group_map: dict[str, int] = {}
    equipment_map: dict[str, int] = {}

    for group_data in data:
        group_name = group_data["name"]
        machine_names = group_data.get("machines", [])

        # グループを作成（upsert）
        group_response = (
            client.table("equipment_groups")
            .upsert(
                {"name": group_name, "tenant_id": tenant_id},
                on_conflict="tenant_id, name",
            )
            .execute()
        )
        group_id = group_response.data[0]["id"]  # type: ignore
        group_map[group_name] = group_id  # type: ignore
        print(f"  ✓ Created group: {group_name} (ID: {group_id})")

        # 各設備を作成してグループに追加
        for machine_name in machine_names:
            # 設備を作成（重複チェック、upsert）
            if machine_name not in equipment_map:
                equipment_response = (
                    client.table("equipments")
                    .upsert(
                        {"name": machine_name, "tenant_id": tenant_id},
                        on_conflict="tenant_id, name",
                    )
                    .execute()
                )
                equipment_id = equipment_response.data[0]["id"]  # type: ignore
                equipment_map[machine_name] = equipment_id  # type: ignore
                print(f"    ✓ Created equipment: {machine_name} (ID: {equipment_id})")
            else:
                equipment_id = equipment_map[machine_name]

            # グループメンバーシップを作成（upsert）
            client.table("equipment_group_members").upsert(
                {
                    "equipment_group_id": group_id,
                    "equipment_id": equipment_id,
                    "tenant_id": tenant_id,
                },
                on_conflict="equipment_group_id, equipment_id",
            ).execute()
            print(f"    ✓ Added {machine_name} to {group_name}")

    print(f"✅ Imported {len(group_map)} groups and {len(equipment_map)} machines")
    return group_map


def import_products(client: Client, tenant_id: str, base_path: str) -> dict[str, int]:
    """
    製品をインポートする.

    Returns:
        product_code -> product_id のマッピング辞書
    """
    print("\n📦 Importing products...")

    data = load_json(base_path, "02_products.json")
    if not data:
        print("⚠️  No products data found, skipping...")
        return {}

    product_map: dict[str, int] = {}

    for product_data in data:
        product_code = product_data["code"]
        response = (
            client.table("products")
            .upsert(
                {
                    "name": product_data["name"],
                    "code": product_code,
                    "type": product_data["type"],
                    "tenant_id": tenant_id,
                },
                on_conflict="tenant_id, code",
            )
            .execute()
        )
        product_id = int(response.data[0]["id"])  # type: ignore
        product_map[product_code] = product_id
        print(
            f"  ✓ Created product: {product_data['name']} ({product_code}, ID: {product_id})"
        )

    print(f"✅ Imported {len(product_map)} products")
    return product_map


def import_routings(
    client: Client,
    tenant_id: str,
    base_path: str,
    group_map: dict[str, int],
    product_map: dict[str, int],
) -> None:
    """
    工程定義をインポートする.
    製品コードと設備グループ名からIDを解決して登録する
    """
    print("\n📦 Importing process routings...")

    data = load_json(base_path, "03_routings.json")
    if not data:
        print("⚠️  No routings data found, skipping...")
        return

    routing_count = 0

    for product_routing in data:
        product_code = product_routing["product_code"]
        routings = product_routing.get("routings", [])

        if product_code not in product_map:
            print(f"  ⚠️  Product code not found: {product_code}, skipping...")
            continue

        product_id = product_map[product_code]

        for routing in routings:
            group_name = routing["group_name"]

            if group_name not in group_map:
                print(f"  ⚠️  Group name not found: {group_name}, skipping routing...")
                continue

            group_id = group_map[group_name]

            # 工程を登録（upsert）
            client.table("process_routings").upsert(
                {
                    "product_id": product_id,
                    "sequence_order": routing["sequence_order"],
                    "process_name": routing["process_name"],
                    "equipment_group_id": group_id,
                    "setup_time_seconds": routing.get("setup_time_seconds", 0),
                    "unit_time_seconds": routing.get("unit_time_seconds", 0),
                    "tenant_id": tenant_id,
                },
                on_conflict="product_id, sequence_order",
            ).execute()

            routing_count += 1
            print(
                f"  ✓ Created routing: {product_code} -> {routing['process_name']} "
                f"(Seq: {routing['sequence_order']})"
            )

    print(f"✅ Imported {routing_count} process routings")


def import_orders(
    client: Client,
    tenant_id: str,
    base_path: str,
    product_map: dict[str, int],
) -> None:
    """
    注文データをインポートする.
    製品コードからIDを解決して登録する
    """
    print("\n📦 Importing orders...")

    data = load_json(base_path, "04_orders.json")
    if not data:
        print("⚠️  No orders data found, skipping...")
        return

    order_count = 0

    for order_data in data:
        product_code = order_data["product_code"]

        if product_code not in product_map:
            print(f"  ⚠️  Product code not found: {product_code}, skipping order...")
            continue

        product_id = product_map[product_code]

        # 注文を登録（upsert）
        client.table("orders").upsert(
            {
                "order_number": order_data["order_number"],
                "product_id": product_id,
                "quantity": order_data["quantity"],
                "deadline_date": order_data.get("deadline_date"),
                "tenant_id": tenant_id,
            },
            on_conflict="tenant_id, order_number",
        ).execute()

        order_count += 1
        print(
            f"  ✓ Created order: {order_data['order_number']} "
            f"({product_code} x {order_data['quantity']})"
        )

    print(f"✅ Imported {order_count} orders")


def seed_admin_profile(client: Client, tenant_id: str) -> None:
    """
    認証済み管理者ユーザーの profiles レコードを作成・更新する.

    サインアップフローでは profiles が自動作成されないため、
    このシードステップで管理者のプロフィールを登録する。
    Service Role Key が設定されている場合はそれを使用し、
    未設定の場合は認証済みユーザーとして upsert を試みる。
    """
    print("\n👤 Seeding admin profile...")

    # 認証済みユーザーの情報を取得
    user_response = client.auth.get_user()
    if not user_response or not user_response.user:
        print("  ⚠️  Could not retrieve authenticated user, skipping...")
        return

    user = user_response.user
    user_id = str(user.id)
    user_email = user.email or ""

    # 管理者の氏名を環境変数から取得（未設定時はメールのローカルパートを使用）
    admin_full_name = os.environ.get(
        "TEST_ADMIN_FULL_NAME",
        user_email.split("@")[0] if user_email else "Admin",
    )

    # Service Role Key が利用可能であれば管理者クライアントを使用（RLSをバイパス）
    sb_url = os.environ.get("SUPABASE_URL", "")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

    if service_role_key:
        upsert_client = create_client(sb_url, service_role_key)
        print("  ℹ️  Using service role key for profile upsert")
    else:
        upsert_client = client
        print(
            "  ℹ️  Using user token for profile upsert (SUPABASE_SERVICE_ROLE_KEY not set)"
        )

    upsert_client.table("profiles").upsert(
        {"id": user_id, "full_name": admin_full_name, "email": user_email},
        on_conflict="id",
    ).execute()

    print(f"  ✓ Upserted profile for {user_email} (full_name: {admin_full_name})")
    print("✅ Admin profile seeded")


def seed_scenario(scenario_name: str):
    """シナリオデータを投入するメイン関数."""
    print(f"\n{'=' * 60}")
    print(f"🚀 Seeding scenario: {scenario_name}")
    print(f"{'=' * 60}")

    # 1. 初期化
    client, tenant_id = init_client()
    base_path = resolve_path(scenario_name)

    print(f"📂 Scenario path: {base_path}")

    # 2. 各ステップの実行（依存順序を守る）
    seed_admin_profile(client, tenant_id)
    group_map = import_groups(client, tenant_id, base_path)
    product_map = import_products(client, tenant_id, base_path)
    import_routings(client, tenant_id, base_path, group_map, product_map)
    import_orders(client, tenant_id, base_path, product_map)

    print(f"\n{'=' * 60}")
    print("✅ Scenario seeding completed!")
    print(f"{'=' * 60}\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Import scenario-based demo data into Supabase"
    )
    parser.add_argument(
        "scenario",
        help="Name of the scenario directory (e.g. standard_demo)",
    )
    args = parser.parse_args()

    try:
        seed_scenario(args.scenario)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)
