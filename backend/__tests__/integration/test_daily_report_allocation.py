"""
Integration テスト: 日報の実績の受注への割り付けと進捗 (Issue #490)

以下は実際の Postgres (RLS込み) でしか検証できないため integration tier に置く。
- recompute_tenant_allocation() が明細・受注・工程ルートを読み、RPC replace_daily_report_allocation で
  進捗・未割当を保存すること（納期順の充当・あふれ・後工程の実績による完了・未割当）
- 再計算が冪等で、別名辞書の追加・明細の置き換えが再計算で反映されること
- RPC の古い計算結果での置き換え拒否（'stale'）と、消えた受注・他テナントの ID を入れないこと
- 進捗・未割当・計算履歴の RLS（所属テナントの行のみ SELECT 可・書き込み不可・RPC 実行不可）
- GET /orders/{order_id}/progress と GET /daily-reports/order-progress がユーザー JWT で読めること

実行:
  supabase start
  cd backend && pytest __tests__/integration/test_daily_report_allocation.py -v --run-integration
"""

import hashlib
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import pytest
from app.main import app
from app.services.agent_token_service import hash_agent_token
from app.services.daily_report_allocation_service import recompute_tenant_allocation
from app.services.daily_report_parser import parse_sheet_rows
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

SHEET = "2609製造"
HEADER = ["加工日", "顧客先", "商品名", "工程名", "加工数", "不適合合計数"]
PROCESSES = ("プレス", "洗浄", "カシメ", "クグシ")


def _rows(res) -> list[dict[str, Any]]:
    return cast(list[dict[str, Any]], res.data)


def _replace_entries(
    admin_db, tenant: dict[str, Any], rows: list[list], modified_at: str
) -> None:
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
                "file_modified_at": modified_at,
            }
        )
        .execute()
    )[0]["id"]
    result = admin_db.rpc(
        "replace_daily_report_sheet_entries",
        {
            "p_tenant_id": tenant["id"],
            "p_source_file_id": file_id,
            "p_sheet_name": SHEET,
            "p_entries": parse_sheet_rows(SHEET, [HEADER, *rows]).entries,
        },
    ).execute()
    assert result.data == "replaced"


@pytest.fixture()
def tenants(admin_db, auth_user_id):
    """ログインユーザーが所属する own と、所属しない other を作る。

    どちらも製品「ピン」（プレス → 洗浄 → カシメ → クグシ）と、確定済み・生産中・出荷済みの受注を持つ。
    """
    ids: dict[str, dict[str, Any]] = {}
    for key in ("own", "other"):
        tenant_id = _rows(
            admin_db.table("tenants")
            .insert({"name": f"integration test daily report allocation ({key})"})
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
        customer_id = _rows(
            admin_db.table("customers")
            .insert({"tenant_id": tenant_id, "name": "株式会社サンプル工業"})
            .execute()
        )[0]["id"]
        product_id = _rows(
            admin_db.table("products")
            .insert({"tenant_id": tenant_id, "name": "ピン", "code": None})
            .execute()
        )[0]["id"]
        routings = _rows(
            admin_db.table("process_routings")
            .insert(
                [
                    {
                        "tenant_id": tenant_id,
                        "product_id": product_id,
                        "sequence_order": i + 1,
                        "process_name": name,
                        "unit_time_seconds": 1,
                    }
                    for i, name in enumerate(PROCESSES)
                ]
            )
            .execute()
        )
        orders: dict[str, int] = {}
        for label, status, deadline in (
            ("early", "confirmed", "2026-10-10"),
            ("late", "in_progress", "2026-10-20"),
            ("shipped", "shipped", "2026-09-05"),
        ):
            orders[label] = _rows(
                admin_db.table("orders")
                .insert(
                    {
                        "tenant_id": tenant_id,
                        "product_id": product_id,
                        "customer_id": customer_id,
                        "quantity": 100,
                        "status": status,
                        "deadline_date": deadline,
                        "order_date": "2026-09-01T00:00:00+09:00",
                    }
                )
                .execute()
            )[0]["id"]
        ids[key] = {
            "id": tenant_id,
            "token_id": token_id,
            "customer_id": customer_id,
            "product_id": product_id,
            "routing_ids": {r["process_name"]: r["id"] for r in routings},
            "orders": orders,
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
            "daily_report_allocation_runs",
            "daily_report_unallocated_actuals",
            "order_process_progress",
            "process_name_aliases",
            "daily_report_files",
            "agent_tokens",
            "production_schedules",
            "orders",
            "process_routings",
            "products",
            "customers",
        ):
            admin_db.table(table).delete().eq("tenant_id", tid).execute()
    admin_db.table("organization_members").delete().eq("user_id", auth_user_id).eq(
        "tenant_id", ids["own"]["id"]
    ).execute()
    for tenant in ids.values():
        admin_db.table("tenants").delete().eq("id", tenant["id"]).execute()


ENTRY_ROWS = [
    # プレス 150 → 納期の早い受注に 100、あふれた 50 が次の受注へ
    ["2026.09.10", "サンプル工業", "ピン", "プレス", 150, 0],
    # カシメ 30（不適合 5）→ 早い受注のプレス・洗浄（日報に出ない）が後工程の実績で完了
    ["2026.09.11", "サンプル工業", "ピン", "カシメ", 30, 5],
    # 2つの工程に対応する表記（辞書が無いうちは照合できない）
    ["2026.09.12", "サンプル工業", "ピン", "カシメ、仕上げ加工", 20, 0],
    # 受注日より前の実績（在庫の先行生産）は未割当
    ["2026.08.20", "サンプル工業", "ピン", "プレス", 40, 0],
]


def _progress(admin_db, tenant: dict[str, Any]) -> dict[tuple[str, str], dict]:
    names = {v: k for k, v in tenant["routing_ids"].items()}
    labels = {v: k for k, v in tenant["orders"].items()}
    rows = _rows(
        admin_db.table("order_process_progress")
        .select("*")
        .eq("tenant_id", tenant["id"])
        .execute()
    )
    return {(labels[r["order_id"]], names[r["process_routing_id"]]): r for r in rows}


def _unallocated(admin_db, tenant: dict[str, Any]) -> list[tuple]:
    rows = _rows(
        admin_db.table("daily_report_unallocated_actuals")
        .select("process_name, work_date, qty, reason")
        .eq("tenant_id", tenant["id"])
        .order("work_date")
        .execute()
    )
    return [(r["process_name"], r["work_date"], r["qty"], r["reason"]) for r in rows]


@pytest.mark.integration
class TestRecomputeAllocation:
    def test_allocates_and_saves_progress(self, admin_db, tenants):
        own = tenants["own"]
        _replace_entries(admin_db, own, ENTRY_ROWS, "2026-09-12T18:00:00+09:00")

        summary = recompute_tenant_allocation(admin_db, own["id"])

        assert summary == {
            "status": "replaced",
            "entries": 3,
            "unmatched_entries": 1,
            # 出荷済みの受注は候補外（確定済み・生産中の2件 × 4工程）
            "progress": 8,
            "unallocated": 1,
        }
        progress = _progress(admin_db, own)
        assert set(progress) == {
            (order, process) for order in ("early", "late") for process in PROCESSES
        }
        press = progress[("early", "プレス")]
        assert (press["good_qty"], press["status"], press["completed_by"]) == (
            100,
            "completed",
            "quantity",
        )
        assert press["first_actual_date"] == press["last_actual_date"] == "2026-09-10"
        assert progress[("late", "プレス")]["good_qty"] == 50
        assert progress[("late", "プレス")]["status"] == "in_progress"
        assert progress[("early", "洗浄")]["completed_by"] == "later_process"
        assert progress[("early", "カシメ")]["good_qty"] == 25
        assert progress[("early", "カシメ")]["status"] == "in_progress"
        assert progress[("early", "クグシ")]["status"] == "not_started"
        assert progress[("late", "洗浄")]["status"] == "not_started"
        assert _unallocated(admin_db, own) == [
            ("プレス", "2026-08-20", 40, "before_order_date")
        ]
        run = _rows(
            admin_db.table("daily_report_allocation_runs")
            .select("progress_count, unallocated_count")
            .eq("tenant_id", own["id"])
            .execute()
        )
        assert run == [{"progress_count": 8, "unallocated_count": 1}]

    def test_recomputation_is_idempotent_and_reflects_changes(
        self, admin_db, auth_user_id, tenants
    ):
        own = tenants["own"]
        _replace_entries(admin_db, own, ENTRY_ROWS, "2026-09-12T18:00:00+09:00")
        recompute_tenant_allocation(admin_db, own["id"])
        first = _progress(admin_db, own)

        recompute_tenant_allocation(admin_db, own["id"])
        second = _progress(admin_db, own)
        strip = lambda rows: {k: {**v, "computed_at": None} for k, v in rows.items()}  # noqa: E731
        assert strip(second) == strip(first)
        assert len(_unallocated(admin_db, own)) == 1

        # 別名辞書の追加: 「カシメ、仕上げ加工」→ カシメ・クグシ
        admin_db.table("process_name_aliases").insert(
            {
                "tenant_id": own["id"],
                "raw_text": "カシメ、仕上げ加工",
                "process_names": ["カシメ", "クグシ"],
                "created_by": auth_user_id,
            }
        ).execute()
        recompute_tenant_allocation(admin_db, own["id"])
        progress = _progress(admin_db, own)
        assert progress[("early", "カシメ")]["good_qty"] == 45
        assert progress[("early", "カシメ")]["completed_by"] == "later_process"
        assert progress[("early", "クグシ")]["good_qty"] == 20

        # 明細の置き換え（同じシートの新しい版）: 先行生産の行が消え、プレスが増える
        _replace_entries(
            admin_db,
            own,
            [*ENTRY_ROWS[:3], ["2026.09.13", "サンプル工業", "ピン", "プレス", 60, 0]],
            "2026-09-13T18:00:00+09:00",
        )
        recompute_tenant_allocation(admin_db, own["id"])
        progress = _progress(admin_db, own)
        assert progress[("late", "プレス")]["good_qty"] == 100
        assert progress[("late", "プレス")]["last_actual_date"] == "2026-09-13"
        assert _unallocated(admin_db, own) == [
            ("プレス", "2026-09-13", 10, "exceeds_order_qty")
        ]

    def test_order_leaving_candidates_drops_its_progress(self, admin_db, tenants):
        own = tenants["own"]
        _replace_entries(admin_db, own, ENTRY_ROWS, "2026-09-12T18:00:00+09:00")
        recompute_tenant_allocation(admin_db, own["id"])

        admin_db.table("orders").update({"status": "shipped"}).eq(
            "id", own["orders"]["early"]
        ).execute()
        recompute_tenant_allocation(admin_db, own["id"])

        progress = _progress(admin_db, own)
        assert {order for order, _ in progress} == {"late"}
        assert progress[("late", "プレス")]["good_qty"] == 100


@pytest.mark.integration
class TestReplaceAllocationRpc:
    def _call(self, admin_db, tenant_id, computed_at, progress, unallocated=None):
        return (
            admin_db.rpc(
                "replace_daily_report_allocation",
                {
                    "p_tenant_id": tenant_id,
                    "p_computed_at": computed_at.isoformat(),
                    "p_progress": progress,
                    "p_unallocated": unallocated or [],
                },
            )
            .execute()
            .data
        )

    def _row(self, order_id, routing_id, qty=1):
        return {
            "order_id": order_id,
            "process_routing_id": routing_id,
            "good_qty": qty,
            "first_actual_date": "2026-09-10",
            "last_actual_date": "2026-09-10",
            "status": "in_progress",
            "completed_by": None,
        }

    def test_older_computation_does_not_overwrite(self, admin_db, tenants):
        own = tenants["own"]
        now = datetime.now(UTC)
        press = own["routing_ids"]["プレス"]
        assert (
            self._call(
                admin_db, own["id"], now, [self._row(own["orders"]["early"], press, 5)]
            )
            == "replaced"
        )

        assert (
            self._call(
                admin_db,
                own["id"],
                now - timedelta(minutes=1),
                [self._row(own["orders"]["early"], press, 9)],
            )
            == "stale"
        )
        assert _progress(admin_db, own)[("early", "プレス")]["good_qty"] == 5

    def test_skips_missing_and_other_tenant_ids(self, admin_db, tenants):
        own, other = tenants["own"], tenants["other"]
        press = own["routing_ids"]["プレス"]

        result = self._call(
            admin_db,
            own["id"],
            datetime.now(UTC),
            [
                self._row(own["orders"]["early"], press),
                # 計算後に削除された受注・他テナントの受注／工程は入れない
                self._row(999_999_999, press),
                self._row(other["orders"]["early"], press),
                self._row(own["orders"]["early"], other["routing_ids"]["カシメ"]),
            ],
            [
                {
                    "entry_id": 999_999_999,
                    "product_id": own["product_id"],
                    "customer_id": None,
                    "process_name": "プレス",
                    "work_date": "2026-09-10",
                    "qty": 1,
                    "reason": "exceeds_order_qty",
                }
            ],
        )

        assert result == "replaced"
        assert list(_progress(admin_db, own)) == [("early", "プレス")]
        assert _unallocated(admin_db, own) == []
        assert _progress(admin_db, other) == {}


@pytest.mark.integration
class TestAllocationRls:
    def test_member_reads_own_tenant_only_and_cannot_write(
        self, admin_db, real_supabase_client, auth_token, tenants
    ):
        own, other = tenants["own"], tenants["other"]
        for tenant in (own, other):
            _replace_entries(admin_db, tenant, ENTRY_ROWS, "2026-09-12T18:00:00+09:00")
            recompute_tenant_allocation(admin_db, tenant["id"])

        for table in (
            "order_process_progress",
            "daily_report_unallocated_actuals",
            "daily_report_allocation_runs",
        ):
            visible = _rows(
                real_supabase_client.table(table).select("tenant_id").execute()
            )
            assert visible
            assert {r["tenant_id"] for r in visible} == {own["id"]}

        with pytest.raises(APIError):
            real_supabase_client.table("order_process_progress").insert(
                {
                    "tenant_id": own["id"],
                    "order_id": own["orders"]["early"],
                    "process_routing_id": own["routing_ids"]["クグシ"],
                    "good_qty": 1,
                    "status": "in_progress",
                    "computed_at": datetime.now(UTC).isoformat(),
                }
            ).execute()
        # UPDATE / DELETE はポリシーが無いので 0 行（エラーにはならない）
        real_supabase_client.table("order_process_progress").delete().eq(
            "tenant_id", own["id"]
        ).execute()
        assert len(_progress(admin_db, own)) == 8

        with pytest.raises(APIError):
            real_supabase_client.rpc(
                "replace_daily_report_allocation",
                {
                    "p_tenant_id": own["id"],
                    "p_computed_at": datetime.now(UTC).isoformat(),
                    "p_progress": [],
                    "p_unallocated": [],
                },
            ).execute()


@pytest.mark.integration
class TestProgressApi:
    def test_progress_endpoints_with_user_jwt(self, admin_db, auth_token, tenants):
        own, other = tenants["own"], tenants["other"]
        _replace_entries(admin_db, own, ENTRY_ROWS, "2026-09-12T18:00:00+09:00")
        recompute_tenant_allocation(admin_db, own["id"])
        # プレスのスケジュール（2セグメント）。計画の終了日時は最後のセグメントの終了
        admin_db.table("production_schedules").insert(
            [
                {
                    "tenant_id": own["id"],
                    "order_id": own["orders"]["early"],
                    "process_routing_id": own["routing_ids"]["プレス"],
                    "start_datetime": start,
                    "end_datetime": end,
                }
                for start, end in (
                    ("2026-09-10T09:00:00+09:00", "2026-09-10T17:00:00+09:00"),
                    ("2026-09-11T09:00:00+09:00", "2026-09-11T12:00:00+09:00"),
                )
            ]
        ).execute()
        client = TestClient(app)
        headers = {"Authorization": f"Bearer {auth_token}", "x-tenant-id": own["id"]}

        res = client.get(f"/orders/{own['orders']['early']}/progress", headers=headers)
        assert res.status_code == 200
        body = res.json()
        assert body["computed_at"] is not None
        assert {p["order_quantity"] for p in body["processes"]} == {100}
        planned_ends = {
            p["process_name"]: p["planned_end_datetime"] for p in body["processes"]
        }
        assert datetime.fromisoformat(planned_ends["プレス"]) == datetime.fromisoformat(
            "2026-09-11T12:00:00+09:00"
        )
        assert planned_ends["カシメ"] is None
        assert [
            (p["sequence_order"], p["process_name"], p["good_qty"], p["status"])
            for p in body["processes"]
        ] == [
            (1, "プレス", 100, "completed"),
            (2, "洗浄", 0, "completed"),
            (3, "カシメ", 25, "in_progress"),
            (4, "クグシ", 0, "not_started"),
        ]

        # 割り付けの対象外（出荷済み）の受注は空
        res = client.get(
            f"/orders/{own['orders']['shipped']}/progress", headers=headers
        )
        assert res.status_code == 200
        assert res.json()["processes"] == []

        # 他テナントの受注は 404
        res = client.get(
            f"/orders/{other['orders']['early']}/progress", headers=headers
        )
        assert res.status_code == 404

        res = client.get(
            f"/daily-reports/order-progress?order_id={own['orders']['late']}",
            headers=headers,
        )
        assert res.status_code == 200
        assert {p["order_id"] for p in res.json()["items"]} == {own["orders"]["late"]}
        assert len(res.json()["items"]) == 4

        res = client.get("/daily-reports/unallocated-actuals", headers=headers)
        assert res.status_code == 200
        assert [
            (u["reason"], u["qty"], u["sheet_name"], u["process_raw"])
            for u in res.json()
        ] == [("before_order_date", 40, SHEET, "プレス")]
