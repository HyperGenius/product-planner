"""
日報取り込みエージェント用のトークンを発行・一覧・失効する CLI スクリプト (Issue #469)。

平文トークンは issue 実行時に1回だけ表示する。DB (agent_tokens.token_hash) には
SHA-256 ハッシュだけを保存するため、紛失した場合は再表示できない。revoke して
新しいトークンを issue し直すこと。

Usage:
    python scripts/issue_agent_token.py issue --tenant-id <uuid> --name "工場1F 共有PC"
    python scripts/issue_agent_token.py list --tenant-id <uuid>
    python scripts/issue_agent_token.py revoke --token-id <uuid>
"""

import argparse
import os
import sys
import uuid
from datetime import UTC, datetime
from typing import Any, cast

from dotenv import load_dotenv

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from app.services.agent_token_service import (  # noqa: E402
    generate_agent_token,
    hash_agent_token,
)

from supabase import Client, create_client  # noqa: E402

_LIST_COLUMNS = "id, name, created_at, last_used_at, revoked_at"


class AgentTokenCliError(Exception):
    """CLI の利用者に表示するエラー（スタックトレースを出さずに終了する）。"""


def _validate_uuid(value: str, label: str) -> None:
    """UUID 形式でない値を DB に投げる前に弾く（Postgres の 22P02 を避ける）。"""
    try:
        uuid.UUID(value)
    except ValueError as e:
        raise AgentTokenCliError(f"{label} が UUID 形式ではありません: {value}") from e


def _get_admin_client() -> Client:
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


def issue_token(admin_client: Client, tenant_id: str, name: str) -> tuple[str, dict]:
    """トークンを発行し、(平文トークン, 保存した行) を返す。DB にはハッシュのみ保存する。"""
    _validate_uuid(tenant_id, "テナント ID")
    tenant_res = (
        admin_client.table("tenants").select("id").eq("id", tenant_id).execute()
    )
    if not tenant_res.data:
        raise AgentTokenCliError(f"テナントが見つかりません: {tenant_id}")

    token = generate_agent_token()
    insert_res = (
        admin_client.table("agent_tokens")
        .insert(
            {
                "tenant_id": tenant_id,
                "name": name,
                "token_hash": hash_agent_token(token),
            }
        )
        .execute()
    )
    row = cast(list[dict[str, Any]], insert_res.data)[0]
    return token, row


def list_tokens(admin_client: Client, tenant_id: str) -> list[dict]:
    """テナントのトークン一覧を返す（token_hash は取得しない）。"""
    _validate_uuid(tenant_id, "テナント ID")
    res = (
        admin_client.table("agent_tokens")
        .select(_LIST_COLUMNS)
        .eq("tenant_id", tenant_id)
        .order("created_at", desc=True)
        .execute()
    )
    return cast(list[dict[str, Any]], res.data or [])


def revoke_token(admin_client: Client, token_id: str) -> dict:
    """トークンを失効させ、更新後の行を返す。"""
    _validate_uuid(token_id, "トークン ID")
    res = (
        admin_client.table("agent_tokens")
        .update({"revoked_at": datetime.now(UTC).isoformat()})
        .eq("id", token_id)
        .is_("revoked_at", "null")
        .execute()
    )
    if res.data:
        return cast(list[dict[str, Any]], res.data)[0]

    # 更新0件: 存在しないのか、既に失効済みなのかを区別して伝える
    existing = (
        admin_client.table("agent_tokens")
        .select("id, revoked_at")
        .eq("id", token_id)
        .execute()
    )
    if existing.data:
        revoked_at = cast(list[dict[str, Any]], existing.data)[0]["revoked_at"]
        raise AgentTokenCliError(f"既に失効済みです（revoked_at={revoked_at}）")
    raise AgentTokenCliError(f"トークンが見つかりません: {token_id}")


def _print_issued(token: str, row: dict) -> None:
    print("=== エージェントトークン発行完了 ===")
    print(f"トークン ID : {row['id']}")
    print(f"テナント ID : {row['tenant_id']}")
    print(f"名前       : {row['name']}")
    print(f"トークン    : {token}")
    print("==================================")
    print("※ トークンはこの画面でしか表示されません（DBにはハッシュのみ保存）。")
    print("  共有PCのエージェント設定に登録し、この出力は残さないでください。")


def _print_list(rows: list[dict]) -> None:
    if not rows:
        print("トークンはありません。")
        return
    for row in rows:
        state = "失効済み" if row.get("revoked_at") else "有効"
        print(
            f"{row['id']}  [{state}]  {row['name']}  "
            f"created_at={row['created_at']}  "
            f"last_used_at={row.get('last_used_at') or '-'}  "
            f"revoked_at={row.get('revoked_at') or '-'}"
        )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="日報取り込みエージェント用トークンを発行・一覧・失効する"
    )
    parser.add_argument(
        "--env-file",
        default=None,
        help="読み込む .env ファイルのパス（省略時は scripts/.env）",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    issue = sub.add_parser("issue", help="トークンを発行する")
    issue.add_argument("--tenant-id", required=True, help="発行先テナントの UUID")
    issue.add_argument(
        "--name", required=True, help="識別用の名前（設置場所など。例: 工場1F 共有PC）"
    )

    list_ = sub.add_parser("list", help="テナントのトークン一覧を表示する")
    list_.add_argument("--tenant-id", required=True, help="テナントの UUID")

    revoke = sub.add_parser("revoke", help="トークンを失効させる")
    revoke.add_argument("--token-id", required=True, help="失効させるトークンの ID")
    return parser


def main() -> None:
    args = _build_parser().parse_args()

    env_path = (
        args.env_file
        if args.env_file
        else os.path.join(os.path.dirname(__file__), ".env")
    )
    load_dotenv(dotenv_path=env_path, override=True)
    admin_client = _get_admin_client()

    try:
        if args.command == "issue":
            token, row = issue_token(admin_client, args.tenant_id, args.name)
            _print_issued(token, row)
        elif args.command == "list":
            _print_list(list_tokens(admin_client, args.tenant_id))
        elif args.command == "revoke":
            row = revoke_token(admin_client, args.token_id)
            print(f"失効しました: {row['id']}（revoked_at={row['revoked_at']}）")
    except AgentTokenCliError as e:
        print(f"エラー: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
