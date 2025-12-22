# __tests__/repositories/supabase/common/test_base_repo.py
import pytest
from unittest.mock import MagicMock
from repositories.supabase.common import BaseRepository


@pytest.mark.unit
class TestBaseRepository:
    @pytest.fixture
    def mock_client(self):
        return MagicMock()

    @pytest.fixture
    def base_repo(self, mock_client):
        """汎用的なリポジトリとしてインスタンス化"""
        return BaseRepository(mock_client, "test_table")

    def test_get_by_id(self, base_repo, mock_client):
        """ID指定取得のテスト: 正しいチェーンでクエリが呼ばれるか"""
        expected = {"id": 1, "name": "Test"}

        # モックのセットアップ
        (
            mock_client.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data
        ) = expected

        # --- 実行 ---
        result = base_repo.get_by_id(1)

        # --- 検証 ---
        assert result == expected

        # テーブル名が正しいか
        mock_client.table.assert_called_with("test_table")
        # ID指定が正しいか
        mock_client.table.return_value.select.return_value.eq.assert_called_with(
            "id", 1
        )

    def test_create(self, base_repo, mock_client):
        """作成のテスト: insert -> select -> single の流れ"""
        input_data = {"name": "New Item"}
        expected = {"id": 2, "name": "New Item"}

        # --- モックのセットアップ ---
        (
            mock_client.table.return_value.insert.return_value.execute.return_value.data
        ) = expected

        # --- 実行 ---
        result = base_repo.create(input_data)

        # --- 検証 ---
        assert result == expected
        mock_client.table.return_value.insert.assert_called_with(input_data)

    def test_update(self, base_repo, mock_client):
        """更新のテスト"""
        update_data = {"name": "Updated"}

        # --- モックのセットアップ ---
        (
            mock_client.table.return_value.update.return_value.eq.return_value.select.return_value.single.return_value.execute.return_value.data
        ) = {"id": 1, "name": "Updated"}

        # --- 実行 ---
        base_repo.update(1, update_data)

        # --- 検証 ---
        mock_client.table.return_value.update.assert_called_with(update_data)

    def test_delete_success(self, base_repo, mock_client):
        """削除成功時のテスト"""

        # --- モックのセットアップ ---
        mock_res = MagicMock()
        mock_res.count = 1  # count=1 が返ってくる想定
        (
            mock_client.table.return_value.delete.return_value.eq.return_value.execute.return_value
        ) = mock_res

        # --- 実行, 検証 ---
        assert base_repo.delete(1) is True

    def test_delete_failure(self, base_repo, mock_client):
        """存在しないID削除時のテスト"""

        # --- モックのセットアップ ---
        mock_res = MagicMock()
        mock_res.count = 0  # 削除数0
        (
            mock_client.table.return_value.delete.return_value.eq.return_value.execute.return_value
        ) = mock_res

        # --- 実行, 検証 ---
        assert base_repo.delete(999) is False
