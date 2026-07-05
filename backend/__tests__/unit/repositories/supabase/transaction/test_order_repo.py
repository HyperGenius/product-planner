# __tests__/repositories/supabase/transaction/test_order_repo.py
from typing import Any, cast
from unittest.mock import MagicMock

import pytest
from app.repositories.supa_infra.transaction.order_repo import OrderRepository


@pytest.mark.unit
class TestOrderRepositoryGetAll:
    def test_get_all_filters_superseded_orders(self):
        mock_client = MagicMock()
        expected = [{"id": 1, "superseded_at": None}]
        (
            mock_client.table.return_value.select.return_value.is_.return_value.execute.return_value.data
        ) = expected

        repo = OrderRepository(mock_client)
        result = repo.get_all()

        assert result == expected
        mock_client.table.return_value.select.return_value.is_.assert_called_with(
            "superseded_at", "null"
        )

    def test_get_all_returns_empty_list_when_no_data(self):
        mock_client = MagicMock()
        (
            mock_client.table.return_value.select.return_value.is_.return_value.execute.return_value.data
        ) = None

        repo = OrderRepository(mock_client)

        assert repo.get_all() == []


@pytest.mark.unit
class TestOrderRepositoryRoutingStatus:
    def _make_client(self, orders_data, routings_data):
        mock_client = MagicMock()
        (
            mock_client.table.return_value.select.return_value.is_.return_value.execute.return_value.data
        ) = orders_data
        (
            mock_client.table.return_value.select.return_value.in_.return_value.execute.return_value.data
        ) = routings_data
        (
            mock_client.table.return_value.select.return_value.eq.return_value.execute.return_value.data
        ) = routings_data
        return mock_client

    def test_get_by_id_no_routings_at_all(self):
        """工程が1件も登録されていない場合、has_no_routings と has_unconfirmed_routings が両方 True"""
        mock_client = self._make_client([{"id": 1, "product_id": 10}], [])
        (
            mock_client.table.return_value.select.return_value.eq.return_value.execute.return_value.data
        ) = []
        repo = OrderRepository(mock_client)
        cast(Any, repo).get_by_id = MagicMock(return_value={"id": 1, "product_id": 10})

        result = repo.get_by_id_with_routing_status(1)

        assert result is not None
        assert result["has_no_routings"] is True
        assert result["has_unconfirmed_routings"] is True

    def test_get_by_id_routings_exist_but_unconfirmed(self):
        """工程は登録済みだが未確定の場合、has_no_routings は False、has_unconfirmed_routings は True"""
        mock_client = self._make_client(
            [{"id": 1, "product_id": 10}],
            [{"product_id": 10, "is_confirmed": False}],
        )
        repo = OrderRepository(mock_client)
        cast(Any, repo).get_by_id = MagicMock(return_value={"id": 1, "product_id": 10})

        result = repo.get_by_id_with_routing_status(1)

        assert result is not None
        assert result["has_no_routings"] is False
        assert result["has_unconfirmed_routings"] is True

    def test_get_by_id_routings_all_confirmed(self):
        """全ての工程が確定済みの場合、両フラグとも False"""
        mock_client = self._make_client(
            [{"id": 1, "product_id": 10}],
            [{"product_id": 10, "is_confirmed": True}],
        )
        repo = OrderRepository(mock_client)
        cast(Any, repo).get_by_id = MagicMock(return_value={"id": 1, "product_id": 10})

        result = repo.get_by_id_with_routing_status(1)

        assert result is not None
        assert result["has_no_routings"] is False
        assert result["has_unconfirmed_routings"] is False

    def test_get_all_with_routing_status_distinguishes_flags(self):
        """全件取得でも工程未設定/未確定を区別する"""
        orders_data = [
            {"id": 1, "product_id": 10},  # 工程未設定
            {"id": 2, "product_id": 20},  # 工程あり・未確定
            {"id": 3, "product_id": 30},  # 工程あり・確定済み
        ]
        routings_data = [
            {"product_id": 20, "is_confirmed": False},
            {"product_id": 30, "is_confirmed": True},
        ]
        mock_client = self._make_client(orders_data, routings_data)
        repo = OrderRepository(mock_client)
        cast(Any, repo).get_all = MagicMock(return_value=orders_data)

        result = repo.get_all_with_routing_status()

        by_id = {o["id"]: o for o in result}
        assert by_id[1]["has_no_routings"] is True
        assert by_id[1]["has_unconfirmed_routings"] is True
        assert by_id[2]["has_no_routings"] is False
        assert by_id[2]["has_unconfirmed_routings"] is True
        assert by_id[3]["has_no_routings"] is False
        assert by_id[3]["has_unconfirmed_routings"] is False

    def test_get_all_with_routing_status_all_orders_without_product_id(self):
        """全注文が product_id=None（product_ids が空）でも例外にならず両フラグが True になる"""
        orders_data = [
            {"id": 1, "product_id": None},
            {"id": 2, "product_id": None},
        ]
        mock_client = self._make_client(orders_data, [])
        repo = OrderRepository(mock_client)
        cast(Any, repo).get_all = MagicMock(return_value=orders_data)

        result = repo.get_all_with_routing_status()

        mock_client.table.return_value.select.return_value.in_.assert_not_called()
        by_id = {o["id"]: o for o in result}
        assert by_id[1]["has_no_routings"] is True
        assert by_id[1]["has_unconfirmed_routings"] is True
        assert by_id[2]["has_no_routings"] is True
        assert by_id[2]["has_unconfirmed_routings"] is True
