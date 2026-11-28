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


def _order(order_id: int, product_id: int | None, **kwargs: Any) -> dict[str, Any]:
    return {
        "id": order_id,
        "product_id": product_id,
        "order_number": f"A-{order_id:03d}",
        "customer_order_no": None,
        "quantity": 100,
        "deadline_date": None,
        "confirmed_deadline": None,
        **kwargs,
    }


def _progress(order_id: int, good_qty: int = 0, status: str = "not_started"):
    return {"order_id": order_id, "good_qty": good_qty, "status": status}


_PRODUCTS = [
    {"id": 10, "name": "ピン φ6×20", "code": "P-620"},
    {"id": 11, "name": "ピン φ6×25", "code": None},
    {"id": 12, "name": "シャフト", "code": "S-1"},
]


@pytest.mark.unit
class TestGroupUnstartedOrderedProducts:
    def test_groups_orders_without_actuals_by_product(self):
        orders = [
            _order(1, 10, deadline_date="2026-12-20", quantity=500),
            _order(2, 10, confirmed_deadline="2026-12-05", quantity=300),
            _order(3, 11),
        ]
        progress = [_progress(1), _progress(1), _progress(2), _progress(3)]

        result = service.group_unstarted_ordered_products(orders, progress, _PRODUCTS)

        assert result == [
            {
                "product_id": 10,
                "name": "ピン φ6×20",
                "code": "P-620",
                "order_count": 2,
                # 代表の受注は希望納期（無ければ確定納期）の近い受注
                "nearest_deadline": "2026-12-05",
                "order_number": "A-002",
                "customer_order_no": None,
                "quantity": 300,
            },
            {
                "product_id": 11,
                "name": "ピン φ6×25",
                "code": None,
                "order_count": 1,
                "nearest_deadline": None,
                "order_number": "A-003",
                "customer_order_no": None,
                "quantity": 100,
            },
        ]

    def test_excludes_orders_with_any_actuals(self):
        orders = [_order(1, 10), _order(2, 11), _order(3, 12)]
        progress = [
            # 後の工程だけに実績がある受注も、実績が付いている
            _progress(1),
            _progress(1, good_qty=5, status="in_progress"),
            # 良品数0でも完了（後工程に実績）なら実績が付いている
            _progress(2, status="completed"),
            _progress(3),
        ]

        result = service.group_unstarted_ordered_products(orders, progress, _PRODUCTS)

        assert [r["product_id"] for r in result] == [12]

    def test_excludes_orders_without_progress_rows(self):
        # 日報で追う工程が1つも無い製品（#681）・再計算前の受注は進捗の行が無い
        result = service.group_unstarted_ordered_products(
            [_order(1, 10), _order(2, None)], [], _PRODUCTS
        )

        assert result == []

    def test_product_with_mixed_orders_counts_only_unstarted(self):
        orders = [
            _order(1, 10, deadline_date="2026-12-01"),
            _order(2, 10, deadline_date="2026-12-10"),
        ]
        progress = [_progress(1, good_qty=10, status="in_progress"), _progress(2)]

        result = service.group_unstarted_ordered_products(orders, progress, _PRODUCTS)

        assert len(result) == 1
        assert result[0]["order_count"] == 1
        assert result[0]["nearest_deadline"] == "2026-12-10"
        assert result[0]["order_number"] == "A-002"

    def test_sorted_by_nearest_deadline_then_product(self):
        orders = [
            _order(1, 12),
            _order(2, 11, deadline_date="2026-12-10"),
            _order(3, 10, deadline_date="2026-12-01"),
        ]
        progress = [_progress(1), _progress(2), _progress(3)]

        result = service.group_unstarted_ordered_products(orders, progress, _PRODUCTS)

        assert [r["product_id"] for r in result] == [10, 11, 12]


@pytest.mark.unit
class TestListUnstartedOrderedProducts:
    def test_reads_candidate_orders_progress_and_products(self):
        db, mocks = _db(
            {
                "orders": [_order(1, 10, deadline_date="2026-12-05")],
                "order_process_progress": [_progress(1)],
                "products": _PRODUCTS,
            }
        )

        result = service.list_unstarted_ordered_products(db, "t1", 5)

        assert [r["product_id"] for r in result] == [10]
        orders = mocks["orders"]
        orders.eq.assert_any_call("tenant_id", "t1")
        orders.eq.assert_any_call("customer_id", 5)
        orders.in_.assert_any_call("status", ["confirmed", "in_progress"])
        progress = mocks["order_process_progress"]
        progress.eq.assert_any_call("tenant_id", "t1")
        progress.in_.assert_any_call("order_id", [1])
        # `id` 列が無いので主キーで並べる
        progress.order.assert_any_call("order_id")
        progress.order.assert_any_call("process_routing_id")
        mocks["products"].in_.assert_any_call("id", [10])

    def test_no_orders_does_not_read_progress(self):
        db, mocks = _db({})

        assert service.list_unstarted_ordered_products(db, "t1", 5) == []
        assert "order_process_progress" not in mocks
