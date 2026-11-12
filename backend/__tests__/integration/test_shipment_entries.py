"""
Integration テスト: 弥生の売上明細の置き換え RPC と突合のクエリ (Issue #667)

以下は実際の Postgres でしか検証できないため integration tier に置く。
- replace_shipment_entries の「期間の日ごとに最新のファイルを正とする」置き換え
  （同じファイルの再処理は冪等・期間の重なりが違うファイル・古いファイルは 'stale'・他テナントは拒否）
- パーサーの出力が RPC 経由でそのまま保存され、金額の列を持たないこと
- 突合のサービスが実際の列名（orders.deadline_date 等）で受注・明細を読めること
- ユーザー JWT から RPC を実行できないこと

実行:
  supabase start
  cd backend && pytest __tests__/integration/test_shipment_entries.py -v --run-integration
"""

import hashlib
import uuid
from datetime import date, datetime
from typing import Any, cast

import pytest
from app.services.shipment_matching_service import get_order_shipments
from app.services.shipment_parser import parse_shipment_rows
from postgrest.exceptions import APIError

HEADER = [
    "得意先コード",
    "得意先名",
    "売上日",
    "伝票番号",
    "商品コード",
    "商品名/摘要",
    "数量",
    "金額",
    "備考",
]


def _parsed(period: str, *rows: list):
    return parse_shipment_rows([[period], HEADER, *rows])


def _row(sales_date: date, qty: int, note: str | None = "10/20納期分") -> list:
    return [
        "001",
        "架空工業株式会社",
        datetime.combine(sales_date, datetime.min.time()),
        "1",
        "ab1",
        "品A 図番123456",
        qty,
        99999,
        note,
    ]


def _insert_file(admin_db, tenant_id: str, modified_at: str) -> str:
    sha256 = hashlib.sha256(str(uuid.uuid4()).encode()).hexdigest()
    res = (
        admin_db.table("shipment_files")
        .insert(
            {
                "tenant_id": tenant_id,
                "source": "web",
                "uploaded_by": str(uuid.uuid4()),
                "sha256": sha256,
                "storage_path": f"{tenant_id}/{sha256}.xlsx",
                "original_path": "売上明細.xlsx",
                "file_name": "売上明細.xlsx",
                "size_bytes": 1024,
                "file_modified_at": modified_at,
            }
        )
        .execute()
    )
    return cast(list[dict[str, Any]], res.data)[0]["id"]


def _replace(db, tenant_id: str, file_id: str, parsed) -> dict[str, Any]:
    return (
        db.rpc(
            "replace_shipment_entries",
            {
                "p_tenant_id": tenant_id,
                "p_source_file_id": file_id,
                "p_period_start": parsed.period_start.isoformat(),
                "p_period_end": parsed.period_end.isoformat(),
                "p_entries": parsed.entries,
            },
        )
        .execute()
        .data
    )


def _stored(admin_db, tenant_id: str) -> list[tuple[str, int, str]]:
    res = (
        admin_db.table("shipment_entries")
        .select("sales_date, quantity, source_file_id, row_no")
        .eq("tenant_id", tenant_id)
        .order("sales_date")
        .order("row_no")
        .execute()
    )
    return [
        (r["sales_date"], r["quantity"], r["source_file_id"])
        for r in cast(list[dict[str, Any]], res.data)
    ]


OCT = "期間:2026年10月01日 ～ 2026年10月31日"
NOV = "期間:2026年11月01日 ～ 2026年11月30日"
OCT_NOV = "期間:2026年10月01日 ～ 2026年11月30日"


@pytest.fixture()
def tenants(admin_db):
    ids = {}
    for key in ("own", "other"):
        res = (
            admin_db.table("tenants")
            .insert({"name": f"integration test shipment entries ({key})"})
            .execute()
        )
        ids[key] = cast(list[dict[str, Any]], res.data)[0]["id"]

    yield ids

    # shipment_entries / shipment_coverage は shipment_files の ON DELETE CASCADE で消える
    for tenant_id in ids.values():
        admin_db.table("shipment_files").delete().eq("tenant_id", tenant_id).execute()
        admin_db.table("orders").delete().eq("tenant_id", tenant_id).execute()
        admin_db.table("products").delete().eq("tenant_id", tenant_id).execute()
        admin_db.table("customers").delete().eq("tenant_id", tenant_id).execute()
        admin_db.table("tenants").delete().eq("id", tenant_id).execute()


@pytest.mark.integration
class TestReplaceShipmentEntries:
    def test_saves_parser_output_without_amounts(self, admin_db, tenants):
        own = tenants["own"]
        file_id = _insert_file(admin_db, own, "2026-11-01T09:00:00+09:00")
        parsed = _parsed(OCT, _row(date(2026, 10, 5), 60))

        result = _replace(admin_db, own, file_id, parsed)

        assert result == {"status": "replaced", "entry_count": 1}
        row = (
            admin_db.table("shipment_entries")
            .select("*")
            .eq("tenant_id", own)
            .single()
            .execute()
            .data
        )
        assert row["customer_code"] == "001"
        assert row["product_code"] == "ab1"
        assert row["note"] == "10/20納期分"
        assert 99999 not in row.values()

    def test_reprocessing_same_period_does_not_duplicate(self, admin_db, tenants):
        own = tenants["own"]
        first = _insert_file(admin_db, own, "2026-11-01T09:00:00+09:00")
        second = _insert_file(admin_db, own, "2026-11-02T09:00:00+09:00")
        rows = [_row(date(2026, 10, 5), 60), _row(date(2026, 10, 5), 60)]

        _replace(admin_db, own, first, _parsed(OCT, *rows))
        _replace(admin_db, own, first, _parsed(OCT, *rows))
        _replace(admin_db, own, second, _parsed(OCT, *rows))

        assert _stored(admin_db, own) == [
            ("2026-10-05", 60, second),
            ("2026-10-05", 60, second),
        ]

    def test_newest_file_wins_per_day_across_different_periods(self, admin_db, tenants):
        own = tenants["own"]
        october = _insert_file(admin_db, own, "2026-11-01T09:00:00+09:00")
        two_months = _insert_file(admin_db, own, "2026-11-10T09:00:00+09:00")
        old_november = _insert_file(admin_db, own, "2026-11-05T09:00:00+09:00")

        _replace(admin_db, own, october, _parsed(OCT, _row(date(2026, 10, 5), 60)))
        assert _replace(
            admin_db,
            own,
            two_months,
            _parsed(OCT_NOV, _row(date(2026, 10, 5), 50), _row(date(2026, 11, 3), 30)),
        ) == {"status": "replaced", "entry_count": 2}
        # 2か月分より古い11月分のファイルは反映しない
        assert _replace(
            admin_db, own, old_november, _parsed(NOV, _row(date(2026, 11, 3), 99))
        ) == {"status": "stale", "entry_count": 0}

        assert _stored(admin_db, own) == [
            ("2026-10-05", 50, two_months),
            ("2026-11-03", 30, two_months),
        ]

    def test_partial_when_some_days_have_newer_file(self, admin_db, tenants):
        own = tenants["own"]
        newer_october = _insert_file(admin_db, own, "2026-11-10T09:00:00+09:00")
        older_two_months = _insert_file(admin_db, own, "2026-11-05T09:00:00+09:00")
        _replace(
            admin_db, own, newer_october, _parsed(OCT, _row(date(2026, 10, 5), 60))
        )

        result = _replace(
            admin_db,
            own,
            older_two_months,
            _parsed(OCT_NOV, _row(date(2026, 10, 5), 1), _row(date(2026, 11, 3), 30)),
        )

        assert result == {"status": "partial", "entry_count": 1}
        assert _stored(admin_db, own) == [
            ("2026-10-05", 60, newer_october),
            ("2026-11-03", 30, older_two_months),
        ]

    def test_rejects_file_of_other_tenant(self, admin_db, tenants):
        other_file = _insert_file(
            admin_db, tenants["other"], "2026-11-01T09:00:00+09:00"
        )

        with pytest.raises(APIError):
            _replace(
                admin_db,
                tenants["own"],
                other_file,
                _parsed(OCT, _row(date(2026, 10, 5), 1)),
            )

    def test_user_jwt_cannot_call_rpc(self, real_supabase_client, admin_db, tenants):
        own = tenants["own"]
        file_id = _insert_file(admin_db, own, "2026-11-01T09:00:00+09:00")

        with pytest.raises(APIError):
            _replace(
                real_supabase_client,
                own,
                file_id,
                _parsed(OCT, _row(date(2026, 10, 5), 1)),
            )


@pytest.mark.integration
class TestOrderShipments:
    def test_sums_partial_shipments_to_order(self, admin_db, tenants):
        own = tenants["own"]
        customer = (
            admin_db.table("customers")
            .insert({"tenant_id": own, "name": "架空工業株式会社"})
            .execute()
            .data[0]
        )
        product = (
            admin_db.table("products")
            .insert({"tenant_id": own, "name": "品A", "code": "123456"})
            .execute()
            .data[0]
        )
        order = (
            admin_db.table("orders")
            .insert(
                {
                    "tenant_id": own,
                    "customer_id": customer["id"],
                    "product_id": product["id"],
                    "quantity": 100,
                    "status": "in_progress",
                    "deadline_date": "2026-10-20",
                    "order_date": "2026-09-01T00:00:00+09:00",
                }
            )
            .execute()
            .data[0]
        )
        file_id = _insert_file(admin_db, own, "2026-11-01T09:00:00+09:00")
        _replace(
            admin_db,
            own,
            file_id,
            _parsed(OCT, _row(date(2026, 10, 5), 60), _row(date(2026, 10, 9), 40)),
        )

        result = get_order_shipments(admin_db, own, [order["id"]])

        [item] = result["items"]
        assert item["shipped_qty"] == 100
        assert item["is_fully_shipped"] is True
        assert [e["method"] for e in item["entries"]] == ["deadline", "deadline"]
        # 突合は候補を示すだけで、受注は送品済みにならない
        status = (
            admin_db.table("orders")
            .select("status")
            .eq("id", order["id"])
            .single()
            .execute()
            .data["status"]
        )
        assert status == "in_progress"
