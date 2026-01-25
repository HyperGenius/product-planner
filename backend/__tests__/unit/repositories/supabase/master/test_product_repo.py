# __tests__/repositories/supabase/master/test_product_repo.py
from unittest.mock import MagicMock

import pytest
from app.repositories.supa_infra import ProductRepository, SupabaseTableName


@pytest.mark.unit
class TestProductRepository:
    @pytest.fixture
    def mock_client(self):
        """モッククライアント"""
        return MagicMock()

    @pytest.fixture
    def product_repo(self, mock_client):
        """汎用的なリポジトリとしてインスタンス化"""
        return ProductRepository(mock_client)

    def test_initialization(self, product_repo):
        """【重要】親クラスが正しいテーブル名で初期化されたかチェック"""
        assert product_repo.table_name == SupabaseTableName.PRODUCTS.value

    # --- 以下は独自メソッドのテスト ---

    @pytest.mark.parametrize(
        "product_id, expected",
        [
            (10, [{"id": 100, "process_name": "Test"}]),
        ],
    )
    def test_get_routings_by_product(
        self, product_repo, mock_client, product_id, expected
    ):
        """製品IDに紐づく工程取得テスト (独自メソッド)"""

        # ProductテーブルではなくProcessRoutingテーブルを見ているか？
        (
            mock_client.table.return_value.select.return_value.eq.return_value.order.return_value.execute.return_value.data
        ) = expected

        result = product_repo.get_routings_by_product(product_id)

        assert result == expected
        # ここで重要なのは「テーブル名がPROCESS_ROUTINGSになっていること」
        mock_client.table.assert_called_with(SupabaseTableName.PROCESS_ROUTINGS.value)

    @pytest.mark.parametrize(
        "data, expected",
        [
            (
                {"product_id": 1, "process_name": "New Process"},
                {"id": 1, "process_name": "New Process"},
            ),
        ],
    )
    def test_create_routing(self, product_repo, mock_client, data, expected):
        """工程作成テスト (独自メソッド)"""

        (
            mock_client.table.return_value.insert.return_value.execute.return_value.data
        ) = expected

        result = product_repo.create_routing(data)

        assert result == expected

        # 正しいテーブルにinsertしているか検証
        mock_client.table.assert_called_with(SupabaseTableName.PROCESS_ROUTINGS.value)
        mock_client.table.return_value.insert.assert_called_with(data)

    @pytest.mark.parametrize(
        "routing_id, mock_data, expected",
        [
            (1, {"process_name": "組立"}, "組立"),
            (2, {"process_name": "検査"}, "検査"),
            (3, None, "不明"),  # データが取得できない場合
            (4, {}, "不明"),  # process_nameが含まれていない場合
        ],
    )
    def test_get_process_name(
        self, product_repo, mock_client, routing_id, mock_data, expected
    ):
        """工程名取得テスト (独自メソッド)"""
        # Mockの設定
        if mock_data is not None:
            (
                mock_client.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data
            ) = mock_data
        else:
            # データが取得できない場合は例外を発生させる
            mock_client.table.return_value.select.return_value.eq.return_value.single.return_value.execute.side_effect = Exception(
                "Not found"
            )

        result = product_repo.get_process_name(routing_id)

        assert result == expected
        mock_client.table.assert_called_with(SupabaseTableName.PROCESS_ROUTINGS.value)
