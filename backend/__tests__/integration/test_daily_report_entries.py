"""
Integration テスト: 日報明細の置き換え RPC と RLS (Issue #487)

以下は実際の Postgres (RLS込み) でしか検証できないため integration tier に置く。
- replace_daily_report_sheet_entries の「シート単位で最新版を正とする」置き換え
  （新しい版で丸ごと置き換え・古い版は 'stale'・同じ版の再処理は冪等・他テナントのファイルは拒否）
- パーサーの出力（日付の文字列・parse_issues の配列）が RPC 経由でそのまま保存されること
- daily_report_entries / daily_report_sheets の RLS（所属テナントの行のみ SELECT 可・書き込み不可）
- ユーザー JWT から RPC を実行できないこと

実行:
  supabase start
  cd backend && pytest __tests__/integration/test_daily_report_entries.py -v --run-integration
"""

import hashlib
import uuid
from typing import Any, cast

import pytest
from app.services.agent_token_service import hash_agent_token
from app.services.daily_report_parser import parse_sheet_rows
from postgrest.exceptions import APIError

SHEET = "2609製造"
HEADER = ["加工日", "担当者", "商品名", "工程名", "加工数", "不適合合計数"]


def _entries(*rows: list) -> list[dict[str, Any]]:
    return parse_sheet_rows(SHEET, [HEADER, *rows]).entries


def _insert_file(
    admin_db, tenant_id: str, token_id: str, file_modified_at: str | None
) -> str:
    sha256 = hashlib.sha256(str(uuid.uuid4()).encode()).hexdigest()
    res = (
        admin_db.table("daily_report_files")
        .insert(
            {
                "tenant_id": tenant_id,
                "agent_token_id": token_id,
                "sha256": sha256,
                "storage_path": f"{tenant_id}/{sha256}.xlsx",
                "original_path": r"\\fileserver\日報\日報.xlsx",
                "file_name": "日報.xlsx",
                "size_bytes": 1024,
                "file_modified_at": file_modified_at,
            }
        )
        .execute()
    )
    return cast(list[dict[str, Any]], res.data)[0]["id"]


def _replace(db, tenant_id: str, file_id: str, entries: list[dict[str, Any]]) -> str:
    return (
        db.rpc(
            "replace_daily_report_sheet_entries",
            {
                "p_tenant_id": tenant_id,
                "p_source_file_id": file_id,
                "p_sheet_name": SHEET,
                "p_entries": entries,
            },
        )
        .execute()
        .data
    )


def _stored(admin_db, tenant_id: str) -> list[dict[str, Any]]:
    res = (
        admin_db.table("daily_report_entries")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("sheet_name", SHEET)
        .order("row_no")
        .execute()
    )
    return cast(list[dict[str, Any]], res.data)


@pytest.fixture()
def tenants(admin_db, auth_user_id):
    """ログインユーザーが所属する own テナントと、所属しない other テナントを作る。"""
    ids = {}
    for key in ("own", "other"):
        res = (
            admin_db.table("tenants")
            .insert({"name": f"integration test daily report entries ({key})"})
            .execute()
        )
        tenant_id = cast(list[dict[str, Any]], res.data)[0]["id"]
        token = (
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
        ids[key] = {
            "id": tenant_id,
            "token_id": cast(list[dict[str, Any]], token.data)[0]["id"],
        }

    admin_db.table("organization_members").insert(
        {"user_id": auth_user_id, "tenant_id": ids["own"]["id"]}
    ).execute()

    yield ids

    # daily_report_entries / daily_report_sheets は daily_report_files の ON DELETE CASCADE で消える
    for tenant in ids.values():
        admin_db.table("daily_report_files").delete().eq(
            "tenant_id", tenant["id"]
        ).execute()
        admin_db.table("agent_tokens").delete().eq("tenant_id", tenant["id"]).execute()
    admin_db.table("organization_members").delete().eq("user_id", auth_user_id).eq(
        "tenant_id", ids["own"]["id"]
    ).execute()
    for tenant in ids.values():
        admin_db.table("tenants").delete().eq("id", tenant["id"]).execute()


@pytest.mark.integration
class TestReplaceDailyReportSheetEntries:
    def test_saves_parser_output(self, admin_db, tenants):
        own = tenants["own"]
        file_id = _insert_file(admin_db, own["id"], own["token_id"], None)
        entries = _entries(
            ["2026.09.01", "作業者A・作業者B", "P-1", "カシメ加工", 100, 3],
            ["2029.09.02", "作業者C", 1234, "溶接", None, 0],
        )

        assert _replace(admin_db, own["id"], file_id, entries) == "replaced"

        stored = _stored(admin_db, own["id"])
        assert [
            (
                r["row_no"],
                r["work_date"],
                r["work_date_raw"],
                r["worker_raw"],
                r["product_raw"],
                r["processed_qty"],
                r["defect_qty"],
                r["good_qty"],
                r["parse_issues"],
                r["source_file_id"],
            )
            for r in stored
        ] == [
            (
                2,
                "2026-09-01",
                "2026.09.01",
                "作業者A・作業者B",
                "P-1",
                100,
                3,
                97,
                [],
                file_id,
            ),
            (
                3,
                "2026-09-02",
                "2029.09.02",
                "作業者C",
                "1234",
                None,
                0,
                None,
                [
                    {"field": "work_date", "code": "year_corrected"},
                    {"field": "processed_qty", "code": "missing"},
                ],
                file_id,
            ),
        ]
        sheet = (
            admin_db.table("daily_report_sheets")
            .select("source_file_id, entry_count")
            .eq("tenant_id", own["id"])
            .eq("sheet_name", SHEET)
            .single()
            .execute()
            .data
        )
        assert sheet == {"source_file_id": file_id, "entry_count": 2}

    def test_newer_file_replaces_entries_instead_of_adding(self, admin_db, tenants):
        own = tenants["own"]
        old_file = _insert_file(
            admin_db, own["id"], own["token_id"], "2026-09-29T18:00:00+09:00"
        )
        new_file = _insert_file(
            admin_db, own["id"], own["token_id"], "2026-09-30T18:00:00+09:00"
        )
        _replace(
            admin_db,
            own["id"],
            old_file,
            _entries(["2026.09.29", "A", "P-1", "工程", 10, 0]),
        )

        # 翌日の版では前日の行が修正され、行が追記されている
        result = _replace(
            admin_db,
            own["id"],
            new_file,
            _entries(
                ["2026.09.29", "A", "P-1", "工程", 12, 0],
                ["2026.09.30", "A", "P-1", "工程", 20, 0],
            ),
        )

        assert result == "replaced"
        stored = _stored(admin_db, own["id"])
        assert [(r["processed_qty"], r["source_file_id"]) for r in stored] == [
            (12, new_file),
            (20, new_file),
        ]

    def test_older_file_is_stale_and_keeps_entries(self, admin_db, tenants):
        own = tenants["own"]
        new_file = _insert_file(
            admin_db, own["id"], own["token_id"], "2026-09-30T18:00:00+09:00"
        )
        old_file = _insert_file(
            admin_db, own["id"], own["token_id"], "2026-09-29T18:00:00+09:00"
        )
        _replace(
            admin_db,
            own["id"],
            new_file,
            _entries(["2026.09.30", "A", "P-1", "工程", 20, 0]),
        )

        result = _replace(
            admin_db,
            own["id"],
            old_file,
            _entries(["2026.09.29", "A", "P-1", "工程", 10, 0]),
        )

        assert result == "stale"
        stored = _stored(admin_db, own["id"])
        assert [(r["processed_qty"], r["source_file_id"]) for r in stored] == [
            (20, new_file)
        ]

    def test_reprocessing_same_file_is_idempotent(self, admin_db, tenants):
        own = tenants["own"]
        file_id = _insert_file(admin_db, own["id"], own["token_id"], None)
        entries = _entries(["2026.09.01", "A", "P-1", "工程", 10, 0])

        assert _replace(admin_db, own["id"], file_id, entries) == "replaced"
        assert _replace(admin_db, own["id"], file_id, entries) == "replaced"

        assert len(_stored(admin_db, own["id"])) == 1

    def test_file_without_modified_at_uses_received_at(self, admin_db, tenants):
        own = tenants["own"]
        first = _insert_file(admin_db, own["id"], own["token_id"], None)
        second = _insert_file(admin_db, own["id"], own["token_id"], None)
        _replace(
            admin_db,
            own["id"],
            second,
            _entries(["2026.09.02", "A", "P-1", "工程", 2, 0]),
        )

        assert (
            _replace(
                admin_db,
                own["id"],
                first,
                _entries(["2026.09.01", "A", "P-1", "工程", 1, 0]),
            )
            == "stale"
        )

    def test_rejects_file_of_another_tenant(self, admin_db, tenants):
        own, other = tenants["own"], tenants["other"]
        other_file = _insert_file(admin_db, other["id"], other["token_id"], None)

        with pytest.raises(APIError):
            _replace(
                admin_db,
                own["id"],
                other_file,
                _entries(["2026.09.01", "A", "P-1", "工程", 1, 0]),
            )
        assert _stored(admin_db, own["id"]) == []

    def test_sheets_are_isolated_per_tenant(self, admin_db, tenants):
        own, other = tenants["own"], tenants["other"]
        own_file = _insert_file(
            admin_db, own["id"], own["token_id"], "2026-09-30T18:00:00+09:00"
        )
        other_file = _insert_file(
            admin_db, other["id"], other["token_id"], "2026-09-29T18:00:00+09:00"
        )
        _replace(
            admin_db,
            own["id"],
            own_file,
            _entries(["2026.09.30", "A", "P-1", "工程", 1, 0]),
        )

        # 他テナントの同名シートは、版の新旧に関係なく別物として保存される
        assert (
            _replace(
                admin_db,
                other["id"],
                other_file,
                _entries(["2026.09.29", "B", "P-2", "工程", 2, 0]),
            )
            == "replaced"
        )
        assert len(_stored(admin_db, own["id"])) == 1
        assert len(_stored(admin_db, other["id"])) == 1


@pytest.mark.integration
class TestDailyReportEntriesRls:
    def _seed(self, admin_db, tenants):
        for key in ("own", "other"):
            tenant = tenants[key]
            file_id = _insert_file(admin_db, tenant["id"], tenant["token_id"], None)
            _replace(
                admin_db,
                tenant["id"],
                file_id,
                _entries(["2026.09.01", "A", f"P-{key}", "工程", 1, 0]),
            )

    def test_user_jwt_sees_only_own_tenant(
        self, real_supabase_client, admin_db, tenants
    ):
        self._seed(admin_db, tenants)
        tenant_ids = [tenants["own"]["id"], tenants["other"]["id"]]

        entries = (
            real_supabase_client.table("daily_report_entries")
            .select("tenant_id, product_raw")
            .in_("tenant_id", tenant_ids)
            .execute()
            .data
        )
        sheets = (
            real_supabase_client.table("daily_report_sheets")
            .select("tenant_id")
            .in_("tenant_id", tenant_ids)
            .execute()
            .data
        )

        assert entries == [{"tenant_id": tenants["own"]["id"], "product_raw": "P-own"}]
        assert sheets == [{"tenant_id": tenants["own"]["id"]}]

    def test_user_jwt_cannot_write_entries(
        self, real_supabase_client, admin_db, tenants
    ):
        self._seed(admin_db, tenants)
        own = tenants["own"]

        deleted = (
            real_supabase_client.table("daily_report_entries")
            .delete()
            .eq("tenant_id", own["id"])
            .execute()
            .data
        )
        assert deleted == []
        assert len(_stored(admin_db, own["id"])) == 1

    def test_user_jwt_cannot_call_replace_rpc(
        self, real_supabase_client, admin_db, tenants
    ):
        own = tenants["own"]
        file_id = _insert_file(admin_db, own["id"], own["token_id"], None)

        with pytest.raises(APIError):
            _replace(
                real_supabase_client,
                own["id"],
                file_id,
                _entries(["2026.09.01", "A", "P-1", "工程", 1, 0]),
            )
        assert _stored(admin_db, own["id"]) == []
