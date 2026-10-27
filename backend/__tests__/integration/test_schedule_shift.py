"""
Integration テスト: 工程の前倒し・後ろ倒し（Issue #582）

以下は実際の Postgres (RLS込み) でしか検証できないため integration tier に置く。
- ユーザー JWT（SECURITY INVOKER の RPC shift_order_process_schedules）で、対象と後工程のセグメントが
  作り直され、前工程・他の注文は変わらず、完成見込み・作業開始日・変更の記録が書かれること
- テナントの稼働カレンダーの休日を跳ばすこと、同じ設備の他の注文との重なりを返すこと
- 計算の後に計画が変わっていたら RPC が失敗して何も変わらないこと
- president 以外のロール・ずらせないステータスでは保存できないこと

実行:
  supabase start
  cd backend && pytest __tests__/integration/test_schedule_shift.py -v --run-integration
"""

from datetime import datetime
from typing import Any, cast

import pytest
from app.services.schedule_shift_service import (
    ShiftForbiddenError,
    ShiftOrderNotAdjustableError,
    shift_process,
)
from postgrest.exceptions import APIError

# 2026-11-02 は月曜日
SEGMENTS = {
    1: [("2026-11-02T09:00:00+09:00", "2026-11-02T12:00:00+09:00")],
    2: [
        ("2026-11-02T13:00:00+09:00", "2026-11-02T17:00:00+09:00"),
        ("2026-11-03T09:00:00+09:00", "2026-11-03T12:00:00+09:00"),
    ],
    3: [("2026-11-04T09:00:00+09:00", "2026-11-04T10:00:00+09:00")],
}


def _rows(res) -> list[dict[str, Any]]:
    return cast(list[dict[str, Any]], res.data)


def _insert(admin_db, table: str, values: dict[str, Any] | list[dict[str, Any]]):
    return _rows(admin_db.table(table).insert(values).execute())


def _instant(value: str) -> datetime:
    return datetime.fromisoformat(value)


@pytest.fixture()
def seeded(admin_db, auth_user_id):
    """工程1→2→3の受注と、工程2と同じ設備を使う他の受注。ログインユーザーは president"""
    tenant_id = _insert(
        admin_db, "tenants", {"name": "integration test schedule shift"}
    )[0]["id"]
    _insert(
        admin_db,
        "organization_members",
        {"user_id": auth_user_id, "tenant_id": tenant_id, "role": "president"},
    )
    customer_id = _insert(
        admin_db, "customers", {"tenant_id": tenant_id, "name": "顧客A社"}
    )[0]["id"]
    product_id = _insert(
        admin_db, "products", {"tenant_id": tenant_id, "name": "ピン", "code": None}
    )[0]["id"]
    press_id, inspect_id = (
        e["id"]
        for e in _insert(
            admin_db,
            "equipments",
            [
                {"tenant_id": tenant_id, "name": "プレス機"},
                {"tenant_id": tenant_id, "name": "検査機"},
            ],
        )
    )
    routings = {
        r["sequence_order"]: r["id"]
        for r in _insert(
            admin_db,
            "process_routings",
            [
                {
                    "tenant_id": tenant_id,
                    "product_id": product_id,
                    "sequence_order": seq,
                    "process_name": name,
                    "unit_time_seconds": "1.5",
                }
                for seq, name in ((1, "プレス"), (2, "検査"), (3, "梱包"))
            ],
        )
    }
    order_base = {
        "tenant_id": tenant_id,
        "product_id": product_id,
        "customer_id": customer_id,
        "quantity": 100,
        "status": "confirmed",
        "order_date": "2026-10-01T00:00:00+09:00",
        "scheduling_start_date": "2026-11-02",
    }
    order_id = _insert(
        admin_db,
        "orders",
        {
            **order_base,
            "deadline_date": "2026-11-04",
            "confirmed_deadline": "2026-11-04",
        },
    )[0]["id"]
    other_order_id = _insert(
        admin_db,
        "orders",
        {**order_base, "deadline_date": "2026-11-30", "order_number": "ORD-OTHER"},
    )[0]["id"]

    equipment = {1: press_id, 2: inspect_id, 3: press_id}
    _insert(
        admin_db,
        "production_schedules",
        [
            {
                "tenant_id": tenant_id,
                "order_id": order_id,
                "process_routing_id": routings[seq],
                "equipment_id": equipment[seq],
                "start_datetime": start,
                "end_datetime": end,
            }
            for seq, segments in SEGMENTS.items()
            for start, end in segments
        ]
        + [
            {
                "tenant_id": tenant_id,
                "order_id": other_order_id,
                "process_routing_id": routings[2],
                "equipment_id": inspect_id,
                "start_datetime": "2026-11-03T15:00:00+09:00",
                "end_datetime": "2026-11-03T16:00:00+09:00",
            }
        ],
    )

    yield {
        "tenant_id": tenant_id,
        "order_id": order_id,
        "other_order_id": other_order_id,
        "routings": routings,
        "inspect_id": inspect_id,
    }

    for table in (
        "production_schedule_shift_logs",
        "production_schedules",
        "orders",
        "process_routings",
        "products",
        "customers",
        "work_calendars",
        "equipments",
        "equipment_groups",
    ):
        admin_db.table(table).delete().eq("tenant_id", tenant_id).execute()
    admin_db.table("organization_members").delete().eq("user_id", auth_user_id).eq(
        "tenant_id", tenant_id
    ).execute()
    admin_db.table("tenants").delete().eq("id", tenant_id).execute()


def _segments(admin_db, order_id: int) -> dict[int, list[tuple[datetime, datetime]]]:
    rows = _rows(
        admin_db.table("production_schedules")
        .select("process_routing_id, start_datetime, end_datetime")
        .eq("order_id", order_id)
        .execute()
    )
    result: dict[int, list[tuple[datetime, datetime]]] = {}
    for r in rows:
        result.setdefault(r["process_routing_id"], []).append(
            (_instant(r["start_datetime"]), _instant(r["end_datetime"]))
        )
    return {k: sorted(v) for k, v in result.items()}


def _expected(seq_segments) -> list[tuple[datetime, datetime]]:
    return [(_instant(s), _instant(e)) for s, e in seq_segments]


def _order(admin_db, order_id: int) -> dict[str, Any]:
    return _rows(
        admin_db.table("orders")
        .select("confirmed_deadline, scheduling_start_date, scheduling_start_date_auto")
        .eq("id", order_id)
        .execute()
    )[0]


@pytest.mark.integration
class TestShiftProcess:
    def test_preview_does_not_save(self, admin_db, real_supabase_client, seeded):
        r = seeded["routings"]
        result = shift_process(
            real_supabase_client,
            seeded["tenant_id"],
            seeded["order_id"],
            r[2],
            1,
            dry_run=True,
        )

        assert result["saved"] is False
        assert [p["process_routing_id"] for p in result["processes"]] == [r[2], r[3]]
        assert result["confirmed_deadline_after"] == "2026-11-05"
        assert result["exceeds_desired_deadline"] is True
        # 工程2は火 13:00-17:00 に移り、他の受注の 15:00-16:00 と同じ検査機で重なる
        assert [
            (o["other_order_id"], o["other_order_number"], o["equipment_name"])
            for o in result["overlaps"]
        ] == [(seeded["other_order_id"], "ORD-OTHER", "検査機")]
        assert _segments(admin_db, seeded["order_id"])[r[2]] == _expected(SEGMENTS[2])

    def test_save_replaces_target_and_later_processes(
        self, admin_db, real_supabase_client, auth_user_id, seeded
    ):
        r = seeded["routings"]
        result = shift_process(
            real_supabase_client,
            seeded["tenant_id"],
            seeded["order_id"],
            r[2],
            1,
            dry_run=False,
        )

        assert result["saved"] is True
        segments = _segments(admin_db, seeded["order_id"])
        assert segments[r[1]] == _expected(SEGMENTS[1])
        assert segments[r[2]] == _expected(
            [
                ("2026-11-03T13:00:00+09:00", "2026-11-03T17:00:00+09:00"),
                ("2026-11-04T09:00:00+09:00", "2026-11-04T12:00:00+09:00"),
            ]
        )
        assert segments[r[3]] == _expected(
            [("2026-11-05T09:00:00+09:00", "2026-11-05T10:00:00+09:00")]
        )
        # 他の受注は変わらない
        assert _segments(admin_db, seeded["other_order_id"])[r[2]] == _expected(
            [("2026-11-03T15:00:00+09:00", "2026-11-03T16:00:00+09:00")]
        )
        order = _order(admin_db, seeded["order_id"])
        assert order["confirmed_deadline"] == "2026-11-05"
        # 最初の工程は動いていないので作業開始日はそのまま
        assert order["scheduling_start_date"] == "2026-11-02"

        logs = _rows(
            admin_db.table("production_schedule_shift_logs")
            .select("*")
            .eq("order_id", seeded["order_id"])
            .execute()
        )
        assert len(logs) == 1
        log = logs[0]
        assert log["actor_user_id"] == auth_user_id
        assert log["process_routing_id"] == r[2]
        assert log["working_days"] == 1
        assert log["confirmed_deadline_before"] == "2026-11-04"
        assert log["confirmed_deadline_after"] == "2026-11-05"
        assert [p["process_routing_id"] for p in log["processes"]] == [r[2], r[3]]

    def test_first_process_updates_scheduling_start_date(
        self, admin_db, real_supabase_client, seeded
    ):
        r = seeded["routings"]
        shift_process(
            real_supabase_client,
            seeded["tenant_id"],
            seeded["order_id"],
            r[1],
            2,
            dry_run=False,
        )

        order = _order(admin_db, seeded["order_id"])
        assert order["scheduling_start_date"] == "2026-11-04"
        assert order["scheduling_start_date_auto"] is False

    def test_skips_tenant_holiday(self, admin_db, real_supabase_client, seeded):
        _insert(
            admin_db,
            "work_calendars",
            {
                "tenant_id": seeded["tenant_id"],
                "date": "2026-11-05",
                "is_holiday": True,
            },
        )
        r = seeded["routings"]

        result = shift_process(
            real_supabase_client,
            seeded["tenant_id"],
            seeded["order_id"],
            r[3],
            1,
            dry_run=True,
        )

        # 水曜の工程3を後ろ倒し: 木曜は休日なので金曜へ
        assert result["processes"][0]["after"]["start_datetime"] == (
            "2026-11-06T09:00:00+09:00"
        )

    def test_rpc_rejects_stale_plan(self, admin_db, real_supabase_client, seeded):
        r = seeded["routings"]
        with pytest.raises(APIError) as exc_info:
            real_supabase_client.rpc(
                "shift_order_process_schedules",
                {
                    "p_tenant_id": seeded["tenant_id"],
                    "p_order_id": seeded["order_id"],
                    "p_process_routing_id": r[3],
                    "p_working_days": 1,
                    # 計算に使ったセグメントが現在と違う
                    "p_expected": [],
                    "p_segments": [
                        {
                            "process_routing_id": r[3],
                            "equipment_id": None,
                            "start_datetime": "2026-11-05T09:00:00+09:00",
                            "end_datetime": "2026-11-05T10:00:00+09:00",
                        }
                    ],
                    "p_confirmed_deadline": "2026-11-05",
                    "p_scheduling_start_date": None,
                    "p_stopped_at_previous": False,
                    "p_log_processes": [],
                },
            ).execute()

        assert exc_info.value.code == "P0001"
        assert _segments(admin_db, seeded["order_id"])[r[3]] == _expected(SEGMENTS[3])

    def test_non_president_cannot_save(
        self, admin_db, real_supabase_client, auth_user_id, seeded
    ):
        admin_db.table("organization_members").update({"role": "order_handler"}).eq(
            "tenant_id", seeded["tenant_id"]
        ).eq("user_id", auth_user_id).execute()
        r = seeded["routings"]

        with pytest.raises(ShiftForbiddenError):
            shift_process(
                real_supabase_client,
                seeded["tenant_id"],
                seeded["order_id"],
                r[2],
                1,
                dry_run=False,
            )

        assert _segments(admin_db, seeded["order_id"])[r[2]] == _expected(SEGMENTS[2])

    def test_shipped_order_is_not_adjustable(
        self, admin_db, real_supabase_client, seeded
    ):
        admin_db.table("orders").update({"status": "shipped"}).eq(
            "id", seeded["order_id"]
        ).execute()

        with pytest.raises(ShiftOrderNotAdjustableError):
            shift_process(
                real_supabase_client,
                seeded["tenant_id"],
                seeded["order_id"],
                seeded["routings"][2],
                1,
                dry_run=True,
            )
