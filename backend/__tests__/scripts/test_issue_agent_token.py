"""
issue_agent_token.py のユニットテスト (Issue #469)

Supabase クライアントはモックし、DB には平文トークンを渡さずハッシュだけを
保存すること・失効処理の分岐を検証する。実DBでの RLS 等は
__tests__/integration/test_daily_report_agent_rls.py で検証する。
"""

import sys
import uuid
from pathlib import Path
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.services.agent_token_service import hash_agent_token
from scripts.issue_agent_token import (
    AgentTokenCliError,
    issue_token,
    list_tokens,
    revoke_token,
)

TENANT_ID = str(uuid.uuid4())
TOKEN_ID = str(uuid.uuid4())


def _admin_client_for_issue(tenant_exists: bool = True) -> MagicMock:
    admin_client = MagicMock()
    tenants_table = MagicMock()
    tenants_table.select.return_value.eq.return_value.execute.return_value.data = (
        [{"id": TENANT_ID}] if tenant_exists else []
    )
    tokens_table = MagicMock()

    def _insert(payload):
        tokens_table.inserted = payload
        chain = MagicMock()
        chain.execute.return_value.data = [
            {"id": TOKEN_ID, "created_at": "2026-09-29T00:00:00+00:00", **payload}
        ]
        return chain

    tokens_table.insert.side_effect = _insert
    admin_client.table.side_effect = lambda name: {
        "tenants": tenants_table,
        "agent_tokens": tokens_table,
    }[name]
    admin_client.tokens_table = tokens_table
    return admin_client


class TestIssueToken:
    def test_stores_only_hash_not_plaintext(self):
        admin_client = _admin_client_for_issue()

        token, row = issue_token(admin_client, TENANT_ID, "工場1F 共有PC")

        inserted = admin_client.tokens_table.inserted
        assert inserted["token_hash"] == hash_agent_token(token)
        assert token not in inserted.values()
        assert inserted["tenant_id"] == TENANT_ID
        assert inserted["name"] == "工場1F 共有PC"
        assert row["id"] == TOKEN_ID

    def test_unknown_tenant_raises(self):
        admin_client = _admin_client_for_issue(tenant_exists=False)

        with pytest.raises(AgentTokenCliError, match="テナントが見つかりません"):
            issue_token(admin_client, TENANT_ID, "PC")
        admin_client.tokens_table.insert.assert_not_called()

    def test_invalid_tenant_id_raises_before_db_access(self):
        admin_client = MagicMock()

        with pytest.raises(AgentTokenCliError, match="UUID 形式ではありません"):
            issue_token(admin_client, "not-a-uuid", "PC")
        admin_client.table.assert_not_called()


class TestListTokens:
    def test_does_not_select_token_hash(self):
        admin_client = MagicMock()
        chain = admin_client.table.return_value.select.return_value
        chain.eq.return_value.order.return_value.execute.return_value.data = []

        assert list_tokens(admin_client, TENANT_ID) == []
        selected = admin_client.table.return_value.select.call_args.args[0]
        assert "token_hash" not in selected
        chain.eq.assert_called_once_with("tenant_id", TENANT_ID)


class TestRevokeToken:
    def _update_chain(self, admin_client: MagicMock) -> MagicMock:
        return admin_client.table.return_value.update.return_value.eq.return_value.is_.return_value

    def test_revokes_active_token(self):
        admin_client = MagicMock()
        self._update_chain(admin_client).execute.return_value.data = [
            {"id": TOKEN_ID, "revoked_at": "2026-09-29T00:00:00+00:00"}
        ]

        row = revoke_token(admin_client, TOKEN_ID)

        assert row["id"] == TOKEN_ID
        update_payload = admin_client.table.return_value.update.call_args.args[0]
        assert update_payload["revoked_at"]
        admin_client.table.return_value.update.return_value.eq.return_value.is_.assert_called_once_with(
            "revoked_at", "null"
        )

    def test_already_revoked_raises(self):
        admin_client = MagicMock()
        self._update_chain(admin_client).execute.return_value.data = []
        admin_client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": TOKEN_ID, "revoked_at": "2026-09-01T00:00:00+00:00"}
        ]

        with pytest.raises(AgentTokenCliError, match="既に失効済み"):
            revoke_token(admin_client, TOKEN_ID)

    def test_unknown_token_raises(self):
        admin_client = MagicMock()
        self._update_chain(admin_client).execute.return_value.data = []
        admin_client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []

        with pytest.raises(AgentTokenCliError, match="見つかりません"):
            revoke_token(admin_client, TOKEN_ID)
