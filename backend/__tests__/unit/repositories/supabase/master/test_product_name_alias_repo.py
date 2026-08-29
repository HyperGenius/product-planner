# __tests__/unit/repositories/supabase/master/test_product_name_alias_repo.py
from unittest.mock import MagicMock

import pytest
from app.repositories.supa_infra import ProductNameAliasRepository, SupabaseTableName


@pytest.mark.unit
class TestProductNameAliasRepository:
    @pytest.fixture
    def mock_client(self):
        return MagicMock()

    @pytest.fixture
    def repo(self, mock_client):
        return ProductNameAliasRepository(mock_client)

    def _update_chain(self, mock_client):
        return (
            mock_client.table.return_value.update.return_value.eq.return_value.execute
        )

    def _delete_chain(self, mock_client):
        return (
            mock_client.table.return_value.delete.return_value.eq.return_value.execute
        )

    def test_initialization(self, repo):
        assert repo.table_name == SupabaseTableName.PRODUCT_NAME_ALIASES.value

    def test_update_product_id_returns_row(self, repo, mock_client):
        self._update_chain(mock_client).return_value = MagicMock(
            data=[{"id": "a-1", "product_id": 8, "source": "manual_correction"}]
        )

        result = repo.update_product_id("a-1", 8)

        assert result["product_id"] == 8

    def test_update_product_id_raises_when_no_row_affected(self, repo, mock_client):
        """RLS/条件不一致で更新0件なら例外（Copilotレビュー指摘対応）。"""
        self._update_chain(mock_client).return_value = MagicMock(data=[])

        with pytest.raises(ValueError):
            repo.update_product_id("a-1", 8)

    def test_delete_by_id_true_when_count_positive(self, repo, mock_client):
        self._delete_chain(mock_client).return_value = MagicMock(count=1)

        assert repo.delete_by_id("a-1") is True

    def test_delete_by_id_false_when_count_zero(self, repo, mock_client):
        """削除0件なら False（呼び出し側が 404 に変換する）。"""
        self._delete_chain(mock_client).return_value = MagicMock(count=0)

        assert repo.delete_by_id("a-1") is False
