from unittest.mock import MagicMock

import pytest
from app.services.product_matching_service import match_product_by_code


@pytest.mark.unit
class TestMatchProductByCode:
    def test_single_match_returns_product_id(self):
        mock_db = MagicMock()
        mock_db.table().select().eq().eq().limit().execute.return_value = MagicMock(
            data=[{"id": 42}]
        )

        result = match_product_by_code(mock_db, "tenant-1", "22750-50P-0000-01")

        assert result == 42

    def test_no_match_returns_none(self):
        mock_db = MagicMock()
        mock_db.table().select().eq().eq().limit().execute.return_value = MagicMock(
            data=[]
        )

        result = match_product_by_code(mock_db, "tenant-1", "unknown-code")

        assert result is None

    def test_multiple_matches_returns_none(self):
        mock_db = MagicMock()
        mock_db.table().select().eq().eq().limit().execute.return_value = MagicMock(
            data=[{"id": 1}, {"id": 2}]
        )

        result = match_product_by_code(mock_db, "tenant-1", "ambiguous-code")

        assert result is None
