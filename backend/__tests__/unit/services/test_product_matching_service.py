from unittest.mock import MagicMock

import pytest
from app.services.product_matching_service import (
    match_product_by_alias,
    match_product_by_code,
    match_products,
)


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


@pytest.mark.unit
class TestMatchProductByAlias:
    def test_match_returns_product_id(self):
        mock_db = MagicMock()
        mock_db.table().select().eq().eq().limit().execute.return_value = MagicMock(
            data=[{"product_id": 4242}]
        )

        result = match_product_by_alias(mock_db, "tenant-1", "  謎の表記ゆれ製品  ")

        assert result == 4242
        # raw_text は TRIM() のみ行った値で検索する
        mock_db.table().select().eq().eq.assert_called_with(
            "raw_text", "謎の表記ゆれ製品"
        )

    def test_no_match_returns_none(self):
        mock_db = MagicMock()
        mock_db.table().select().eq().eq().limit().execute.return_value = MagicMock(
            data=[]
        )

        result = match_product_by_alias(mock_db, "tenant-1", "未登録の製品名")

        assert result is None


@pytest.mark.unit
class TestMatchProducts:
    def _mock_db_with_rpc_result(self, rows):
        mock_db = MagicMock()
        mock_db.rpc().execute.return_value = MagicMock(data=rows)
        return mock_db

    def test_high_confidence_single_candidate_auto_confirms(self):
        mock_db = self._mock_db_with_rpc_result(
            [{"id": 10534, "name": "22750-50P-0000-1", "score": 0.9}]
        )

        result = match_products(mock_db, "tenant-1", "22750-50P-0000-01")

        assert result["product_id"] == 10534

    def test_low_confidence_single_candidate_does_not_auto_confirm(self):
        """
        品番のようにわずか1文字違いで別製品を指しうる文字列の場合、
        候補が1件だけでもスコアが低ければ自動確定してはいけない
        （デコイ製品への誤マッチを防ぐ）。
        """
        mock_db = self._mock_db_with_rpc_result(
            [{"id": 10535, "name": "22760-63C-0000-01-01", "score": 0.68}]
        )

        result = match_products(mock_db, "tenant-1", "25760-63C-0000-01-01")

        assert result["product_id"] is None
        assert result["candidates"][0]["product_id"] == 10535

    def test_close_second_candidate_does_not_auto_confirm(self):
        mock_db = self._mock_db_with_rpc_result(
            [
                {"id": 1, "name": "A-0001", "score": 0.85},
                {"id": 2, "name": "A-0002", "score": 0.80},
            ]
        )

        result = match_products(mock_db, "tenant-1", "A-0001")

        assert result["product_id"] is None

    def test_no_candidates_returns_none(self):
        mock_db = self._mock_db_with_rpc_result([])

        result = match_products(mock_db, "tenant-1", "nonexistent-product")

        assert result["product_id"] is None
        assert result["candidates"] == []
