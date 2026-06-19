"""
backend/scripts/migrate/migrate_from_json.py

./_data/*.json からデータを読み込んでSupabaseに挿入するスクリプト。

処理順序:
  1. equipment_groups.json  → equipment_groups テーブル
  2. equipments.json        → equipments テーブル
  3. equipment_group_members.json → equipment_group_members テーブル
     (equipment_nameとequipment_group_nameからIDを解決して登録)
  4. products.json          → products テーブル
     (code が空文字の場合は NULL として扱う; 配列インデックス+1 = legacy_product_id)
  5. processes.json         → process_routings テーブル
     (product_id は products.json の1始まりインデックスで解決)
     (machine_name が equipment_groups.name と一致しない場合は equipment_group_id = NULL)

冪等性:
  - equipment_groups / equipments は (tenant_id, name) でupsert
  - equipment_group_members は (equipment_group_id, equipment_id) でupsert
  - products は tenant内で同名の製品が存在する場合スキップ
  - process_routings は (product_id, sequence_order) でupsert

Usage:
    python scripts/migrate/migrate_from_json.py \\
        [--env-file PATH] \\
        [--tenant-id UUID] \\
        [--dry-run] \\
        [--skip-validation]

環境変数 (backend/scripts/.env または --env-file 指定ファイルに設定):
    SUPABASE_URL
    SUPABASE_PUBLISHABLE_KEY
    TEST_USER_EMAIL
    TEST_USER_PASS
    TEST_TENANT_ID        # --tenant-id で上書き可
"""

import argparse
import json
import os
import sys
from typing import Any

# プロジェクトルート (backend/) へのパス追加
sys.path.append(os.path.join(os.path.dirname(__file__), "..", ".."))

from dotenv import load_dotenv

from supabase import Client, create_client  # type: ignore

# _data ディレクトリのパス
_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_data")


# ---------------------------------------------------------------------------
# ユーティリティ
# ---------------------------------------------------------------------------


def load_json(filename: str) -> list[dict[str, Any]]:
    """_data/<filename> を読み込んで返す。"""
    path = os.path.join(_DATA_DIR, filename)
    if not os.path.exists(path):
        raise FileNotFoundError(f"Data file not found: {path}")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_all_data() -> dict[str, list[dict[str, Any]]]:
    """全 JSON ファイルを読み込んで返す。"""
    return {
        "equipment_groups": load_json("equipment_groups.json"),
        "equipments": load_json("equipments.json"),
        "equipment_group_members": load_json("equipment_group_members.json"),
        "products": load_json("products.json"),
        "processes": load_json("processes.json"),
    }


def init_client(tenant_id_arg: str | None = None) -> tuple[Client, str]:
    """Supabaseクライアントを初期化し、認証済みクライアントとテナントIDを返す。"""
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
    email = os.environ.get("TEST_USER_EMAIL", "")
    password = os.environ.get("TEST_USER_PASS", "")
    tenant_id = tenant_id_arg or os.environ.get("TEST_TENANT_ID", "")

    if not all([url, key, email, password, tenant_id]):
        missing = [
            name
            for name, val in [
                ("SUPABASE_URL", url),
                ("SUPABASE_PUBLISHABLE_KEY", key),
                ("TEST_USER_EMAIL", email),
                ("TEST_USER_PASS", password),
                ("TEST_TENANT_ID (or --tenant-id)", tenant_id),
            ]
            if not val
        ]
        raise ValueError(f"必須の環境変数が不足しています: {', '.join(missing)}")

    client = create_client(url, key)
    res = client.auth.sign_in_with_password({"email": email, "password": password})
    if not res.session:
        raise ValueError("認証に失敗しました")

    print(f"✅ Authenticated as {email} (tenant: {tenant_id})")
    return client, tenant_id


# ---------------------------------------------------------------------------
# バリデーション
# ---------------------------------------------------------------------------


def _get_unresolved_machine_names(data: dict[str, list[dict[str, Any]]]) -> list[str]:
    """processes の machine_name のうち equipment_groups に存在しないものを返す。"""
    group_names = {row["name"] for row in data["equipment_groups"]}
    unresolved = sorted(
        {
            row["machine_name"]
            for row in data["processes"]
            if row.get("machine_name") and row["machine_name"] not in group_names
        }
    )
    return unresolved


def preflight_validation(
    data: dict[str, list[dict[str, Any]]], skip: bool = False
) -> bool:
    """
    processes.json の machine_name を equipment_groups.json と突き合わせ、
    未解決のものを一覧表示して続行確認する。

    Returns:
        True: 続行、False: 中止
    """
    print("\n🔍 事前バリデーション: machine_name のチェック...")
    unresolved = _get_unresolved_machine_names(data)

    if not unresolved:
        print("✅ 全 machine_name が equipment_groups に存在します")
        return True

    print(f"\n⚠️  未解決の machine_name が {len(unresolved)} 件あります:")
    for name in unresolved:
        count = sum(1 for row in data["processes"] if row.get("machine_name") == name)
        print(f"    - '{name}' ({count} 件の工程で使用)")
    print("→ 上記の process_routings は equipment_group_id = NULL で登録されます\n")

    if skip:
        print("--skip-validation が指定されたため確認をスキップして続行します")
        return True

    try:
        answer = input("続行しますか? [y/N]: ").strip().lower()
    except EOFError:
        answer = ""

    return answer == "y"


# ---------------------------------------------------------------------------
# ドライラン
# ---------------------------------------------------------------------------


def print_dry_run_summary(data: dict[str, list[dict[str, Any]]]) -> None:
    """--dry-run 時の投入予定件数サマリーを表示する。"""
    unresolved = _get_unresolved_machine_names(data)

    print("\n📋 ドライラン: 投入予定件数（DB への書き込みは行いません）")
    print(f"  equipment_groups        : {len(data['equipment_groups'])} 件 (UPSERT)")
    print(f"  equipments              : {len(data['equipments'])} 件 (UPSERT)")
    print(
        f"  equipment_group_members : {len(data['equipment_group_members'])} 件 (UPSERT)"
    )
    print(f"  products                : {len(data['products'])} 件 (重複はスキップ)")
    print(f"  process_routings        : {len(data['processes'])} 件 (UPSERT)")

    if unresolved:
        print(
            f"\n⚠️  未解決 machine_name ({len(unresolved)} 件) → equipment_group_id = NULL で登録:"
        )
        for name in unresolved:
            count = sum(
                1 for row in data["processes"] if row.get("machine_name") == name
            )
            print(f"    - '{name}' ({count} 件)")

    print(
        "\n✅ ドライラン完了。実際に投入するには --dry-run を外して実行してください。"
    )


# ---------------------------------------------------------------------------
# 各テーブルへのインポート処理
# ---------------------------------------------------------------------------


def import_equipment_groups(client: Client, tenant_id: str) -> dict[str, int]:
    """
    equipment_groups.json を equipment_groups テーブルに登録する。

    Returns:
        group_name -> group_id のマッピング辞書
    """
    print("\n📦 Importing equipment_groups...")
    data = load_json("equipment_groups.json")
    group_map: dict[str, int] = {}

    for row in data:
        name: str = row["name"]
        res = (
            client.table("equipment_groups")
            .upsert(
                {"name": name, "tenant_id": tenant_id}, on_conflict="tenant_id, name"
            )
            .execute()
        )
        group_id: int = res.data[0]["id"]  # type: ignore
        group_map[name] = group_id
        print(f"  ✓ {name} (ID: {group_id})")

    print(f"✅ {len(group_map)} equipment_groups imported")
    return group_map


def import_equipments(client: Client, tenant_id: str) -> dict[str, int]:
    """
    equipments.json を equipments テーブルに登録する。

    Returns:
        equipment_name -> equipment_id のマッピング辞書
    """
    print("\n📦 Importing equipments...")
    data = load_json("equipments.json")
    equipment_map: dict[str, int] = {}

    for row in data:
        name: str = row["name"]
        res = (
            client.table("equipments")
            .upsert(
                {"name": name, "tenant_id": tenant_id}, on_conflict="tenant_id, name"
            )
            .execute()
        )
        eq_id: int = res.data[0]["id"]  # type: ignore
        equipment_map[name] = eq_id
        print(f"  ✓ {name} (ID: {eq_id})")

    print(f"✅ {len(equipment_map)} equipments imported")
    return equipment_map


def import_equipment_group_members(
    client: Client,
    tenant_id: str,
    group_map: dict[str, int],
    equipment_map: dict[str, int],
) -> None:
    """
    equipment_group_members.json を equipment_group_members テーブルに登録する。

    equipment_name / equipment_group_name でIDを解決する。
    どちらかの名前が未登録の場合は警告を出してスキップする。
    """
    print("\n📦 Importing equipment_group_members...")
    data = load_json("equipment_group_members.json")
    ok = skip = 0

    for row in data:
        eq_name: str = row["equipment_name"]
        grp_name: str = row["equipment_group_name"]

        if grp_name not in group_map:
            print(f"  ⚠️  Group not found: '{grp_name}', skipping")
            skip += 1
            continue
        if eq_name not in equipment_map:
            print(f"  ⚠️  Equipment not found: '{eq_name}', skipping")
            skip += 1
            continue

        client.table("equipment_group_members").upsert(
            {
                "equipment_group_id": group_map[grp_name],
                "equipment_id": equipment_map[eq_name],
                "tenant_id": tenant_id,
            },
            on_conflict="equipment_group_id, equipment_id",
        ).execute()
        print(f"  ✓ {eq_name} → {grp_name}")
        ok += 1

    print(f"✅ {ok} members imported, {skip} skipped")


def import_products(client: Client, tenant_id: str) -> dict[str, int]:
    """
    products.json を products テーブルに登録し、product_name → supabase_id のマップを返す。

    - code が空文字の場合は NULL に変換する（UNIQUE制約回避）
    - 同名の製品が既にテナント内に存在する場合はスキップし、既存IDを使用する

    Returns:
        product_name -> supabase product_id のマッピング辞書
    """
    print("\n📦 Importing products...")
    data = load_json("products.json")

    # 既存製品を名前でキャッシュ（冪等性のため）
    existing_res = (
        client.table("products").select("id, name").eq("tenant_id", tenant_id).execute()
    )
    product_map: dict[str, int] = {
        row["name"]: row["id"] for row in (existing_res.data or [])
    }

    ok = skip = 0

    for row in data:
        name: str = row["name"]
        code: str | None = row.get("code") or None  # 空文字 → None
        product_type: str | None = row.get("type") or None

        if name in product_map:
            skip += 1
            continue

        res = (
            client.table("products")
            .insert(
                {
                    "name": name,
                    "code": code,
                    "type": product_type,
                    "tenant_id": tenant_id,
                }
            )
            .execute()
        )
        supabase_id: int = res.data[0]["id"]  # type: ignore
        product_map[name] = supabase_id
        print(f"  ✓ {name} (ID: {supabase_id})")
        ok += 1

    print(f"✅ {ok} products inserted, {skip} already existed")
    return product_map


def import_process_routings(
    client: Client,
    tenant_id: str,
    product_map: dict[str, int],
    group_map: dict[str, int],
) -> None:
    """
    processes.json を process_routings テーブルに登録する。

    - product_id は product_name → product_map で解決する
    - equipment_group_id は machine_name → group_map で解決する
      (machine_name が空文字または未登録の場合は NULL)
    - unit_time_seconds が未設定または 0 の場合は 0.0 を使用する
    """
    print("\n📦 Importing process_routings...")
    data = load_json("processes.json")
    ok = skip = 0

    for row in data:
        product_name = row.get("product_name", "")
        if not product_name:
            print(f"  ⚠️  product_name が空のためスキップ: {row}")
            skip += 1
            continue

        if product_name not in product_map:
            print(f"  ⚠️  product_name='{product_name}' が未登録、スキップ")
            skip += 1
            continue

        supabase_product_id = product_map[product_name]

        machine_name = row.get("machine_name", "")
        equipment_group_id: int | None = (
            group_map.get(machine_name) if machine_name else None
        )

        unit_time = float(row.get("unit_time_seconds") or 0.0)
        sequence_order = int(row["sequence_order"])

        client.table("process_routings").upsert(
            {
                "product_id": supabase_product_id,
                "sequence_order": sequence_order,
                "process_name": row.get("process_name"),
                "equipment_group_id": equipment_group_id,
                "setup_time_seconds": 0,
                "unit_time_seconds": unit_time,
                "tenant_id": tenant_id,
            },
            on_conflict="product_id, sequence_order",
        ).execute()
        print(
            f"  ✓ '{product_name}' seq={sequence_order} "
            f"'{row.get('process_name')}' machine='{machine_name or '(なし)'}'"
        )
        ok += 1

    print(f"✅ {ok} process_routings imported, {skip} skipped")


# ---------------------------------------------------------------------------
# メイン
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="_data/*.json からデータを Supabase へ投入する"
    )
    parser.add_argument(
        "--env-file",
        default=None,
        help="読み込む .env ファイルのパス（省略時は scripts/.env）",
    )
    parser.add_argument(
        "--tenant-id",
        default=None,
        help="投入先テナント UUID（省略時は TEST_TENANT_ID 環境変数を使用）",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="DB への書き込みをスキップし、投入予定件数をプレビュー表示する",
    )
    parser.add_argument(
        "--skip-validation",
        action="store_true",
        help="machine_name の事前バリデーション確認をスキップして続行する",
    )
    args = parser.parse_args()

    env_path = (
        args.env_file
        if args.env_file
        else os.path.join(os.path.dirname(__file__), "..", ".env")
    )
    load_dotenv(dotenv_path=env_path, override=True)

    print("=" * 60)
    print("🚀 migrate_from_json: _data/*.json → Supabase")
    print("=" * 60)

    data = load_all_data()

    # 事前バリデーション（--dry-run 時も実行）
    if not preflight_validation(data, skip=args.skip_validation):
        print("中止しました。")
        sys.exit(0)

    if args.dry_run:
        print_dry_run_summary(data)
        return

    client, tenant_id = init_client(args.tenant_id)

    group_map = import_equipment_groups(client, tenant_id)
    equipment_map = import_equipments(client, tenant_id)
    import_equipment_group_members(client, tenant_id, group_map, equipment_map)
    product_map = import_products(client, tenant_id)
    import_process_routings(client, tenant_id, product_map, group_map)

    print("\n" + "=" * 60)
    print("✅ Migration completed!")
    print("=" * 60)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)
