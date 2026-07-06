# __tests__/repositories/supabase/master/test_product_repo.py
from typing import Any
from unittest.mock import MagicMock, patch

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

    def test_get_all_flags_no_process(self, product_repo, mock_client):
        """工程が0件の製品は has_process=False, has_unconfirmed_process=False"""
        (
            mock_client.table.return_value.select.return_value.execute.return_value.data
        ) = [{"id": 1, "process_routings": []}]

        result = product_repo.get_all()

        assert result[0]["has_process"] is False
        assert result[0]["has_unconfirmed_process"] is False

    def test_get_all_flags_unconfirmed_process(self, product_repo, mock_client):
        """工程はあるが未確定を含む製品は has_process=True, has_unconfirmed_process=True"""
        (
            mock_client.table.return_value.select.return_value.execute.return_value.data
        ) = [
            {
                "id": 1,
                "process_routings": [
                    {"id": 100, "is_confirmed": True},
                    {"id": 101, "is_confirmed": False},
                ],
            }
        ]

        result = product_repo.get_all()

        assert result[0]["has_process"] is True
        assert result[0]["has_unconfirmed_process"] is True

    def test_get_all_flags_all_confirmed(self, product_repo, mock_client):
        """全工程が確定済みの製品は has_process=True, has_unconfirmed_process=False"""
        (
            mock_client.table.return_value.select.return_value.execute.return_value.data
        ) = [
            {
                "id": 1,
                "process_routings": [{"id": 100, "is_confirmed": True}],
            }
        ]

        result = product_repo.get_all()

        assert result[0]["has_process"] is True
        assert result[0]["has_unconfirmed_process"] is False

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

    def test_replace_routings_for_product(self, product_repo):
        """一括保存: 更新・新規作成・削除が items との差分に応じて行われる"""
        items: list[dict[str, Any]] = [
            {
                "id": 1,
                "sequence_order": 1,
                "process_name": "工程A",
                "equipment_group_id": None,
                "setup_time_seconds": 0,
                "unit_time_seconds": 1.0,
            },
            {
                "id": None,
                "sequence_order": 2,
                "process_name": "工程C",
                "equipment_group_id": None,
                "setup_time_seconds": 0,
                "unit_time_seconds": 1.0,
            },
        ]

        with (
            patch.object(
                product_repo,
                "get_routings_by_product",
                side_effect=[
                    # 1回目: 既存取得（工程1,2が既存）
                    [
                        {"id": 1, "sequence_order": 1, "process_name": "旧工程A"},
                        {"id": 2, "sequence_order": 2, "process_name": "工程B"},
                    ],
                    # 2回目: 保存後の再取得結果
                    [
                        {"id": 1, "sequence_order": 1, "process_name": "工程A"},
                        {"id": 3, "sequence_order": 2, "process_name": "工程C"},
                    ],
                ],
            ),
            patch.object(product_repo, "delete_routing") as mock_delete,
            patch.object(product_repo, "update_routing") as mock_update,
            patch.object(product_repo, "create_routing") as mock_create,
        ):
            result = product_repo.replace_routings_for_product(1, "tenant-1", items)

            # 工程2はitemsに含まれないため削除
            mock_delete.assert_called_once_with(2)
            # 工程1はitemsに含まれるため更新（idはpayloadから除去される）
            mock_update.assert_called_once_with(
                1, {k: v for k, v in items[0].items() if k != "id"}
            )
            # id=Noneの工程は新規作成、product_id/tenant_idが付与される
            mock_create.assert_called_once_with(
                {k: v for k, v in items[1].items() if k != "id"}
                | {"product_id": 1, "tenant_id": "tenant-1"}
            )

        assert result == [
            {"id": 1, "sequence_order": 1, "process_name": "工程A"},
            {"id": 3, "sequence_order": 2, "process_name": "工程C"},
        ]
