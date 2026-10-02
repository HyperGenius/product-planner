# __tests__/api/routers/master/test_equipments.py
from unittest.mock import MagicMock

import pytest
from app.dependencies import (
    get_current_user_id,
    get_equipment_repo,
    get_supabase_client,
)

# テスト対象のAPIインスタンス
from app.main import app
from app.repositories.supa_infra.common import DuplicateRecordError
from fastapi.testclient import TestClient

# テストクライアントの作成
client = TestClient(app)


@pytest.mark.api
class TestEquipmentRouter:
    """equipmentsルーターのユニットテスト"""

    @pytest.fixture
    def mock_repo(self):
        """リポジトリのモックを作成するフィクスチャ"""
        mock = MagicMock()
        return mock

    @pytest.fixture(autouse=True)
    def override_dependency(self, mock_repo):
        """
        テスト実行中だけ get_equipment_repo を mock_repo に差し替える。
        get_current_user_id / get_supabase_client は get_current_tenant_id の
        テナント所属検証で参照されるため、所属ありの結果を返すようにモックする。
        """
        mock_tenant_client = MagicMock()
        mock_tenant_client.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value.data = {
            "user_id": "test-user-id"
        }
        app.dependency_overrides[get_equipment_repo] = lambda: mock_repo
        app.dependency_overrides[get_current_user_id] = lambda: "test-user-id"
        app.dependency_overrides[get_supabase_client] = lambda: mock_tenant_client
        yield
        app.dependency_overrides = {}

    def test_get_equipments(self, mock_repo):
        """GET /: 全件取得のテスト"""
        expected_data = [
            {"id": 1, "name": "Equipment A", "tenant_id": "uuid-1"},
            {"id": 2, "name": "Equipment B", "tenant_id": "uuid-1"},
        ]
        mock_repo.get_all.return_value = expected_data

        response = client.get("/equipments")

        assert response.status_code == 200
        assert response.json() == expected_data
        mock_repo.get_all.assert_called_once()

    def test_get_equipment_by_id(self, mock_repo):
        """GET /{id}: 1件取得のテスト"""
        equipment_id = 1
        expected_data = {"id": equipment_id, "name": "Equipment A"}
        mock_repo.get_by_id.return_value = expected_data

        response = client.get(f"/equipments/{equipment_id}")

        assert response.status_code == 200
        assert response.json() == expected_data
        mock_repo.get_by_id.assert_called_with(equipment_id)

    def test_create_equipment(self, headers, mock_repo):
        """POST /: 新規作成のテスト"""
        payload = {
            "name": "New Equipment",
            "group_ids": [],
        }
        created_data = {
            "id": 100,
            "name": "New Equipment",
        }

        mock_repo.create.return_value = created_data

        response = client.post("/equipments", json=payload, headers=headers)

        assert response.status_code == 200
        assert response.json() == created_data

        mock_repo.create.assert_called_once()
        # group_idsは除外されていることを確認
        call_args = mock_repo.create.call_args[0][0]
        assert call_args["name"] == "New Equipment"
        assert "group_ids" not in call_args

    def test_update_equipment(self, headers, mock_repo):
        """PATCH /{id}: 更新のテスト"""
        equipment_id = 1
        payload = {"name": "Updated Name"}
        updated_data = {
            "id": equipment_id,
            "name": "Updated Name",
            "tenant_id": "uuid-1",
        }

        mock_repo.update.return_value = updated_data

        response = client.patch(
            f"/equipments/{equipment_id}", json=payload, headers=headers
        )

        assert response.status_code == 200
        assert response.json() == updated_data

        mock_repo.update.assert_called_once()
        called_id, called_data = mock_repo.update.call_args[0]
        assert called_id == equipment_id
        assert called_data == payload

    def test_delete_equipment_success(self, headers, mock_repo):
        """DELETE /{id}: 削除成功時のテスト"""
        equipment_id = 1
        mock_repo.delete.return_value = True

        response = client.delete(f"/equipments/{equipment_id}", headers=headers)

        assert response.status_code == 200
        assert response.json() == {"status": "deleted"}
        mock_repo.delete.assert_called_with(equipment_id)

    def test_delete_equipment_not_found(self, headers, mock_repo):
        """DELETE /{id}: 存在しないID削除時の404エラーテスト"""
        equipment_id = 999
        mock_repo.delete.return_value = False

        response = client.delete(f"/equipments/{equipment_id}", headers=headers)

        assert response.status_code == 404
        assert response.json()["detail"] == "Not found"

    def test_create_equipment_with_ledger_fields(self, headers, mock_repo):
        """POST /: 設備台帳の列（Issue #486）がそのまま repo へ渡ること"""
        payload = {
            "name": "15t 3号機",
            "ledger_no": 3,
            "maker": "メーカーA",
            "model": "MODEL-15",
            "manufactured_on": "S.53年11月",
            "serial_no": "SN-0001",
            "note": "備考",
        }
        mock_repo.create.return_value = {"id": 100, **payload}

        response = client.post("/equipments", json=payload, headers=headers)

        assert response.status_code == 200
        call_args = mock_repo.create.call_args[0][0]
        for key, value in payload.items():
            assert call_args[key] == value

    def test_create_equipment_rejects_non_positive_ledger_no(self, headers, mock_repo):
        """POST /: 台帳番号は 1 以上"""
        response = client.post(
            "/equipments", json={"name": "X", "ledger_no": 0}, headers=headers
        )

        assert response.status_code == 422
        mock_repo.create.assert_not_called()

    def test_update_equipment_duplicate_ledger_no_returns_409(self, headers, mock_repo):
        """PATCH /{id}: 台帳番号の重複は 409 duplicate_ledger_no（制約名は返さない）"""
        mock_repo.update.side_effect = DuplicateRecordError(
            "dup",
            constraint='duplicate key value violates unique constraint "equipments_tenant_id_ledger_no_key"',
        )

        response = client.patch(
            "/equipments/1", json={"name": "15t 3号機", "ledger_no": 3}, headers=headers
        )

        assert response.status_code == 409
        detail = response.json()["detail"]
        assert detail["error"] == "duplicate_ledger_no"
        assert "equipments_tenant_id_ledger_no_key" not in response.text

    def test_create_equipment_duplicate_display_name_returns_409(
        self, headers, mock_repo
    ):
        """POST /: 表示名（呼称、無ければ設備名）の重複は 409 duplicate_display_name"""
        mock_repo.create.side_effect = DuplicateRecordError(
            "dup",
            constraint='duplicate key value violates unique constraint "equipments_tenant_id_display_name_key"',
        )

        response = client.post(
            "/equipments", json={"name": "15Tシングルクランクプレス"}, headers=headers
        )

        assert response.status_code == 409
        detail = response.json()["detail"]
        assert detail["error"] == "duplicate_display_name"
        assert "呼称" in detail["message"]
        assert "equipments_tenant_id_display_name_key" not in response.text

    def test_update_equipment_duplicate_display_name_returns_409(
        self, headers, mock_repo
    ):
        """PATCH /{id}: 呼称が他の設備の表示名と重なる場合も 409 duplicate_display_name"""
        mock_repo.update.side_effect = DuplicateRecordError(
            "dup",
            constraint='duplicate key value violates unique constraint "equipments_tenant_id_display_name_key"',
        )

        response = client.patch(
            "/equipments/1",
            json={"name": "25Tシングルクランクプレス", "short_name": "25tプレス"},
            headers=headers,
        )

        assert response.status_code == 409
        assert response.json()["detail"]["error"] == "duplicate_display_name"

    @pytest.mark.parametrize(
        "short_name, expected", [(" 25tプレス ", "25tプレス"), ("  ", None), ("", None)]
    )
    def test_create_equipment_normalizes_short_name(
        self, headers, mock_repo, short_name, expected
    ):
        """POST /: 呼称は前後の空白を除き、空欄は未設定（NULL）にする"""
        mock_repo.create.return_value = {"id": 100}

        response = client.post(
            "/equipments",
            json={"name": "25Tシングルクランクプレス", "short_name": short_name},
            headers=headers,
        )

        assert response.status_code == 200
        assert mock_repo.create.call_args[0][0]["short_name"] == expected
