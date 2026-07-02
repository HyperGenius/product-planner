# __tests__/repositories/supabase/transaction/test_order_repo.py
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
