"""order_simulation_service のユニットテスト（Issue #477）。"""

from datetime import date, datetime, time
from unittest.mock import MagicMock, call

import app.services.order_simulation_service as order_simulation_module
import pytest
from app.scheduler_logic import InvalidRoutingDurationError, RoutingUnconfirmedError
from app.services.order_simulation_service import (
    auto_simulate_intake_order,
    deadline_from_schedules,
)
from app.utils.calendar import JST, WORK_START_HOUR

_SCHEDULES = [
    {
        "process_routing_id": 1,
        "start_datetime": "2026-10-01T09:00:00+09:00",
        "end_datetime": "2026-10-01T17:00:00+09:00",
    },
    {
        "process_routing_id": 2,
        "start_datetime": "2026-10-02T09:00:00+09:00",
        "end_datetime": "2026-10-05T12:00:00+09:00",
    },
]


def _mock_db(order_row: dict | None) -> MagicMock:
    """orders の SELECT が order_row を返す admin クライアントのモック。"""
    db = MagicMock()
    select_chain = db.table.return_value.select.return_value
    select_chain.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = (
        [order_row] if order_row is not None else []
    )
    return db


def _update_payload(db: MagicMock) -> dict:
    return db.table.return_value.update.call_args.args[0]


@pytest.mark.unit
class TestDeadlineFromSchedules:
    def test_returns_latest_end_date_across_timezones(self):
        schedules = [
            {"end_datetime": "2026-10-05T12:00:00+09:00"},
            # UTC 表記だが実時刻は JST 2026-10-06 00:30 相当で最も遅い
            {"end_datetime": "2026-10-05T15:30:00Z"},
            {"end_datetime": "2026-10-04T17:00:00+09:00"},
        ]
        assert deadline_from_schedules(schedules) == "2026-10-05"


@pytest.mark.unit
class TestAutoSimulateIntakeOrder:
    @pytest.fixture
    def mock_schedule_order(self, monkeypatch):
        mock = MagicMock(return_value=_SCHEDULES)
        monkeypatch.setattr(order_simulation_module, "schedule_order", mock)
        return mock

    def test_sets_next_day_and_persists_simulated_deadline(self, mock_schedule_order):
        """作業開始日が未設定なら処理日(JST)+1日を起点にシミュし、同一 UPDATE で保存する。"""
        db = _mock_db(
            {
                "id": 10,
                "product_id": 100,
                "quantity": 5,
                "scheduling_start_date": None,
            }
        )

        ok = auto_simulate_intake_order(db, "tenant-1", 10, today=date(2026, 9, 29))

        assert ok is True
        kwargs = mock_schedule_order.call_args.kwargs
        assert kwargs["dry_run"] is True
        assert kwargs["order_id"] == 10
        assert kwargs["product_id"] == 100
        assert kwargs["quantity"] == 5
        assert kwargs["tenant_id"] == "tenant-1"
        assert kwargs["start_time"] == datetime.combine(
            date(2026, 9, 30), time(WORK_START_HOUR, 0), tzinfo=JST
        )
        assert _update_payload(db) == {
            "is_scheduled": True,
            "simulated_deadline": "2026-10-05",
            "scheduling_start_date": "2026-09-30",
            "scheduling_start_date_auto": True,
        }

    def test_keeps_existing_scheduling_start_date(self, mock_schedule_order):
        """既に作業開始日が入っている受注（updated 等）は上書きせず、その日を起点にする。"""
        db = _mock_db(
            {
                "id": 10,
                "product_id": 100,
                "quantity": 5,
                "scheduling_start_date": "2026-10-10",
            }
        )

        ok = auto_simulate_intake_order(db, "tenant-1", 10, today=date(2026, 9, 29))

        assert ok is True
        assert mock_schedule_order.call_args.kwargs["start_time"] == datetime.combine(
            date(2026, 10, 10), time(WORK_START_HOUR, 0), tzinfo=JST
        )
        assert _update_payload(db) == {
            "is_scheduled": True,
            "simulated_deadline": "2026-10-05",
        }

    def test_scopes_queries_by_tenant(self, mock_schedule_order):
        """admin クライアントで動くため、受注の SELECT / UPDATE を tenant_id で絞り込む。"""
        db = _mock_db(
            {
                "id": 10,
                "product_id": 100,
                "quantity": 5,
                "scheduling_start_date": None,
            }
        )

        auto_simulate_intake_order(db, "tenant-1", 10, today=date(2026, 9, 29))

        select_chain = db.table.return_value.select.return_value
        assert select_chain.eq.call_args == call("id", 10)
        assert select_chain.eq.return_value.eq.call_args == call(
            "tenant_id", "tenant-1"
        )
        update_chain = db.table.return_value.update.return_value
        assert update_chain.eq.call_args == call("id", 10)
        assert update_chain.eq.return_value.eq.call_args == call(
            "tenant_id", "tenant-1"
        )

    def test_skips_unmatched_product(self, mock_schedule_order):
        """製品未照合（product_id IS NULL）はシミュせず、作業開始日も設定しない。"""
        db = _mock_db(
            {
                "id": 10,
                "product_id": None,
                "quantity": 5,
                "scheduling_start_date": None,
            }
        )

        ok = auto_simulate_intake_order(db, "tenant-1", 10, today=date(2026, 9, 29))

        assert ok is False
        mock_schedule_order.assert_not_called()
        db.table.return_value.update.assert_not_called()

    def test_skips_missing_order(self, mock_schedule_order):
        db = _mock_db(None)

        ok = auto_simulate_intake_order(db, "tenant-1", 10, today=date(2026, 9, 29))

        assert ok is False
        mock_schedule_order.assert_not_called()

    @pytest.mark.parametrize(
        "exc",
        [
            RoutingUnconfirmedError(no_routing=True),
            InvalidRoutingDurationError(routing_id=7),
            RuntimeError("boom"),
        ],
    )
    def test_scheduler_errors_are_swallowed(self, monkeypatch, exc):
        """工程未登録・所要時間不正・想定外の例外はログのみでスキップし、送出しない。"""
        monkeypatch.setattr(
            order_simulation_module, "schedule_order", MagicMock(side_effect=exc)
        )
        db = _mock_db(
            {
                "id": 10,
                "product_id": 100,
                "quantity": 5,
                "scheduling_start_date": None,
            }
        )

        ok = auto_simulate_intake_order(db, "tenant-1", 10, today=date(2026, 9, 29))

        assert ok is False
        db.table.return_value.update.assert_not_called()

    def test_select_error_is_swallowed(self, mock_schedule_order):
        db = MagicMock()
        db.table.side_effect = RuntimeError("db down")

        assert auto_simulate_intake_order(db, "tenant-1", 10) is False
        mock_schedule_order.assert_not_called()
