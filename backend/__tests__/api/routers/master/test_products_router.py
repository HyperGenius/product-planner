# __tests__/unit/routers/master/test_products_router.py
import uuid
from unittest.mock import MagicMock

import pytest
from app.dependencies import (
    get_current_user_id,
    get_product_name_alias_history_repo,
    get_product_name_alias_repo,
    get_product_repo,
    get_supabase_client,
)

# テスト対象のAPIインスタンス
from app.main import app
from fastapi.testclient import TestClient

# テストクライアントの作成
client = TestClient(app)


def _set_role(mock_client: MagicMock, role: str) -> None:
    """organization_members からのロール取得チェーンのモックを設定する。"""
    mock_client.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value.data = {
        "role": role
    }


@pytest.mark.api
class TestProductRouter:
    """productsルーターのユニットテスト"""

    @pytest.fixture
    def mock_repo(self):
        """リポジトリのモックを作成するフィクスチャ"""
        mock = MagicMock()
        return mock

    @pytest.fixture
    def mock_client(self):
        """Supabaseクライアントのモックを作成するフィクスチャ"""
        return MagicMock()

    @pytest.fixture
    def mock_alias_history_repo(self):
        """製品名別名履歴リポジトリのモックを作成するフィクスチャ"""
        mock = MagicMock()
        return mock

    @pytest.fixture
    def mock_alias_repo(self):
        """製品名別名辞書リポジトリのモックを作成するフィクスチャ（Issue #351）"""
        mock = MagicMock()
        return mock

    @pytest.fixture(autouse=True)
    def override_dependency(
        self, mock_repo, mock_client, mock_alias_history_repo, mock_alias_repo
    ):
        """
        テスト実行中だけ get_product_repo / get_current_user_id / get_supabase_client を差し替える。
        PATCH は is_active 更新時にロールチェックのため get_current_user_id
        (実体はSupabase認証) を要求するため、テストでは固定IDに差し替える。
        """
        app.dependency_overrides[get_product_repo] = lambda: mock_repo
        app.dependency_overrides[get_current_user_id] = lambda: "test-user-id"
        app.dependency_overrides[get_supabase_client] = lambda: mock_client
        app.dependency_overrides[get_product_name_alias_history_repo] = (
            lambda: mock_alias_history_repo
        )
        app.dependency_overrides[get_product_name_alias_repo] = lambda: mock_alias_repo
        yield
        # テスト終了後に元に戻す（重要）
        app.dependency_overrides = {}

    def test_get_products(self, mock_repo):
        """GET /: 全件取得のテスト（is_active=falseも含む全件を返すこと）"""
        # 1. モックの振る舞いを定義
        expected_data = [
            {
                "id": 1,
                "name": "Product A",
                "code": "P001",
                "tenant_id": "uuid-1",
                "is_active": True,
            },
            {
                "id": 2,
                "name": "Product B",
                "code": "P002",
                "tenant_id": "uuid-1",
                "is_active": False,
            },
        ]
        mock_repo.get_all.return_value = expected_data

        # 2. リクエスト実行
        response = client.get("/products")  # prefixの設定に合わせてパスを調整

        # 3. 検証
        assert response.status_code == 200
        assert response.json() == expected_data
        mock_repo.get_all.assert_called_once()

    def test_get_product_by_id(self, mock_repo):
        """GET /{id}: 1件取得のテスト"""
        product_id = 1
        expected_data = {"id": product_id, "name": "Product A"}
        mock_repo.get_by_id.return_value = expected_data

        response = client.get(f"/products/{product_id}")

        assert response.status_code == 200
        assert response.json() == expected_data
        mock_repo.get_by_id.assert_called_with(product_id)

    def test_create_product(self, mock_repo):
        """POST /: 新規作成のテスト（is_activeのデフォルトはTrue）"""
        tenant_id_str = str(uuid.uuid4())
        headers = {"x-tenant-id": tenant_id_str}
        payload = {
            "name": "New Product",
            "code": "NP001",
        }
        # 保存後に返される想定のデータ（is_active はデフォルトの True）
        created_data = {**payload, "id": 100, "is_active": True}

        mock_repo.create.return_value = created_data

        response = client.post("/products", json=payload, headers=headers)

        assert response.status_code == 200
        assert response.json() == created_data

        # モックが正しい引数で呼ばれたか確認
        # (payloadの内容が Pydantic -> dict に変換されて渡されているか)
        mock_repo.create.assert_called_once()
        call_args = mock_repo.create.call_args[0][0]
        assert call_args["name"] == "New Product"

    def test_update_product(self, headers, mock_repo):
        """PATCH /{id}: 更新のテスト"""
        product_id = 1
        payload = {"name": "Updated Name"}
        updated_data = {
            "id": product_id,
            "name": "Updated Name",
            "code": "P001",
        }

        mock_repo.update.return_value = updated_data

        response = client.patch(
            f"/products/{product_id}", json=payload, headers=headers
        )

        assert response.status_code == 200
        assert response.json() == updated_data

        # exclude_unset=True が効いているか確認（渡したフィールドだけ更新に行っているか）
        mock_repo.update.assert_called_once()
        called_id, called_data = mock_repo.update.call_args[0]
        assert called_id == product_id
        assert called_data == payload

    def test_toggle_product_is_active(self, headers, mock_repo, mock_client):
        """PATCH /{id}: is_active フラグの有効/無効切り替えテスト（president は許可）"""
        _set_role(mock_client, "president")
        product_id = 1
        # 無効化するケース
        payload = {"is_active": False}
        updated_data = {
            "id": product_id,
            "name": "Product A",
            "code": "P001",
            "is_active": False,
        }

        mock_repo.update.return_value = updated_data

        response = client.patch(
            f"/products/{product_id}", json=payload, headers=headers
        )

        assert response.status_code == 200
        assert response.json()["is_active"] is False

        # is_active だけが渡されているか確認（exclude_unset=True が効いているか）
        called_id, called_data = mock_repo.update.call_args[0]
        assert called_id == product_id
        assert called_data == {"is_active": False}

    def test_toggle_product_is_active_allowed_for_platform_admin(
        self, headers, mock_repo, mock_client
    ):
        """PATCH /{id}: is_active の切り替えは platform_admin も許可"""
        _set_role(mock_client, "platform_admin")
        product_id = 1
        updated_data = {"id": product_id, "is_active": False}
        mock_repo.update.return_value = updated_data

        response = client.patch(
            f"/products/{product_id}", json={"is_active": False}, headers=headers
        )

        assert response.status_code == 200

    def test_toggle_product_is_active_forbidden_for_order_handler(
        self, headers, mock_repo, mock_client
    ):
        """PATCH /{id}: is_active の切り替えは president/platform_admin 以外は403"""
        _set_role(mock_client, "order_handler")
        product_id = 1

        response = client.patch(
            f"/products/{product_id}", json={"is_active": False}, headers=headers
        )

        assert response.status_code == 403
        mock_repo.update.assert_not_called()

    def test_get_product_name_alias_history_empty(self, mock_alias_history_repo):
        """GET /{id}/aliases: 履歴が0件の場合は空配列を返すこと"""
        product_id = 1
        mock_alias_history_repo.get_by_product_id.return_value = []

        response = client.get(f"/products/{product_id}/aliases")

        assert response.status_code == 200
        assert response.json() == []
        mock_alias_history_repo.get_by_product_id.assert_called_with(product_id)

    def test_get_product_name_alias_history_resolves_actor_name(
        self, mock_alias_history_repo, mock_client
    ):
        """GET /{id}/aliases: changed_by を担当者の表示名に解決した集約レスポンスを返すこと"""
        product_id = 1
        mock_alias_history_repo.get_by_product_id.return_value = [
            {
                "id": "hist-1",
                "product_id": product_id,
                "product_name_snapshot": "製品A",
                "customer_id": 7,
                "customer_name_snapshot": "顧客X",
                "raw_text": "セイヒンA",
                "changed_by": "user-1",
                "action": "created",
                "source_order_id": 42,
                "source_order_label_snapshot": "ORD-042",
                "changed_at": "2026-08-19T00:00:00Z",
            }
        ]
        mock_client.table.return_value.select.return_value.in_.return_value.execute.return_value.data = [
            {"id": "user-1", "full_name": "山田太郎"}
        ]

        response = client.get(f"/products/{product_id}/aliases")

        assert response.status_code == 200
        result = response.json()
        assert len(result) == 1
        assert result[0]["raw_text"] == "セイヒンA"
        assert result[0]["changed_by_full_name"] == "山田太郎"
        assert result[0]["customer_id"] == 7
        assert result[0]["customer_name_snapshot"] == "顧客X"
        assert result[0]["source_order_id"] == 42
        assert result[0]["source_order_label_snapshot"] == "ORD-042"

    def test_update_product_name_alias_repoints_to_another_product(
        self, headers, mock_repo, mock_alias_repo, monkeypatch
    ):
        """PATCH /{id}/aliases/{alias_id}: 向き先製品を付け替えられること（Issue #351）。"""
        import app.routers.master.products as products_module

        calls: dict = {}
        monkeypatch.setattr(
            products_module,
            "record_direct_alias_change",
            lambda *a, **kw: calls.update(kw),
        )

        mock_alias_repo.get_alias_by_id.return_value = {
            "id": "alias-1",
            "product_id": 3,
            "customer_id": 55,
            "raw_text": "セイヒンA",
            "source": "auto_match_unreviewed",
        }
        mock_repo.get_by_id.return_value = {"id": 8, "name": "製品B"}
        mock_alias_repo.update_product_id.return_value = {
            "id": "alias-1",
            "product_id": 8,
        }

        response = client.patch(
            "/products/3/aliases/alias-1", json={"product_id": 8}, headers=headers
        )

        assert response.status_code == 200
        mock_alias_repo.update_product_id.assert_called_once_with("alias-1", 8)
        assert calls["action"] == "updated"
        assert calls["target_product_id"] == 8

    def test_update_product_name_alias_404_when_product_id_mismatch(
        self, headers, mock_alias_repo
    ):
        """PATCH /{id}/aliases/{alias_id}: URL の product_id と別名の向き先が
        食い違う場合は 404。"""
        mock_alias_repo.get_alias_by_id.return_value = {
            "id": "alias-1",
            "product_id": 999,
            "raw_text": "x",
        }

        response = client.patch(
            "/products/3/aliases/alias-1", json={"product_id": 8}, headers=headers
        )

        assert response.status_code == 404
        mock_alias_repo.update_product_id.assert_not_called()

    def test_update_product_name_alias_404_when_target_product_missing(
        self, headers, mock_repo, mock_alias_repo
    ):
        """PATCH /{id}/aliases/{alias_id}: 付け替え先の製品が存在しないと 404。"""
        from postgrest.exceptions import APIError

        mock_alias_repo.get_alias_by_id.return_value = {
            "id": "alias-1",
            "product_id": 3,
            "raw_text": "x",
        }
        mock_repo.get_by_id.side_effect = APIError({"message": "0 rows"})

        response = client.patch(
            "/products/3/aliases/alias-1", json={"product_id": 8}, headers=headers
        )

        assert response.status_code == 404
        mock_alias_repo.update_product_id.assert_not_called()

    def test_delete_product_name_alias(self, headers, mock_alias_repo, monkeypatch):
        """DELETE /{id}/aliases/{alias_id}: 辞書行を削除し監査履歴を残すこと（Issue #351）。"""
        import app.routers.master.products as products_module

        calls: dict = {}
        monkeypatch.setattr(
            products_module,
            "record_direct_alias_change",
            lambda *a, **kw: calls.update(kw),
        )

        mock_alias_repo.get_alias_by_id.return_value = {
            "id": "alias-1",
            "product_id": 3,
            "customer_id": 55,
            "raw_text": "セイヒンA",
            "source": "auto_match_unreviewed",
        }

        response = client.delete("/products/3/aliases/alias-1", headers=headers)

        assert response.status_code == 200
        assert response.json() == {"status": "deleted"}
        mock_alias_repo.delete_by_id.assert_called_once_with("alias-1")
        assert calls["action"] == "deleted"

    def test_delete_product_name_alias_404_when_not_found(
        self, headers, mock_alias_repo
    ):
        """DELETE /{id}/aliases/{alias_id}: 別名が存在しないと 404。"""
        mock_alias_repo.get_alias_by_id.return_value = None

        response = client.delete("/products/3/aliases/alias-1", headers=headers)

        assert response.status_code == 404
        mock_alias_repo.delete_by_id.assert_not_called()

    def test_delete_product_success(self, mock_repo):
        """DELETE /{id}: 削除成功時のテスト"""
        product_id = 1
        mock_repo.delete.return_value = True  # 削除成功

        response = client.delete(f"/products/{product_id}")

        assert response.status_code == 200
        assert response.json() == {"status": "deleted"}
        mock_repo.delete.assert_called_with(product_id)

    def test_delete_product_not_found(self, mock_repo):
        """DELETE /{id}: 存在しないID削除時の404エラーテスト"""
        product_id = 999
        mock_repo.delete.return_value = False  # 削除失敗（見つからない）

        response = client.delete(f"/products/{product_id}")

        assert response.status_code == 404
        assert response.json()["detail"] == "Not found"

    # バリデーションエラーのテスト (追加提案):
    # もし ProductCreateSchema で「名前は必須」などの定義がある場合、
    # payload = {} のような空データを POST して 422 Unprocessable Entity が
    # 返ってくるかどうかをテストすると、より堅牢になります。
