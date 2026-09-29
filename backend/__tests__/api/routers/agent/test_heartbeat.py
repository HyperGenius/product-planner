# __tests__/api/routers/agent/test_heartbeat.py
from unittest.mock import MagicMock

import pytest
from app.dependencies import get_supabase_admin_client
from app.main import app
from app.services.agent_token_service import hash_agent_token
from fastapi.testclient import TestClient

client = TestClient(app)

URL = "/api/agent/heartbeat"
VALID_TOKEN = "valid-agent-token-abc123"
TOKEN_TENANT_ID = "11111111-1111-1111-1111-111111111111"
OTHER_TENANT_ID = "22222222-2222-2222-2222-222222222222"
AGENT_TOKEN_ID = "33333333-3333-3333-3333-333333333333"

UNAUTHORIZED_DETAIL = "Invalid agent token."


def _auth(token: str = VALID_TOKEN) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class _AdminClientMock:
    """テーブル名ごとに別の MagicMock を返す admin client のモック。"""

    def __init__(self) -> None:
        self.client = MagicMock()
        self.tables: dict[str, MagicMock] = {}
        self.client.table.side_effect = self._table

    def _table(self, name: str) -> MagicMock:
        return self.tables.setdefault(name, MagicMock())

    def table(self, name: str) -> MagicMock:
        return self._table(name)

    def set_token(self, *, revoked_at: str | None = None, found: bool = True) -> None:
        """agent_tokens の token_hash 検索チェーンのモックを設定する。"""
        data = (
            {
                "id": AGENT_TOKEN_ID,
                "tenant_id": TOKEN_TENANT_ID,
                "revoked_at": revoked_at,
            }
            if found
            else None
        )
        self.table(
            "agent_tokens"
        ).select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = data

    def inserted_heartbeat(self) -> dict:
        insert = self.table("agent_heartbeats").insert
        insert.assert_called_once()
        return insert.call_args.args[0]


@pytest.mark.api
class TestAgentHeartbeat:
    @pytest.fixture
    def admin(self):
        return _AdminClientMock()

    @pytest.fixture(autouse=True)
    def override_dependency(self, admin):
        app.dependency_overrides[get_supabase_admin_client] = lambda: admin.client
        yield
        app.dependency_overrides = {}

    # ------------------------------------------------------------------
    # 正常系
    # ------------------------------------------------------------------

    def test_valid_token_records_heartbeat_for_token_tenant(self, admin):
        admin.set_token()

        response = client.post(
            URL,
            headers=_auth(),
            json={
                "scanned_count": 12,
                "sent_count": 3,
                "duplicate_count": 8,
                "error_count": 1,
                "agent_version": "0.1.0",
            },
        )

        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
        row = admin.inserted_heartbeat()
        assert row == {
            "tenant_id": TOKEN_TENANT_ID,
            "agent_token_id": AGENT_TOKEN_ID,
            "scanned_count": 12,
            "sent_count": 3,
            "duplicate_count": 8,
            "error_count": 1,
            "agent_version": "0.1.0",
            "payload": {},
        }

    def test_token_is_looked_up_by_hash_not_plaintext(self, admin):
        admin.set_token()

        client.post(URL, headers=_auth(), json={})

        admin.table("agent_tokens").select.return_value.eq.assert_called_once_with(
            "token_hash", hash_agent_token(VALID_TOKEN)
        )

    def test_unknown_fields_are_saved_to_payload(self, admin):
        admin.set_token()

        response = client.post(
            URL,
            headers=_auth(),
            json={
                "sent_count": 1,
                "hostname": "SHARED-PC-01",
                "started_at": "2026-09-29T09:00:00+09:00",
                "errors": [{"path": "a.xlsx", "message": "locked"}],
            },
        )

        assert response.status_code == 200
        assert admin.inserted_heartbeat()["payload"] == {
            "hostname": "SHARED-PC-01",
            "started_at": "2026-09-29T09:00:00+09:00",
            "errors": [{"path": "a.xlsx", "message": "locked"}],
        }

    def test_empty_body_uses_default_counts(self, admin):
        admin.set_token()

        response = client.post(URL, headers=_auth(), json={})

        assert response.status_code == 200
        row = admin.inserted_heartbeat()
        assert row["scanned_count"] == 0
        assert row["error_count"] == 0
        assert row["agent_version"] is None

    def test_updates_last_used_at_on_success(self, admin):
        admin.set_token()

        client.post(URL, headers=_auth(), json={})

        tokens = admin.table("agent_tokens")
        tokens.update.assert_called_once()
        assert "last_used_at" in tokens.update.call_args.args[0]
        tokens.update.return_value.eq.assert_called_once_with("id", AGENT_TOKEN_ID)
        tokens.update.return_value.eq.return_value.eq.assert_called_once_with(
            "tenant_id", TOKEN_TENANT_ID
        )

    def test_last_used_at_update_failure_does_not_block_heartbeat(self, admin):
        admin.set_token()
        admin.table(
            "agent_tokens"
        ).update.return_value.eq.return_value.eq.return_value.execute.side_effect = (
            RuntimeError("db down")
        )

        response = client.post(URL, headers=_auth(), json={})

        assert response.status_code == 200
        admin.inserted_heartbeat()

    # ------------------------------------------------------------------
    # テナント分離: リクエスト由来の tenant_id は無視する
    # ------------------------------------------------------------------

    def test_tenant_id_in_body_header_query_is_ignored(self, admin):
        admin.set_token()

        response = client.post(
            f"{URL}?tenant_id={OTHER_TENANT_ID}",
            headers={**_auth(), "x-tenant-id": OTHER_TENANT_ID},
            json={
                "tenant_id": OTHER_TENANT_ID,
                "agent_token_id": "44444444-4444-4444-4444-444444444444",
                "sent_count": 1,
            },
        )

        assert response.status_code == 200
        row = admin.inserted_heartbeat()
        assert row["tenant_id"] == TOKEN_TENANT_ID
        assert row["agent_token_id"] == AGENT_TOKEN_ID
        assert "tenant_id" not in row["payload"]
        assert "agent_token_id" not in row["payload"]

    # ------------------------------------------------------------------
    # 認証エラー（すべて 401・固定文言）
    # ------------------------------------------------------------------

    @pytest.mark.parametrize(
        "headers",
        [
            {},
            {"Authorization": ""},
            {"Authorization": VALID_TOKEN},
            {"Authorization": f"Basic {VALID_TOKEN}"},
            {"Authorization": "Bearer "},
        ],
        ids=["missing", "empty", "no-scheme", "basic-scheme", "empty-token"],
    )
    def test_malformed_authorization_returns_401(self, admin, headers):
        admin.set_token()

        response = client.post(URL, headers=headers, json={})

        assert response.status_code == 401
        assert response.json() == {"detail": UNAUTHORIZED_DETAIL}
        admin.table("agent_heartbeats").insert.assert_not_called()

    def test_unknown_token_returns_401(self, admin):
        admin.set_token(found=False)

        response = client.post(URL, headers=_auth("unknown-token"), json={})

        assert response.status_code == 401
        assert response.json() == {"detail": UNAUTHORIZED_DETAIL}
        admin.table("agent_heartbeats").insert.assert_not_called()

    def test_maybe_single_returning_none_returns_401(self, admin):
        # supabase-py のバージョンによっては該当なしで execute() が None を返す
        admin.table(
            "agent_tokens"
        ).select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = None

        response = client.post(URL, headers=_auth(), json={})

        assert response.status_code == 401
        assert response.json() == {"detail": UNAUTHORIZED_DETAIL}

    def test_revoked_token_returns_same_401_as_unknown(self, admin):
        admin.set_token(revoked_at="2026-09-01T00:00:00+00:00")

        response = client.post(URL, headers=_auth(), json={})

        assert response.status_code == 401
        assert response.json() == {"detail": UNAUTHORIZED_DETAIL}
        admin.table("agent_tokens").update.assert_not_called()
        admin.table("agent_heartbeats").insert.assert_not_called()

    def test_token_lookup_db_error_returns_fixed_message(self, admin):
        admin.table(
            "agent_tokens"
        ).select.return_value.eq.return_value.maybe_single.return_value.execute.side_effect = RuntimeError(
            "connection refused: secret-internal-host"
        )

        response = client.post(URL, headers=_auth(), json={})

        assert response.status_code == 500
        assert "secret-internal-host" not in response.text
        admin.table("agent_heartbeats").insert.assert_not_called()

    # ------------------------------------------------------------------
    # バリデーション・DB エラー
    # ------------------------------------------------------------------

    def test_negative_count_returns_422(self, admin):
        admin.set_token()

        response = client.post(URL, headers=_auth(), json={"sent_count": -1})

        assert response.status_code == 422
        admin.table("agent_heartbeats").insert.assert_not_called()

    def test_insert_db_error_returns_fixed_message(self, admin):
        admin.set_token()
        admin.table(
            "agent_heartbeats"
        ).insert.return_value.execute.side_effect = RuntimeError(
            'violates check constraint "agent_heartbeats_sent_count_check"'
        )

        response = client.post(URL, headers=_auth(), json={})

        assert response.status_code == 500
        assert response.json() == {"detail": "Failed to record heartbeat."}
        assert "check constraint" not in response.text
