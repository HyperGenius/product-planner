# __tests__/unit/repositories/supabase/transaction/test_schedule_repo.py
from typing import Any
from unittest.mock import MagicMock

import pytest
from app.repositories.supa_infra import SupabaseTableName
from app.repositories.supa_infra.transaction.schedule_repo import ScheduleRepository


def _query(data: list[dict[str, Any]]) -> MagicMock:
    """どのメソッドチェーンでも同じクエリを返し、execute() で data を返すクエリのモック"""
    query = MagicMock()
    for method in ("select", "lte", "gte", "in_", "eq", "order", "range"):
        getattr(query, method).return_value = query
    query.execute.return_value.data = data
    return query


def _schedule_row(**overrides: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": 1,
        "order_id": 10,
        "process_routing_id": 100,
        "equipment_id": 1000,
        "start_datetime": "2026-10-27T00:00:00+00:00",
        "end_datetime": "2026-10-27T03:00:00+00:00",
        "orders": {
            "order_number": "ORD-001",
            "customer_order_no": "PO-1",
            "customer_id": 5,
            "status": "confirmed",
            "quantity": 500,
            "deadline_date": "2026-10-31",
            "confirmed_deadline": "2026-11-02",
            "products": {"name": "製品A"},
            "customers": {"name": "顧客A社", "alias": "A社"},
        },
        "process_routings": {
            "process_name": "切削",
            "sequence_order": 2,
            "equipment_group_id": 7,
        },
        "equipments": {"name": "25Tシングルクランクプレス", "short_name": "ワシノ25t"},
    }
    row.update(overrides)
    return row


@pytest.mark.unit
class TestScheduleRepositoryGetByPeriod:
    @pytest.fixture
    def mock_client(self) -> MagicMock:
        return MagicMock()

    def _setup(
        self,
        mock_client: MagicMock,
        schedules: list[dict[str, Any]],
        groups: list[dict[str, Any]],
        all_segments: list[dict[str, Any]],
    ) -> None:
        # production_schedules は「期間のセグメント」→「受注の全セグメント」の順に引く
        schedule_queries = iter([_query(schedules), _query(all_segments)])
        groups_query = _query(groups)

        def table(name: str) -> MagicMock:
            if name == SupabaseTableName.EQUIPMENT_GROUPS.value:
                return groups_query
            return next(schedule_queries)

        mock_client.table.side_effect = table

    def test_returns_order_and_process_fields(self, mock_client):
        """受注の数量・納期・顧客の注文番号と工程順を返す"""
        self._setup(
            mock_client,
            [_schedule_row()],
            [{"id": 7, "name": "プレス", "equipment_group_members": []}],
            [],
        )

        [item] = ScheduleRepository(mock_client).get_by_period(
            "2026-10-25", "2026-10-31"
        )

        assert item["order_number"] == "ORD-001"
        assert item["customer_order_no"] == "PO-1"
        assert item["order_status"] == "confirmed"
        assert item["quantity"] == 500
        assert item["desired_deadline"] == "2026-10-31"
        assert item["confirmed_deadline"] == "2026-11-02"
        assert item["product_name"] == "製品A"
        assert item["customer_id"] == 5
        assert item["customer_name"] == "顧客A社"
        assert item["customer_alias"] == "A社"
        assert item["process_name"] == "切削"
        assert item["sequence_order"] == 2
        assert item["equipment_name"] == "ワシノ25t"
        assert item["equipment_group_id"] == 7

    def test_unknown_customer_is_null(self, mock_client):
        """顧客不明（customer_id が NULL、#521）は customer_name を null で返す"""
        row = _schedule_row()
        row["orders"] = {**row["orders"], "customer_id": None, "customers": None}
        self._setup(mock_client, [row], [], [])

        [item] = ScheduleRepository(mock_client).get_by_period(
            "2026-10-25", "2026-10-31"
        )

        assert item["customer_id"] is None
        assert item["customer_name"] is None
        assert item["customer_alias"] is None

    def test_single_member_group_uses_equipment_display_name(self, mock_client):
        """1台グループはメンバーの設備の表示名、複数台はグループ名（#512）"""
        rows = [
            _schedule_row(id=1),
            _schedule_row(
                id=2,
                process_routing_id=101,
                process_routings={
                    "process_name": "検査",
                    "sequence_order": 3,
                    "equipment_group_id": 8,
                },
            ),
        ]
        groups = [
            {
                "id": 7,
                "name": "古い名前",
                "equipment_group_members": [
                    {"equipments": {"name": "25Tプレス", "short_name": "ワシノ25t"}}
                ],
            },
            {
                "id": 8,
                "name": "検査機",
                "equipment_group_members": [
                    {"equipments": {"name": "検査機1", "short_name": None}},
                    {"equipments": {"name": "検査機2", "short_name": None}},
                ],
            },
        ]
        self._setup(mock_client, rows, groups, [])

        items = ScheduleRepository(mock_client).get_by_period(
            "2026-10-25", "2026-10-31"
        )

        assert [i["equipment_group_name"] for i in items] == ["ワシノ25t", "検査機"]

    def test_extents_include_segments_outside_period(self, mock_client):
        """工程・受注の開始〜終了は、表示期間外のセグメントも含めて求める"""
        all_segments = [
            {
                "id": 1,
                "order_id": 10,
                "process_routing_id": 100,
                "start_datetime": "2026-10-27T00:00:00+00:00",
                "end_datetime": "2026-10-27T03:00:00+00:00",
            },
            {
                "id": 5,
                "order_id": 10,
                "process_routing_id": 100,
                "start_datetime": "2026-10-20T00:00:00+00:00",
                "end_datetime": "2026-10-20T08:00:00+00:00",
            },
            {
                "id": 6,
                "order_id": 10,
                "process_routing_id": 101,
                # 小数秒付きでも時刻として比較する
                "start_datetime": "2026-11-02T00:00:00.5+00:00",
                "end_datetime": "2026-11-02T08:00:00.123+00:00",
            },
        ]
        self._setup(mock_client, [_schedule_row()], [], all_segments)

        [item] = ScheduleRepository(mock_client).get_by_period(
            "2026-10-25", "2026-10-31"
        )

        assert item["process_start_datetime"] == "2026-10-20T00:00:00+00:00"
        assert item["process_end_datetime"] == "2026-10-27T03:00:00+00:00"
        assert item["order_start_datetime"] == "2026-10-20T00:00:00+00:00"
        assert item["order_end_datetime"] == "2026-11-02T08:00:00.123+00:00"

    def test_empty_period_skips_related_queries(self, mock_client):
        """期間にスケジュールが無ければ、設備グループ・全セグメントを引かない"""
        self._setup(mock_client, [], [], [])

        assert (
            ScheduleRepository(mock_client).get_by_period("2026-10-25", "2026-10-31")
            == []
        )
        assert mock_client.table.call_count == 1
