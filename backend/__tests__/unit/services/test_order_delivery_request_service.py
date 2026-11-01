from datetime import date
from typing import Any
from unittest.mock import MagicMock

import pytest
from app.services.order_delivery_request_service import (
    DeliveryRequestEntry,
    find_target_order_id,
    parse_requested_date,
    pick_target_order_id,
    record_delivery_requests,
)

TODAY = date(2026, 11, 1)


@pytest.mark.unit
class TestPickTargetOrderId:
    def test_single_candidate_is_chosen(self):
        assert (
            pick_target_order_id([{"id": 5, "deadline_date": "2026-12-01"}], TODAY) == 5
        )

    def test_no_candidate_is_unlinked(self):
        assert pick_target_order_id([], TODAY) is None

    def test_multiple_candidates_prefer_the_only_overdue_one(self):
        candidates = [
            {"id": 1, "deadline_date": "2026-10-01"},
            {"id": 2, "deadline_date": "2026-12-01"},
        ]
        assert pick_target_order_id(candidates, TODAY) == 1

    def test_multiple_overdue_candidates_are_not_decided(self):
        candidates = [
            {"id": 1, "deadline_date": "2026-10-01"},
            {"id": 2, "deadline_date": "2026-10-15"},
        ]
        assert pick_target_order_id(candidates, TODAY) is None

    def test_multiple_candidates_without_overdue_are_not_decided(self):
        candidates: list[dict[str, Any]] = [
            {"id": 1, "deadline_date": "2026-12-01"},
            {"id": 2, "deadline_date": None},
        ]
        assert pick_target_order_id(candidates, TODAY) is None


@pytest.mark.unit
class TestParseRequestedDate:
    def test_iso_date(self):
        assert parse_requested_date("2026-11-03") == date(2026, 11, 3)

    @pytest.mark.parametrize("raw", [None, "", "11/3", 20261103])
    def test_unreadable_is_none(self, raw):
        assert parse_requested_date(raw) is None


@pytest.mark.unit
class TestFindTargetOrderId:
    def test_unknown_customer_or_product_is_not_queried(self):
        db = MagicMock()
        assert find_target_order_id(db, "t1", None, 3) is None
        assert find_target_order_id(db, "t1", 7, None) is None
        db.table.assert_not_called()

    def test_queries_only_open_production_orders_of_the_tenant(self):
        db = MagicMock()
        query = db.table.return_value
        for name in ("select", "eq", "in_", "is_"):
            getattr(query, name).return_value = query
        query.execute.return_value = MagicMock(data=[{"id": 9, "deadline_date": None}])

        assert find_target_order_id(db, "t1", 7, 3) == 9

        in_args = query.in_.call_args.args
        assert in_args[0] == "status"
        assert "shipped" not in in_args[1] and "completed" not in in_args[1]
        assert "draft" in in_args[1]
        eq_calls = [c.args for c in query.eq.call_args_list]
        assert ("tenant_id", "t1") in eq_calls
        assert ("order_type", "production") in eq_calls


@pytest.mark.unit
class TestRecordDeliveryRequests:
    def _db(self, existing=()):
        db = MagicMock()
        tables: dict[str, MagicMock] = {}

        def table(name):
            if name not in tables:
                q = MagicMock()
                for method in ("select", "eq", "in_", "is_"):
                    getattr(q, method).return_value = q
                q.execute.return_value = MagicMock(data=[])
                tables[name] = q
            return tables[name]

        db.table.side_effect = table
        table("order_delivery_requests").execute.return_value = MagicMock(
            data=[{"line_index": i} for i in existing]
        )
        table("orders").execute.return_value = MagicMock(
            data=[{"id": 42, "deadline_date": "2026-10-01"}]
        )
        return db, tables

    def test_records_each_line_with_linked_order(self):
        db, tables = self._db()
        entries = [
            DeliveryRequestEntry(0, "製品A", 500, date(2026, 11, 3), 3),
            DeliveryRequestEntry(1, "製品B", None, None, None),
        ]
        linked = record_delivery_requests(
            db, "t1", "att-1", 7, "delivery_chase", entries, "本文" * 200
        )
        assert linked == [42, None]
        inserts = [
            c.args[0] for c in tables["order_delivery_requests"].insert.call_args_list
        ]
        assert inserts[0]["order_id"] == 42
        assert inserts[0]["requested_date"] == "2026-11-03"
        assert inserts[0]["tenant_id"] == "t1"
        assert inserts[1]["order_id"] is None
        assert len(inserts[0]["body_snippet"]) == 200

    def test_without_lines_records_one_unlinked_row(self):
        db, tables = self._db()
        linked = record_delivery_requests(
            db, "t1", "att-1", 7, "split_delivery", [], "本文"
        )
        assert linked == [None]
        insert = tables["order_delivery_requests"].insert.call_args.args[0]
        assert insert["kind"] == "split_delivery"
        assert insert["line_index"] == 0

    def test_reprocessing_does_not_duplicate_recorded_lines(self):
        db, tables = self._db(existing=[0])
        entries = [
            DeliveryRequestEntry(0, "製品A", 500, None, 3),
            DeliveryRequestEntry(1, "製品B", 10, None, 3),
        ]
        linked = record_delivery_requests(
            db, "t1", "att-1", 7, "delivery_chase", entries, "本文"
        )
        assert len(linked) == 1
        inserts = tables["order_delivery_requests"].insert.call_args_list
        assert [c.args[0]["line_index"] for c in inserts] == [1]
