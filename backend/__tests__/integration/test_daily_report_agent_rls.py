"""
Integration テスト: 日報取り込みエージェントの DB・Storage 基盤 (Issue #469)

以下は実際の Postgres (RLS込み) でしか検証できないため integration tier に置く。
- agent_tokens / daily_report_files / agent_heartbeats の RLS
  （書き込みは service role 限定、agent_tokens はユーザーJWTから参照不可、
  他2テーブルは所属テナントの行のみ SELECT 可）
- daily_report_files の UNIQUE (tenant_id, sha256)
- private バケット daily-reports の作成
- issue_agent_token.py が実DBにハッシュのみを保存すること
- store_daily_report() の重複排除（実 Storage の既存オブジェクトエラーの扱い。Issue #471）

実行:
  supabase start
  cd backend && pytest __tests__/integration/test_daily_report_agent_rls.py -v --run-integration
"""

import hashlib
import sys
import uuid
from pathlib import Path
from typing import Any, cast

import pytest
from app.services.agent_token_service import hash_agent_token
from app.services.daily_report_service import (
    DAILY_REPORT_BUCKET,
    build_storage_path,
    store_daily_report,
)
from postgrest.exceptions import APIError

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.issue_agent_token import issue_token  # noqa: E402


def _sha256(label: str) -> str:
    return hashlib.sha256(f"{label}-{uuid.uuid4()}".encode()).hexdigest()


def _insert_token(admin_db, tenant_id: str) -> str:
    res = (
        admin_db.table("agent_tokens")
        .insert(
            {
                "tenant_id": tenant_id,
                "name": "integration test agent",
                "token_hash": hash_agent_token(str(uuid.uuid4())),
            }
        )
        .execute()
    )
    return cast(list[dict[str, Any]], res.data)[0]["id"]


def _file_row(tenant_id: str, token_id: str, sha256: str) -> dict[str, Any]:
    return {
        "tenant_id": tenant_id,
        "agent_token_id": token_id,
        "sha256": sha256,
        "storage_path": f"{tenant_id}/{sha256}",
        "original_path": r"\\fileserver\日報\2026-09\日報_0929.xlsx",
        "file_name": "日報_0929.xlsx",
        "size_bytes": 1024,
    }


def _heartbeat_row(tenant_id: str, token_id: str) -> dict[str, Any]:
    return {
        "tenant_id": tenant_id,
        "agent_token_id": token_id,
        "scanned_count": 3,
        "sent_count": 1,
        "payload": {"note": "integration test"},
    }


@pytest.fixture()
def agent_tenants(admin_db, auth_user_id):
    """ログインユーザーが所属する own テナントと、所属しない other テナントを作る。"""
    own = (
        admin_db.table("tenants")
        .insert({"name": "integration test daily report tenant (own)"})
        .execute()
    )
    own_id = cast(list[dict[str, Any]], own.data)[0]["id"]
    other = (
        admin_db.table("tenants")
        .insert({"name": "integration test daily report tenant (other)"})
        .execute()
    )
    other_id = cast(list[dict[str, Any]], other.data)[0]["id"]

    admin_db.table("organization_members").insert(
        {"user_id": auth_user_id, "tenant_id": own_id}
    ).execute()

    yield {
        "own_id": own_id,
        "other_id": other_id,
        "own_token_id": _insert_token(admin_db, own_id),
        "other_token_id": _insert_token(admin_db, other_id),
    }

    # 外部キーの向きに合わせ、子 (files/heartbeats) → agent_tokens → tenants の順に消す
    for tenant in (own_id, other_id):
        admin_db.table("daily_report_files").delete().eq("tenant_id", tenant).execute()
        admin_db.table("agent_heartbeats").delete().eq("tenant_id", tenant).execute()
        admin_db.table("agent_tokens").delete().eq("tenant_id", tenant).execute()
    admin_db.table("organization_members").delete().eq("user_id", auth_user_id).eq(
        "tenant_id", own_id
    ).execute()
    admin_db.table("tenants").delete().eq("id", own_id).execute()
    admin_db.table("tenants").delete().eq("id", other_id).execute()


@pytest.mark.integration
class TestAgentTokensRls:
    def test_user_jwt_cannot_read_agent_tokens(
        self, real_supabase_client, agent_tenants
    ):
        """agent_tokens にはポリシーが無いため、所属テナントの行でも見えない"""
        res = (
            real_supabase_client.table("agent_tokens")
            .select("id, token_hash")
            .eq("tenant_id", agent_tenants["own_id"])
            .execute()
        )
        assert res.data == []

    def test_user_jwt_cannot_insert_agent_token(
        self, real_supabase_client, agent_tenants
    ):
        with pytest.raises(APIError):
            real_supabase_client.table("agent_tokens").insert(
                {
                    "tenant_id": agent_tenants["own_id"],
                    "name": "spy",
                    "token_hash": hash_agent_token("spy-token"),
                }
            ).execute()

    def test_user_jwt_cannot_revoke_agent_token(
        self, real_supabase_client, admin_db, agent_tenants
    ):
        res = (
            real_supabase_client.table("agent_tokens")
            .update({"revoked_at": "2026-01-01T00:00:00Z"})
            .eq("id", agent_tenants["own_token_id"])
            .execute()
        )
        assert res.data == []
        row = (
            admin_db.table("agent_tokens")
            .select("revoked_at")
            .eq("id", agent_tenants["own_token_id"])
            .single()
            .execute()
            .data
        )
        assert row["revoked_at"] is None

    def test_token_hash_must_be_sha256_hex(self, admin_db, agent_tenants):
        """平文トークンを誤って token_hash に入れても CHECK 制約で弾かれる"""
        with pytest.raises(APIError):
            admin_db.table("agent_tokens").insert(
                {
                    "tenant_id": agent_tenants["own_id"],
                    "name": "plaintext",
                    "token_hash": "plaintext-token-value",
                }
            ).execute()

    def test_issue_token_script_stores_only_hash(self, admin_db, agent_tenants):
        token, row = issue_token(admin_db, agent_tenants["own_id"], "CLI test")

        stored = (
            admin_db.table("agent_tokens")
            .select("token_hash, revoked_at")
            .eq("id", row["id"])
            .single()
            .execute()
            .data
        )
        assert stored["token_hash"] == hash_agent_token(token)
        assert stored["token_hash"] != token
        assert stored["revoked_at"] is None


@pytest.mark.integration
class TestDailyReportFilesRls:
    def test_user_jwt_cannot_insert(self, real_supabase_client, agent_tenants):
        with pytest.raises(APIError):
            real_supabase_client.table("daily_report_files").insert(
                _file_row(
                    agent_tenants["own_id"],
                    agent_tenants["own_token_id"],
                    _sha256("spy"),
                )
            ).execute()

    def test_member_sees_only_own_tenant_rows(
        self, real_supabase_client, admin_db, agent_tenants
    ):
        own_sha = _sha256("own")
        other_sha = _sha256("other")
        admin_db.table("daily_report_files").insert(
            _file_row(agent_tenants["own_id"], agent_tenants["own_token_id"], own_sha)
        ).execute()
        admin_db.table("daily_report_files").insert(
            _file_row(
                agent_tenants["other_id"], agent_tenants["other_token_id"], other_sha
            )
        ).execute()

        res = (
            real_supabase_client.table("daily_report_files")
            .select("sha256")
            .in_("sha256", [own_sha, other_sha])
            .execute()
        )
        assert [r["sha256"] for r in cast(list[dict[str, Any]], res.data)] == [own_sha]

    def test_same_sha256_in_same_tenant_is_rejected(self, admin_db, agent_tenants):
        sha = _sha256("dup")
        row = _file_row(agent_tenants["own_id"], agent_tenants["own_token_id"], sha)
        admin_db.table("daily_report_files").insert(row).execute()

        with pytest.raises(APIError) as exc_info:
            admin_db.table("daily_report_files").insert(row).execute()
        assert exc_info.value.code == "23505"

    def test_same_sha256_in_other_tenant_is_allowed(self, admin_db, agent_tenants):
        sha = _sha256("cross-tenant")
        admin_db.table("daily_report_files").insert(
            _file_row(agent_tenants["own_id"], agent_tenants["own_token_id"], sha)
        ).execute()
        admin_db.table("daily_report_files").insert(
            _file_row(agent_tenants["other_id"], agent_tenants["other_token_id"], sha)
        ).execute()


@pytest.mark.integration
class TestAgentHeartbeatsRls:
    def test_user_jwt_cannot_insert(self, real_supabase_client, agent_tenants):
        with pytest.raises(APIError):
            real_supabase_client.table("agent_heartbeats").insert(
                _heartbeat_row(agent_tenants["own_id"], agent_tenants["own_token_id"])
            ).execute()

    def test_member_sees_only_own_tenant_rows(
        self, real_supabase_client, admin_db, agent_tenants
    ):
        admin_db.table("agent_heartbeats").insert(
            _heartbeat_row(agent_tenants["own_id"], agent_tenants["own_token_id"])
        ).execute()
        admin_db.table("agent_heartbeats").insert(
            _heartbeat_row(agent_tenants["other_id"], agent_tenants["other_token_id"])
        ).execute()

        res = (
            real_supabase_client.table("agent_heartbeats")
            .select("tenant_id")
            .in_("tenant_id", [agent_tenants["own_id"], agent_tenants["other_id"]])
            .execute()
        )
        assert [r["tenant_id"] for r in cast(list[dict[str, Any]], res.data)] == [
            agent_tenants["own_id"]
        ]


@pytest.mark.integration
class TestDailyReportsBucket:
    def test_bucket_is_private_with_size_limit(self, admin_db):
        bucket = admin_db.storage.get_bucket("daily-reports")
        assert bucket.public is False
        assert bucket.file_size_limit == 20 * 1024 * 1024


@pytest.mark.integration
class TestStoreDailyReport:
    """store_daily_report() を実 Storage・実DBに対して動かす (Issue #471)。

    Storage の「既存オブジェクトへの upsert=false アップロード」が返すエラーの形は
    モックでは検証できないため、ここで実際の挙動を確認する。
    """

    @pytest.fixture()
    def content(self, admin_db, agent_tenants):
        content = f"daily report {uuid.uuid4()}".encode()
        sha = hashlib.sha256(content).hexdigest()
        yield content, sha
        admin_db.storage.from_(DAILY_REPORT_BUCKET).remove(
            [build_storage_path(agent_tenants["own_id"], sha)]
        )

    def _store(self, admin_db, agent_tenants, content: bytes, sha: str) -> str:
        return store_daily_report(
            admin_db,
            tenant_id=agent_tenants["own_id"],
            agent_token_id=agent_tenants["own_token_id"],
            sha256=sha,
            content=content,
            original_path=r"\\fileserver\日報\日報_0929.xlsx",
            file_name="日報_0929.xlsx",
            file_modified_at=None,
        )

    def _rows(self, admin_db, tenant_id: str, sha: str) -> list[dict[str, Any]]:
        res = (
            admin_db.table("daily_report_files")
            .select("storage_path, size_bytes")
            .eq("tenant_id", tenant_id)
            .eq("sha256", sha)
            .execute()
        )
        return cast(list[dict[str, Any]], res.data)

    def test_store_then_resend_is_duplicate(self, admin_db, agent_tenants, content):
        body, sha = content

        assert self._store(admin_db, agent_tenants, body, sha) == "stored"
        assert self._store(admin_db, agent_tenants, body, sha) == "duplicate"

        rows = self._rows(admin_db, agent_tenants["own_id"], sha)
        assert rows == [
            {
                "storage_path": build_storage_path(agent_tenants["own_id"], sha),
                "size_bytes": len(body),
            }
        ]
        downloaded = admin_db.storage.from_(DAILY_REPORT_BUCKET).download(
            rows[0]["storage_path"]
        )
        assert bytes(downloaded) == body

    def test_existing_object_without_row_is_recorded(
        self, admin_db, agent_tenants, content
    ):
        """前回 INSERT に失敗して Storage にだけ残ったオブジェクトがあっても行を作る"""
        body, sha = content
        admin_db.storage.from_(DAILY_REPORT_BUCKET).upload(
            path=build_storage_path(agent_tenants["own_id"], sha),
            file=body,
            file_options={"content-type": "application/octet-stream"},
        )

        assert self._store(admin_db, agent_tenants, body, sha) == "stored"
        assert len(self._rows(admin_db, agent_tenants["own_id"], sha)) == 1
