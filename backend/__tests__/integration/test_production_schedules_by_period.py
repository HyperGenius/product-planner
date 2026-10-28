"""
Integration テスト: ガント用の生産スケジュール一覧 ScheduleRepository.get_by_period (Issue #579)

PostgREST の埋め込み（受注・工程・設備グループのメンバー）と、受注の全セグメントからの
開始〜終了の集計が実際のスキーマで意図通りに動くかは unit のモックでは確かめられないため
integration tier に置く。
- 受注の数量・希望納期（DB 列は deadline_date）・完成見込み・工程順を返すこと
- 顧客不明（customer_id が NULL、#521）は customer_name が null になること
- 1台グループは設備名・呼称の変更に追従しないので、メンバーの設備の表示名で返すこと（#512）
- 工程・受注の開始〜終了は表示期間外のセグメントを含むこと

実行:
  supabase start
  cd backend && pytest __tests__/integration/test_production_schedules_by_period.py -v --run-integration
"""

from datetime import datetime
from typing import Any, cast

import pytest
from app.repositories.supa_infra.transaction.schedule_repo import ScheduleRepository


def _rows(res) -> list[dict[str, Any]]:
    return cast(list[dict[str, Any]], res.data)


def _insert(admin_db, table: str, values: dict[str, Any] | list[dict[str, Any]]):
    return _rows(admin_db.table(table).insert(values).execute())


def _same_instant(a: str | None, b: str) -> bool:
    return a is not None and datetime.fromisoformat(a) == datetime.fromisoformat(b)


@pytest.fixture()
def seeded(admin_db):
    """1台グループの工程（工程1）と複数台グループの工程（工程2）を持つ製品と、その受注2件"""
    tenant_id = _insert(
        admin_db, "tenants", {"name": "integration test production schedules"}
    )[0]["id"]
    customer_id = _insert(
        admin_db,
        "customers",
        {"tenant_id": tenant_id, "name": "顧客A社", "alias": "A社"},
    )[0]["id"]
    product_id = _insert(
        admin_db, "products", {"tenant_id": tenant_id, "name": "ピン", "code": None}
    )[0]["id"]

    # 設備の INSERT トリガーが、表示名と同名の1台グループを作る（#512）
    solo_equipment_id = _insert(
        admin_db,
        "equipments",
        {"tenant_id": tenant_id, "name": "25Tプレス", "short_name": "旧呼称"},
    )[0]["id"]
    solo_group_id = _rows(
        admin_db.table("equipment_group_members")
        .select("equipment_group_id")
        .eq("equipment_id", solo_equipment_id)
        .execute()
    )[0]["equipment_group_id"]
    # 呼称を変えても1台グループの名前は追従しない
    admin_db.table("equipments").update({"short_name": "ワシノ25t"}).eq(
        "id", solo_equipment_id
    ).execute()

    shared_group_id = _insert(
        admin_db, "equipment_groups", {"tenant_id": tenant_id, "name": "検査機"}
    )[0]["id"]
    shared_equipment_ids = [
        e["id"]
        for e in _insert(
            admin_db,
            "equipments",
            [
                {"tenant_id": tenant_id, "name": "検査機1"},
                {"tenant_id": tenant_id, "name": "検査機2"},
            ],
        )
    ]
    _insert(
        admin_db,
        "equipment_group_members",
        [
            {
                "tenant_id": tenant_id,
                "equipment_group_id": shared_group_id,
                "equipment_id": equipment_id,
            }
            for equipment_id in shared_equipment_ids
        ],
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
                    "sequence_order": 1,
                    "process_name": "プレス",
                    "unit_time_seconds": "1.5",
                    "equipment_group_id": solo_group_id,
                },
                {
                    "tenant_id": tenant_id,
                    "product_id": product_id,
                    "sequence_order": 2,
                    "process_name": "検査",
                    "unit_time_seconds": "1.5",
                    "equipment_group_id": shared_group_id,
                },
            ],
        )
    }

    order_base = {
        "tenant_id": tenant_id,
        "product_id": product_id,
        "status": "confirmed",
        "order_date": "2026-10-01T00:00:00+09:00",
    }
    known_order_id = _insert(
        admin_db,
        "orders",
        {
            **order_base,
            "customer_id": customer_id,
            "quantity": 500,
            "deadline_date": "2026-10-31",
            "confirmed_deadline": "2026-11-02",
        },
    )[0]["id"]
    unknown_order_id = _insert(
        admin_db,
        "orders",
        {
            **order_base,
            "customer_id": None,
            "quantity": 1200,
            "deadline_date": "2026-11-30",
        },
    )[0]["id"]

    def segment(order_id: int, seq: int, equipment_id: int, start: str, end: str):
        return {
            "tenant_id": tenant_id,
            "order_id": order_id,
            "process_routing_id": routings[seq],
            "equipment_id": equipment_id,
            "start_datetime": start,
            "end_datetime": end,
        }

    _insert(
        admin_db,
        "production_schedules",
        [
            # 工程1: 表示期間（10/26〜10/31）より前のセグメントと期間内のセグメント
            segment(
                known_order_id,
                1,
                solo_equipment_id,
                "2026-10-20T09:00:00+09:00",
                "2026-10-20T17:00:00+09:00",
            ),
            segment(
                known_order_id,
                1,
                solo_equipment_id,
                "2026-10-27T09:00:00+09:00",
                "2026-10-27T12:00:00+09:00",
            ),
            # 工程2: 期間内のセグメントと期間より後のセグメント
            segment(
                known_order_id,
                2,
                shared_equipment_ids[0],
                "2026-10-28T09:00:00+09:00",
                "2026-10-28T17:00:00+09:00",
            ),
            segment(
                known_order_id,
                2,
                shared_equipment_ids[0],
                "2026-11-02T09:00:00+09:00",
                "2026-11-02T12:00:00+09:00",
            ),
            segment(
                unknown_order_id,
                1,
                solo_equipment_id,
                "2026-10-29T09:00:00+09:00",
                "2026-10-29T12:00:00+09:00",
            ),
        ],
    )

    yield {
        "known_order_id": known_order_id,
        "unknown_order_id": unknown_order_id,
        "solo_group_id": solo_group_id,
        "shared_group_id": shared_group_id,
    }

    # equipment_group_members は equipments / equipment_groups の ON DELETE CASCADE で消える
    for table in (
        "production_schedules",
        "orders",
        "process_routings",
        "products",
        "customers",
        "equipments",
        "equipment_groups",
    ):
        admin_db.table(table).delete().eq("tenant_id", tenant_id).execute()
    admin_db.table("tenants").delete().eq("id", tenant_id).execute()


def _own_rows(
    rows: list[dict[str, Any]], seeded: dict[str, Any]
) -> list[dict[str, Any]]:
    """service role は全テナントの行を読むので、このテストで作った受注の行に絞る"""
    order_ids = {seeded["known_order_id"], seeded["unknown_order_id"]}
    return sorted(
        (r for r in rows if r["order_id"] in order_ids),
        key=lambda r: datetime.fromisoformat(r["start_datetime"]),
    )


@pytest.mark.integration
class TestGetByPeriod:
    def test_returns_order_process_and_group_fields(self, admin_db, seeded):
        rows = _own_rows(
            ScheduleRepository(admin_db).get_by_period("2026-10-26", "2026-10-31"),
            seeded,
        )

        # 期間と重なるセグメントだけ（10/20・11/02 は含まない）
        assert len(rows) == 3
        press, inspection, unknown = rows

        assert press["order_id"] == seeded["known_order_id"]
        assert press["customer_name"] == "顧客A社"
        assert press["customer_alias"] == "A社"
        assert press["product_name"] == "ピン"
        assert press["quantity"] == 500
        assert press["desired_deadline"] == "2026-10-31"
        assert press["confirmed_deadline"] == "2026-11-02"
        assert press["order_status"] == "confirmed"
        assert press["process_name"] == "プレス"
        assert press["sequence_order"] == 1
        assert press["equipment_name"] == "ワシノ25t"
        assert inspection["sequence_order"] == 2

        # 1台グループはメンバーの設備の表示名（グループ名「旧呼称」ではない）、複数台はグループ名
        assert press["equipment_group_id"] == seeded["solo_group_id"]
        assert press["equipment_group_name"] == "ワシノ25t"
        assert inspection["equipment_group_name"] == "検査機"

        assert unknown["order_id"] == seeded["unknown_order_id"]
        assert unknown["customer_name"] is None
        assert unknown["customer_alias"] is None

    def test_extents_include_segments_outside_period(self, admin_db, seeded):
        rows = _own_rows(
            ScheduleRepository(admin_db).get_by_period("2026-10-26", "2026-10-31"),
            seeded,
        )
        press, inspection, _ = rows

        assert _same_instant(
            press["process_start_datetime"], "2026-10-20T09:00:00+09:00"
        )
        assert _same_instant(press["process_end_datetime"], "2026-10-27T12:00:00+09:00")
        assert _same_instant(
            inspection["process_end_datetime"], "2026-11-02T12:00:00+09:00"
        )
        for row in (press, inspection):
            assert _same_instant(
                row["order_start_datetime"], "2026-10-20T09:00:00+09:00"
            )
            assert _same_instant(row["order_end_datetime"], "2026-11-02T12:00:00+09:00")

    def test_filter_by_equipment_group(self, admin_db, seeded):
        rows = _own_rows(
            ScheduleRepository(admin_db).get_by_period(
                "2026-10-26", "2026-10-31", seeded["shared_group_id"]
            ),
            seeded,
        )
        assert [r["process_name"] for r in rows] == ["検査"]
