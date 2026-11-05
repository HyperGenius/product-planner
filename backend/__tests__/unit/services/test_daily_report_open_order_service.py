"""日報の名寄せ（製品）の受注状況のテスト (Issue #646)。"""

from typing import Any
from unittest.mock import MagicMock

import pytest
from app.services import daily_report_open_order_service as service


def _db(
    tables: dict[str, list[dict[str, Any]]],
) -> tuple[MagicMock, dict[str, MagicMock]]:
    """どのクエリ連鎖でも、テーブルごとの行を1ページで返すモック。"""
    mocks: dict[str, MagicMock] = {}

    def table(name: str) -> MagicMock:
        if name not in mocks:
            query = MagicMock()
            for method in (
                "select",
                "eq",
                "in_",
                "order",
                "range",
            ):
                getattr(query, method).return_value = query
            query.not_.is_.return_value = query
            query.execute.return_value = MagicMock(data=tables.get(name, []))
            mocks[name] = query
        return mocks[name]

    db = MagicMock()
    db.table.side_effect = table
    return db, mocks


@pytest.mark.unit
class TestSummarizeCandidateOrders:
    def test_counts_and_nearest_deadline_per_product(self):
        db, mocks = _db(
            {
                "orders": [
                    {
                        "id": 1,
                        "product_id": 10,
                        "deadline_date": "2026-12-20",
                        "confirmed_deadline": None,
                    },
                    {
                        "id": 2,
                        "product_id": 10,
                        "deadline_date": None,
                        "confirmed_deadline": "2026-12-05",
                    },
                    {
                        "id": 3,
                        "product_id": 11,
                        "deadline_date": None,
                        "confirmed_deadline": None,
                    },
                ]
            }
        )

        result = service.summarize_candidate_orders(db, "t1", 5, [10, 11, 12])

        assert result == {
            10: {"open_order_count": 2, "nearest_deadline": "2026-12-05"},
            11: {"open_order_count": 1, "nearest_deadline": None},
        }
        orders = mocks["orders"]
        orders.in_.assert_any_call("status", ["confirmed", "in_progress"])
        orders.in_.assert_any_call("product_id", [10, 11, 12])
        orders.eq.assert_any_call("customer_id", 5)
        orders.eq.assert_any_call("tenant_id", "t1")

    def test_no_candidates_does_not_query(self):
        db, _ = _db({})
        assert service.summarize_candidate_orders(db, "t1", 5, []) == {}
        db.table.assert_not_called()


@pytest.mark.unit
class TestListCustomerOpenOrders:
    def test_sorted_by_deadline_with_allocatable_flag(self):
        db, mocks = _db(
            {
                "orders": [
                    {
                        "id": 1,
                        "order_number": "A-1",
                        "customer_order_no": None,
                        "product_id": 10,
                        "quantity": 100,
                        "status": "draft",
                        "deadline_date": None,
                        "confirmed_deadline": None,
                    },
                    {
                        "id": 2,
                        "order_number": "A-2",
                        "customer_order_no": "PO-9",
                        "product_id": 11,
                        "quantity": 50,
                        "status": "confirmed",
                        "deadline_date": "2026-12-20",
                        "confirmed_deadline": None,
                    },
                    {
                        "id": 3,
                        "order_number": None,
                        "customer_order_no": None,
                        "product_id": 10,
                        "quantity": None,
                        "status": "in_progress",
                        "deadline_date": "2026-12-01",
                        "confirmed_deadline": None,
                    },
                ],
                "products": [
                    {"id": 10, "name": "ピン"},
                    {"id": 11, "name": "ボルト"},
                ],
            }
        )

        result = service.list_customer_open_orders(db, "t1", 5)

        assert [(o["order_id"], o["allocatable"]) for o in result] == [
            (3, True),
            (2, True),
            (1, False),
        ]
        assert result[0]["product_name"] == "ピン"
        assert result[1]["customer_order_no"] == "PO-9"
        assert result[1]["desired_deadline"] == "2026-12-20"
        mocks["orders"].in_.assert_any_call(
            "status", ["draft", "pending_approval", "confirmed", "in_progress"]
        )
        mocks["products"].in_.assert_any_call("id", [10, 11])

    def test_empty_does_not_query_products(self):
        db, mocks = _db({"orders": []})
        assert service.list_customer_open_orders(db, "t1", 5) == []
        assert "products" not in mocks
