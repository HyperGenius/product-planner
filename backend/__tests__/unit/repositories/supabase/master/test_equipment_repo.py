# __tests__/repositories/supabase/master/test_equipment_repo.py
from unittest.mock import MagicMock

import pytest
from app.repositories.supa_infra import EquipmentRepository, SupabaseTableName


@pytest.mark.unit
class TestEquipmentRepository:
    @pytest.fixture
    def mock_client(self):
        """モッククライアント"""
        return MagicMock()

    @pytest.fixture
    def equipment_repo(self, mock_client):
        """汎用的なリポジトリとしてインスタンス化"""
        return EquipmentRepository(mock_client)

    def test_initialization(self, equipment_repo):
        """【重要】親クラスが正しいテーブル名で初期化されたかチェック"""
        assert equipment_repo.table_name == SupabaseTableName.EQUIPMENTS.value

    # --- 以下は独自メソッドのテスト ---

    def test_get_all_groups(self, equipment_repo, mock_client):
        """設備グループ一覧取得テスト"""
        expected = [{"id": 1, "name": "Group A"}]
        (
            mock_client.table.return_value.select.return_value.execute.return_value.data
        ) = expected

        result = equipment_repo.get_all_groups()

        assert result == expected
        mock_client.table.assert_called_with(SupabaseTableName.EQUIPMENT_GROUPS.value)

    @pytest.mark.parametrize(
        "group_name, expected",
        [
            ("New Group", {"id": 1, "name": "New Group"}),
        ],
    )
    def test_create_group(self, equipment_repo, mock_client, group_name, expected):
        """設備グループ作成テスト"""
        (
            mock_client.table.return_value.insert.return_value.execute.return_value.data
        ) = expected

        result = equipment_repo.create_group({"name": group_name})

        assert result == expected
        mock_client.table.assert_called_with(SupabaseTableName.EQUIPMENT_GROUPS.value)
        mock_client.table.return_value.insert.assert_called_with({"name": group_name})

    @pytest.mark.parametrize(
        "group_id, equipment_id, expected",
        [
            (1, 10, {"id": 100, "equipment_group_id": 1, "equipment_id": 10}),
        ],
    )
    def test_add_machine_to_group(
        self, equipment_repo, mock_client, group_id, equipment_id, expected
    ):
        """グループに機械を追加テスト"""

        # 返り値をモック
        mock_response = MagicMock()
        mock_response.data = [expected]  # insertの戻り値構造に合わせて調整
        (
            mock_client.table.return_value.insert.return_value.execute.return_value
        ) = mock_response

        result = equipment_repo.add_machine_to_group(group_id, equipment_id, "tenant_1")

        assert result == mock_response.data
        mock_client.table.assert_called_with(
            SupabaseTableName.EQUIPMENT_GROUP_MEMBERS.value
        )
        mock_client.table.return_value.insert.assert_called_with(
            {
                "tenant_id": "tenant_1",
                "equipment_group_id": group_id,
                "equipment_id": equipment_id,
            }
        )

    @pytest.mark.parametrize(
        "group_id, equipment_id, expected",
        [
            (1, 10, {"id": 100, "equipment_group_id": 1, "equipment_id": 10}),
        ],
    )
    def test_remove_machine_from_group(
        self, equipment_repo, mock_client, group_id, equipment_id, expected
    ):
        """グループから機械を削除テスト"""

        # 返り値をモック (chain: table -> delete -> eq -> eq -> execute)
        mock_response = MagicMock()
        (
            mock_client.table.return_value.delete.return_value.eq.return_value.eq.return_value.execute.return_value
        ) = mock_response

        result = equipment_repo.remove_machine_from_group(group_id, equipment_id)

        assert result == mock_response
        mock_client.table.assert_called_with(
            SupabaseTableName.EQUIPMENT_GROUP_MEMBERS.value
        )
        mock_client.table.return_value.delete.assert_called()

    @pytest.mark.parametrize(
        "equipment_id, mock_data, expected",
        [
            (1, {"equipment_name": "CNC Machine"}, "CNC Machine"),
            (2, {"equipment_name": "Lathe"}, "Lathe"),
            (3, None, None),  # データが取得できない場合
            (4, {}, None),  # equipment_nameが含まれていない場合
        ],
    )
    def test_get_equipment_name(
        self, equipment_repo, mock_client, equipment_id, mock_data, expected
    ):
        """設備名取得テスト (独自メソッド)"""
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

        result = equipment_repo.get_equipment_name(equipment_id)

        assert result == expected
        mock_client.table.assert_called_with(SupabaseTableName.EQUIPMENTS.value)
