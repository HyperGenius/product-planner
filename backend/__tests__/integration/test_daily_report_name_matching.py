"""
Integration テスト: 日報の名寄せと別名辞書 (Issue #488)

以下は実際の Postgres (RLS込み) でしか検証できないため integration tier に置く。
- RPC daily_report_name_stats の集計（表記ごとの件数・最終出現日、製品は顧客先との組）と RLS
- 別名辞書（equipment / process / customer）の RLS（所属テナントのみ読み書き・created_by の強制）
- product_name_aliases に source='daily_report' を登録できること
- API 経由で別名を登録すると、明細を書き換えずに未照合の一覧から外れること
- 対象外の表記（daily_report_ignored_names、#489）の RLS・UNIQUE と、未照合の一覧からの除外

実行:
  supabase start
  cd backend && pytest __tests__/integration/test_daily_report_name_matching.py -v --run-integration
"""

import hashlib
import uuid
from typing import Any, cast

import pytest
from app.main import app
from app.services.agent_token_service import hash_agent_token
from app.services.daily_report_parser import parse_sheet_rows
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

SHEET = "2609製造"
HEADER = [
    "加工日",
    "顧客先",
    "商品名",
    "工程名",
    "使用設備No",
    "加工数",
    "不適合合計数",
]


def _rows(res) -> list[dict[str, Any]]:
    return cast(list[dict[str, Any]], res.data)


def _insert_entries(admin_db, tenant: dict[str, str], rows: list[list]) -> None:
    sha256 = hashlib.sha256(str(uuid.uuid4()).encode()).hexdigest()
    file_id = _rows(
        admin_db.table("daily_report_files")
        .insert(
            {
                "tenant_id": tenant["id"],
                "agent_token_id": tenant["token_id"],
                "sha256": sha256,
                "storage_path": f"{tenant['id']}/{sha256}.xlsx",
                "original_path": r"\\fileserver\日報\日報.xlsx",
                "file_name": "日報.xlsx",
                "size_bytes": 1024,
            }
        )
        .execute()
    )[0]["id"]
    admin_db.rpc(
        "replace_daily_report_sheet_entries",
        {
            "p_tenant_id": tenant["id"],
            "p_source_file_id": file_id,
            "p_sheet_name": SHEET,
            "p_entries": parse_sheet_rows(SHEET, [HEADER, *rows]).entries,
        },
    ).execute()


@pytest.fixture()
def tenants(admin_db, auth_user_id):
    """ログインユーザーが order_handler として所属する own と、所属しない other を作る。"""
    ids: dict[str, dict[str, Any]] = {}
    for key in ("own", "other"):
        tenant_id = _rows(
            admin_db.table("tenants")
            .insert({"name": f"integration test daily report names ({key})"})
            .execute()
        )[0]["id"]
        token_id = _rows(
            admin_db.table("agent_tokens")
            .insert(
                {
                    "tenant_id": tenant_id,
                    "name": "integration test agent",
                    "token_hash": hash_agent_token(str(uuid.uuid4())),
                }
            )
            .execute()
        )[0]["id"]
        equipment_id = _rows(
            admin_db.table("equipments")
            .insert({"tenant_id": tenant_id, "name": "200tプレス", "ledger_no": 3})
            .execute()
        )[0]["id"]
        customer_id = _rows(
            admin_db.table("customers")
            .insert({"tenant_id": tenant_id, "name": "株式会社サンプル工業"})
            .execute()
        )[0]["id"]
        product_id = _rows(
            admin_db.table("products")
            .insert({"tenant_id": tenant_id, "name": "ピン φ6×20", "code": None})
            .execute()
        )[0]["id"]
        admin_db.table("process_routings").insert(
            {
                "tenant_id": tenant_id,
                "product_id": product_id,
                "sequence_order": 1,
                "process_name": "カシメ",
                "unit_time_seconds": 1,
            }
        ).execute()
        ids[key] = {
            "id": tenant_id,
            "token_id": token_id,
            "equipment_id": equipment_id,
            "customer_id": customer_id,
            "product_id": product_id,
        }

    admin_db.table("organization_members").insert(
        {
            "user_id": auth_user_id,
            "tenant_id": ids["own"]["id"],
            "role": "order_handler",
        }
    ).execute()

    yield ids

    for tenant in ids.values():
        tid = tenant["id"]
        for table in (
            "daily_report_ignored_names",
            "equipment_name_aliases",
            "process_name_aliases",
            "customer_name_aliases",
            "product_name_alias_history",
            "product_name_aliases",
            "daily_report_files",
            "agent_tokens",
            "process_routings",
            "products",
            "customers",
            "equipments",
        ):
            admin_db.table(table).delete().eq("tenant_id", tid).execute()
    admin_db.table("organization_members").delete().eq("user_id", auth_user_id).eq(
        "tenant_id", ids["own"]["id"]
    ).execute()
    for tenant in ids.values():
        admin_db.table("tenants").delete().eq("id", tenant["id"]).execute()


ENTRY_ROWS = [
    ["2026.09.01", "サンプル工業", "ピン6x20", "カシメ", "80t 3号機", 100, 0],
    ["2026.09.02", "サンプル工業", "短いピン", "カシメ加工", "組立機B", 50, 1],
    ["2026.09.05", "未登録の顧客", "短いピン", "カシメ加工", "組立機B", 10, 0],
]


@pytest.mark.integration
class TestDailyReportNameStats:
    def test_aggregates_raw_names(self, admin_db, tenants):
        own = tenants["own"]
        _insert_entries(admin_db, own, ENTRY_ROWS)

        stats = _rows(
            admin_db.rpc(
                "daily_report_name_stats", {"p_tenant_id": own["id"]}
            ).execute()
        )

        assert sorted(
            (
                s["kind"],
                s["raw_text"],
                s["customer_raw"],
                s["entry_count"],
                s["last_work_date"],
            )
            for s in stats
        ) == [
            ("customer", "サンプル工業", None, 2, "2026-09-02"),
            ("customer", "未登録の顧客", None, 1, "2026-09-05"),
            ("equipment", "80t 3号機", None, 1, "2026-09-01"),
            ("equipment", "組立機B", None, 2, "2026-09-05"),
            ("process", "カシメ", None, 1, "2026-09-01"),
            ("process", "カシメ加工", None, 2, "2026-09-05"),
            ("product", "ピン6x20", "サンプル工業", 1, "2026-09-01"),
            ("product", "短いピン", "サンプル工業", 1, "2026-09-02"),
            ("product", "短いピン", "未登録の顧客", 1, "2026-09-05"),
        ]

    def test_rls_hides_other_tenant(
        self, admin_db, real_supabase_client, auth_token, tenants
    ):
        other = tenants["other"]
        _insert_entries(admin_db, other, ENTRY_ROWS)

        stats = _rows(
            real_supabase_client.rpc(
                "daily_report_name_stats", {"p_tenant_id": other["id"]}
            ).execute()
        )

        assert stats == []


@pytest.mark.integration
class TestNameAliasRls:
    @pytest.mark.parametrize(
        ("table", "target"),
        [
            ("equipment_name_aliases", {"equipment_id": "equipment_id"}),
            ("customer_name_aliases", {"customer_id": "customer_id"}),
            ("process_name_aliases", None),
        ],
    )
    def test_member_can_write_own_tenant_only(
        self,
        admin_db,
        real_supabase_client,
        auth_user_id,
        auth_token,
        tenants,
        table,
        target,
    ):
        def row(tenant):
            values = (
                {column: tenant[key] for column, key in target.items()}
                if target
                else {"process_names": ["カシメ"]}
            )
            return {
                "tenant_id": tenant["id"],
                "raw_text": "表記A",
                "created_by": auth_user_id,
                **values,
            }

        created = _rows(
            real_supabase_client.table(table).insert(row(tenants["own"])).execute()
        )
        assert created[0]["raw_text"] == "表記A"

        with pytest.raises(APIError):
            real_supabase_client.table(table).insert(row(tenants["other"])).execute()

        # created_by を他人にしてなりすますことはできない
        with pytest.raises(APIError):
            real_supabase_client.table(table).insert(
                {
                    **row(tenants["own"]),
                    "raw_text": "表記B",
                    "created_by": str(uuid.uuid4()),
                }
            ).execute()

        # 同じ表記は1テナントに1件
        with pytest.raises(APIError) as exc:
            real_supabase_client.table(table).insert(row(tenants["own"])).execute()
        assert exc.value.code == "23505"

        admin_db.table(table).insert(
            {**row(tenants["other"]), "created_by": auth_user_id}
        ).execute()
        visible = _rows(real_supabase_client.table(table).select("tenant_id").execute())
        assert {r["tenant_id"] for r in visible} == {tenants["own"]["id"]}

    def test_process_names_must_not_be_empty(
        self, real_supabase_client, auth_user_id, auth_token, tenants
    ):
        with pytest.raises(APIError):
            real_supabase_client.table("process_name_aliases").insert(
                {
                    "tenant_id": tenants["own"]["id"],
                    "raw_text": "表記A",
                    "process_names": [],
                    "created_by": auth_user_id,
                }
            ).execute()

    def test_product_alias_accepts_daily_report_source(
        self, admin_db, auth_user_id, tenants
    ):
        own = tenants["own"]
        created = _rows(
            admin_db.table("product_name_aliases")
            .insert(
                {
                    "tenant_id": own["id"],
                    "customer_id": own["customer_id"],
                    "product_id": own["product_id"],
                    "raw_text": "短いピン",
                    "created_by": auth_user_id,
                    "source": "daily_report",
                }
            )
            .execute()
        )
        assert created[0]["source"] == "daily_report"


@pytest.mark.integration
class TestNameMatchingApi:
    def test_registering_aliases_removes_names_from_unmatched(
        self, admin_db, auth_token, tenants
    ):
        own = tenants["own"]
        _insert_entries(admin_db, own, ENTRY_ROWS)
        client = TestClient(app)
        headers = {"Authorization": f"Bearer {auth_token}", "x-tenant-id": own["id"]}

        def unmatched():
            res = client.get("/daily-reports/unmatched-names", headers=headers)
            assert res.status_code == 200
            return [(i["kind"], i["raw_text"], i["customer_raw"]) for i in res.json()]

        # 設備は台帳番号・工程はマスタ名・顧客は法人格を無視・製品は正規化で照合済み
        assert sorted(unmatched()) == [
            ("customer", "未登録の顧客", None),
            ("equipment", "組立機B", None),
            ("process", "カシメ加工", None),
            ("product", "短いピン", "サンプル工業"),
            ("product", "短いピン", "未登録の顧客"),
        ]

        for path, body in [
            ("equipment", {"raw_text": "組立機B", "equipment_id": own["equipment_id"]}),
            ("process", {"raw_text": "カシメ加工", "process_names": ["カシメ"]}),
            (
                "customer",
                {"raw_text": "未登録の顧客", "customer_id": own["customer_id"]},
            ),
            (
                "product",
                {
                    "raw_text": "短いピン",
                    "customer_id": own["customer_id"],
                    "product_id": own["product_id"],
                },
            ),
        ]:
            res = client.post(
                f"/daily-reports/name-aliases/{path}", json=body, headers=headers
            )
            assert res.status_code == 201, res.text

        # 明細は書き換えていないが、辞書の登録が過去の明細にも反映される
        assert unmatched() == []

        # 他テナントの設備は指せない
        res = client.post(
            "/daily-reports/name-aliases/equipment",
            json={
                "raw_text": "組立機C",
                "equipment_id": tenants["other"]["equipment_id"],
            },
            headers=headers,
        )
        assert res.status_code == 422

        history = _rows(
            admin_db.table("product_name_alias_history")
            .select("source, source_order_label_snapshot")
            .eq("tenant_id", own["id"])
            .execute()
        )
        assert history == [
            {"source": "daily_report", "source_order_label_snapshot": "日報からの登録"}
        ]


@pytest.mark.integration
class TestIgnoredNames:
    """「対象外」にした表記 (Issue #489)。"""

    def _row(self, tenant, auth_user_id, **overrides):
        return {
            "tenant_id": tenant["id"],
            "kind": "product",
            "raw_text": "試作品",
            "customer_raw": None,
            "created_by": auth_user_id,
            **overrides,
        }

    def test_rls_and_unique(
        self, admin_db, real_supabase_client, auth_user_id, auth_token, tenants
    ):
        own, other = tenants["own"], tenants["other"]
        table = real_supabase_client.table("daily_report_ignored_names")

        table.insert(self._row(own, auth_user_id)).execute()
        # 顧客先が違えば別の行（製品は (顧客先, 商品名) の組）
        table.insert(self._row(own, auth_user_id, customer_raw="顧客A")).execute()

        # 顧客先が空欄（NULL）同士も重複として弾く
        with pytest.raises(APIError) as exc:
            table.insert(self._row(own, auth_user_id)).execute()
        assert exc.value.code == "23505"

        # 顧客先は製品のときだけ持てる
        with pytest.raises(APIError):
            table.insert(
                self._row(own, auth_user_id, kind="process", customer_raw="顧客A")
            ).execute()

        with pytest.raises(APIError):
            table.insert(self._row(other, auth_user_id)).execute()
        with pytest.raises(APIError):
            table.insert(
                self._row(
                    own, auth_user_id, raw_text="別の表記", created_by=str(uuid.uuid4())
                )
            ).execute()

        admin_db.table("daily_report_ignored_names").insert(
            self._row(other, auth_user_id)
        ).execute()
        visible = _rows(table.select("tenant_id").execute())
        assert {r["tenant_id"] for r in visible} == {own["id"]}

    def test_api_ignore_and_entries(self, admin_db, auth_token, tenants):
        own = tenants["own"]
        _insert_entries(admin_db, own, ENTRY_ROWS)
        client = TestClient(app)
        headers = {"Authorization": f"Bearer {auth_token}", "x-tenant-id": own["id"]}

        def unmatched():
            res = client.get("/daily-reports/unmatched-names", headers=headers)
            assert res.status_code == 200
            return [(i["kind"], i["raw_text"], i["customer_raw"]) for i in res.json()]

        # 表記が使われている明細（製品は顧客先との組で絞る）
        res = client.get(
            "/daily-reports/name-entries",
            params={
                "kind": "product",
                "raw_text": "短いピン",
                "customer_raw": "未登録の顧客",
            },
            headers=headers,
        )
        assert res.status_code == 200
        assert [(e["work_date"], e["processed_qty"]) for e in res.json()] == [
            ("2026-09-05", 10)
        ]

        res = client.get("/daily-reports/process-names", headers=headers)
        assert res.json() == ["カシメ"]

        res = client.post(
            "/daily-reports/ignored-names",
            json={
                "kind": "product",
                "raw_text": "短いピン",
                "customer_raw": "未登録の顧客",
            },
            headers=headers,
        )
        assert res.status_code == 201, res.text
        ignored_id = res.json()["id"]
        assert ("product", "短いピン", "未登録の顧客") not in unmatched()
        assert ("product", "短いピン", "サンプル工業") in unmatched()

        res = client.post(
            "/daily-reports/ignored-names",
            json={
                "kind": "product",
                "raw_text": "短いピン",
                "customer_raw": "未登録の顧客",
            },
            headers=headers,
        )
        assert res.status_code == 409

        # 解除すればキューに戻る
        res = client.delete(
            f"/daily-reports/ignored-names/{ignored_id}", headers=headers
        )
        assert res.status_code == 200
        assert ("product", "短いピン", "未登録の顧客") in unmatched()
