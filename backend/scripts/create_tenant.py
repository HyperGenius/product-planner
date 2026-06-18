"""
新規顧客テナントを本番 Supabase へ作成する CLI スクリプト。

Usage:
    python scripts/create_tenant.py \
        --company-name "株式会社〇〇" \
        --owner-email "xxx@example.com" \
        --owner-name "山田太郎"
"""

import argparse
import os
import secrets
import string
import sys

from dotenv import load_dotenv

from supabase import create_client

PASSWORD_LENGTH = 16
PASSWORD_ALPHABET = string.ascii_letters + string.digits + "!#$%&*+-=?@^_"


def _generate_password() -> str:
    while True:
        pwd = "".join(secrets.choice(PASSWORD_ALPHABET) for _ in range(PASSWORD_LENGTH))
        has_upper = any(c.isupper() for c in pwd)
        has_lower = any(c.islower() for c in pwd)
        has_digit = any(c.isdigit() for c in pwd)
        has_symbol = any(c in "!#$%&*+-=?@^_" for c in pwd)
        if has_upper and has_lower and has_digit and has_symbol:
            return pwd


def _get_admin_client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        missing = [
            v
            for v, val in [("SUPABASE_URL", url), ("SUPABASE_SERVICE_ROLE_KEY", key)]
            if not val
        ]
        print(
            f"エラー: 環境変数が設定されていません: {', '.join(missing)}",
            file=sys.stderr,
        )
        sys.exit(1)
    return create_client(url, key)


def create_tenant(company_name: str, owner_email: str, owner_name: str) -> None:
    admin_client = _get_admin_client()
    password = _generate_password()

    # Step 1: ユーザー作成（signup trigger が tenants + organization_members を自動作成）
    try:
        create_res = admin_client.auth.admin.create_user(
            {
                "email": owner_email,
                "password": password,
                "email_confirm": True,
                "user_metadata": {
                    "tenant_name": company_name,
                    "full_name": owner_name,
                },
            }
        )
        user = create_res.user
    except Exception as e:
        err_msg = str(e)
        if (
            "already been registered" in err_msg
            or "already exists" in err_msg
            or "duplicate" in err_msg.lower()
        ):
            print(
                f"エラー: メールアドレス {owner_email} は既に登録されています。",
                file=sys.stderr,
            )
        else:
            print(f"エラー: ユーザー作成に失敗しました: {err_msg}", file=sys.stderr)
        sys.exit(1)

    user_id = str(user.id)
    tenant_id: str | None = None

    # Step 2: profiles テーブルへ INSERT
    try:
        admin_client.table("profiles").upsert(
            {"id": user_id, "full_name": owner_name, "email": owner_email}
        ).execute()
    except Exception as e:
        # ロールバック: Auth ユーザー削除 → tenants レコード削除
        print(f"エラー: profiles の作成に失敗しました: {e}", file=sys.stderr)
        print("ロールバックを実行します...", file=sys.stderr)
        _rollback(admin_client, user_id, tenant_id)
        sys.exit(1)

    # Step 3: organization_members から tenant_id を取得
    try:
        res = (
            admin_client.table("organization_members")
            .select("tenant_id")
            .eq("user_id", user_id)
            .eq("role", "admin")
            .single()
            .execute()
        )
        tenant_id = res.data["tenant_id"]
    except Exception as e:
        print(f"エラー: テナント ID の取得に失敗しました: {e}", file=sys.stderr)
        print(f"  ユーザー ID: {user_id}", file=sys.stderr)
        print("Supabase Studio で手動確認してください。", file=sys.stderr)
        sys.exit(1)

    # 結果を stdout のみに表示
    print("=== テナント作成完了 ===")
    print(f"テナント名  : {company_name}")
    print(f"テナント ID : {tenant_id}")
    print(f"ユーザー ID : {user_id}")
    print(f"メール     : {owner_email}")
    print(f"初期パスワード: {password}")
    print("======================")
    print("※ 初期パスワードを安全に顧客へ伝達してください")


def _rollback(admin_client, user_id: str, tenant_id: str | None) -> None:
    errors = []

    try:
        admin_client.auth.admin.delete_user(user_id)
        print(f"  Auth ユーザーを削除しました: {user_id}", file=sys.stderr)
    except Exception as e:
        errors.append(f"Auth ユーザー削除失敗 (user_id={user_id}): {e}")

    if tenant_id:
        try:
            admin_client.table("tenants").delete().eq("id", tenant_id).execute()
            print(f"  tenants レコードを削除しました: {tenant_id}", file=sys.stderr)
        except Exception as e:
            errors.append(f"tenants 削除失敗 (tenant_id={tenant_id}): {e}")

    if errors:
        print("ロールバックが一部失敗しました。手動対応が必要です:", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        if user_id:
            print(f"  ユーザー ID: {user_id}", file=sys.stderr)
        if tenant_id:
            print(f"  テナント ID: {tenant_id}", file=sys.stderr)
    else:
        print("ロールバック完了。", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="新規顧客テナントを Supabase へ作成する"
    )
    parser.add_argument("--company-name", required=True, help="会社名（テナント名）")
    parser.add_argument("--owner-email", required=True, help="オーナーのメールアドレス")
    parser.add_argument("--owner-name", required=True, help="オーナーの氏名")
    parser.add_argument(
        "--env-file",
        default=None,
        help="読み込む .env ファイルのパス（省略時は scripts/.env）",
    )
    args = parser.parse_args()

    env_path = (
        args.env_file
        if args.env_file
        else os.path.join(os.path.dirname(__file__), ".env")
    )
    load_dotenv(dotenv_path=env_path, override=True)

    create_tenant(
        company_name=args.company_name,
        owner_email=args.owner_email,
        owner_name=args.owner_name,
    )


if __name__ == "__main__":
    main()
