# __tests__/api/routers/transaction/test_orders.py
from unittest.mock import MagicMock, call

import pytest
from app.dependencies import (
    get_equipment_repo,
    get_order_repo,
    get_product_repo,
    get_schedule_repo,
    get_supabase_client,
)

# テスト対象のAPIインスタンス
from app.main import app
from app.routers.transaction.orders import get_settings_repo
from fastapi.testclient import TestClient

# テストクライアントの作成
client = TestClient(app)


@pytest.mark.api
class TestOrderRouter:
    """ordersルーターのユニットテスト"""

    @pytest.fixture
    def mock_repo(self):
        """リポジトリのモックを作成するフィクスチャ"""
        mock = MagicMock()
        return mock

    @pytest.fixture
    def mock_product_repo(self):
        """製品リポジトリのモックを作成するフィクスチャ"""
        mock = MagicMock()
        return mock

    @pytest.fixture
    def mock_equipment_repo(self):
        """設備リポジトリのモックを作成するフィクスチャ"""
        mock = MagicMock()
        return mock

    @pytest.fixture
    def mock_schedule_repo(self):
        """スケジュールリポジトリのモックを作成するフィクスチャ"""
        mock = MagicMock()
        return mock

    @pytest.fixture
    def mock_settings_repo(self):
        mock = MagicMock()
        mock.get.return_value = None
        return mock

    @pytest.fixture
    def mock_supabase_client(self):
        """order_attachments への直接クエリ用クライアントのモック"""
        return MagicMock()

    @pytest.fixture(autouse=True)
    def override_dependency(
        self,
        mock_repo,
        mock_product_repo,
        mock_equipment_repo,
        mock_schedule_repo,
        mock_settings_repo,
        mock_supabase_client,
    ):
        """
        テスト実行中だけ依存関係を mock に差し替える。
        """
        app.dependency_overrides[get_order_repo] = lambda: mock_repo
        app.dependency_overrides[get_product_repo] = lambda: mock_product_repo
        app.dependency_overrides[get_equipment_repo] = lambda: mock_equipment_repo
        app.dependency_overrides[get_schedule_repo] = lambda: mock_schedule_repo
        app.dependency_overrides[get_settings_repo] = lambda: mock_settings_repo
        app.dependency_overrides[get_supabase_client] = lambda: mock_supabase_client
        yield
        app.dependency_overrides = {}

    def test_get_orders(self, mock_repo):
        """GET /: 全件取得のテスト"""
        db_data = [
            {"id": 1, "order_number": "ORD-001", "product_id": 1, "quantity": 100},
            {"id": 2, "order_number": "ORD-002", "product_id": 2, "quantity": 200},
        ]
        mock_repo.get_all_with_routing_status.return_value = db_data

        response = client.get("/orders")

        assert response.status_code == 200
        result = response.json()
        assert result[0]["order_no"] == "ORD-001"
        assert result[1]["order_no"] == "ORD-002"
        mock_repo.get_all_with_routing_status.assert_called_once()

    def test_get_order_by_id(self, mock_repo):
        """GET /{id}: 1件取得のテスト"""
        order_id = 1
        db_data = {"id": order_id, "order_number": "ORD-001"}
        mock_repo.get_by_id_with_routing_status.return_value = db_data

        response = client.get(f"/orders/{order_id}")

        assert response.status_code == 200
        result = response.json()
        assert result["order_no"] == "ORD-001"
        mock_repo.get_by_id_with_routing_status.assert_called_with(order_id)

    def test_create_order(self, headers, mock_repo):
        """POST /: 新規作成のテスト"""
        payload = {
            "order_no": "NEW-ORD",
            "product_id": 1,
            "quantity": 50,
            "desired_deadline": "2024-12-31T00:00:00",
        }
        created_data = {
            "id": 100,
            "order_number": "NEW-ORD",
            "product_id": 1,
            "quantity": 50,
            "deadline_date": "2024-12-31T00:00:00",
        }

        mock_repo.create.return_value = created_data

        response = client.post("/orders", json=payload, headers=headers)

        assert response.status_code == 200
        result = response.json()
        assert result["order_no"] == "NEW-ORD"
        assert result["id"] == 100

        mock_repo.create.assert_called_once()

    def test_update_order(self, headers, mock_repo):
        """PATCH /{id}: 更新のテスト"""
        order_id = 1
        payload = {"quantity": 60}
        updated_data = {"id": order_id, "quantity": 60, "order_number": "ORD-001"}

        mock_repo.update.return_value = updated_data

        response = client.patch(f"/orders/{order_id}", json=payload, headers=headers)

        assert response.status_code == 200
        result = response.json()
        assert result["order_no"] == "ORD-001"
        assert result["quantity"] == 60

        mock_repo.update.assert_called_once()
        called_id, called_data = mock_repo.update.call_args[0]
        assert called_id == order_id
        assert called_data == payload

    def test_update_order_syncs_customer_id_to_attachments(
        self, headers, mock_repo, mock_supabase_client
    ):
        """PATCH /{id}: customer_id 変更時に order_attachments.customer_id も同期されること"""
        order_id = 1
        payload = {"customer_id": 42}
        updated_data = {"id": order_id, "customer_id": 42, "order_number": "ORD-001"}
        mock_repo.update.return_value = updated_data

        response = client.patch(f"/orders/{order_id}", json=payload, headers=headers)

        assert response.status_code == 200
        mock_supabase_client.table.assert_called_with("order_attachments")
        table_mock = mock_supabase_client.table.return_value
        table_mock.update.assert_called_once_with({"customer_id": 42})
        table_mock.update.return_value.eq.assert_called_once_with("order_id", order_id)
        table_mock.update.return_value.eq.return_value.execute.assert_called_once()

    def test_update_order_without_customer_id_does_not_touch_attachments(
        self, headers, mock_repo, mock_supabase_client
    ):
        """PATCH /{id}: customer_id を含まない更新では order_attachments に触れないこと"""
        order_id = 1
        payload = {"quantity": 60}
        updated_data = {"id": order_id, "quantity": 60, "order_number": "ORD-001"}
        mock_repo.update.return_value = updated_data

        response = client.patch(f"/orders/{order_id}", json=payload, headers=headers)

        assert response.status_code == 200
        mock_supabase_client.table.assert_not_called()

    def test_update_order_syncs_staging_row_when_siblings_agree(
        self, headers, mock_repo, mock_supabase_client
    ):
        """PATCH /{id}: source_attachment_id を持つ注文の顧客変更時、同じソースから
        生成された全ての注文の顧客が揃っていればステージング行も同期されること"""
        order_id = 1
        payload = {"customer_id": 42}
        updated_data = {
            "id": order_id,
            "customer_id": 42,
            "order_number": "ORD-001",
            "source_attachment_id": "attach-1",
        }
        mock_repo.update.return_value = updated_data

        attachments_table = MagicMock()
        orders_table = MagicMock()
        mock_supabase_client.table.side_effect = lambda name: {
            "order_attachments": attachments_table,
            "orders": orders_table,
        }[name]
        orders_table.select.return_value.eq.return_value.execute.return_value.data = [
            {"customer_id": 42},
            {"customer_id": 42},
        ]

        response = client.patch(f"/orders/{order_id}", json=payload, headers=headers)

        assert response.status_code == 200
        orders_table.select.return_value.eq.assert_called_once_with(
            "source_attachment_id", "attach-1"
        )
        assert attachments_table.update.call_count == 2
        assert attachments_table.update.call_args_list == [
            call({"customer_id": 42}),
            call({"customer_id": 42}),
        ]
        eq_calls = attachments_table.update.return_value.eq.call_args_list
        assert call("order_id", order_id) in eq_calls
        assert call("id", "attach-1") in eq_calls

    def test_update_order_does_not_sync_staging_row_when_siblings_disagree(
        self, headers, mock_repo, mock_supabase_client
    ):
        """PATCH /{id}: 同じソースの他の注文がまだ違う顧客の場合、ステージング行は
        更新しないこと（どちらに合わせるべきか判断できないため）"""
        order_id = 1
        payload = {"customer_id": 42}
        updated_data = {
            "id": order_id,
            "customer_id": 42,
            "order_number": "ORD-001",
            "source_attachment_id": "attach-1",
        }
        mock_repo.update.return_value = updated_data

        attachments_table = MagicMock()
        orders_table = MagicMock()
        mock_supabase_client.table.side_effect = lambda name: {
            "order_attachments": attachments_table,
            "orders": orders_table,
        }[name]
        orders_table.select.return_value.eq.return_value.execute.return_value.data = [
            {"customer_id": 42},
            {"customer_id": 7},
        ]

        response = client.patch(f"/orders/{order_id}", json=payload, headers=headers)

        assert response.status_code == 200
        assert attachments_table.update.call_count == 1
        eq_calls = attachments_table.update.return_value.eq.call_args_list
        assert eq_calls == [call("order_id", order_id)]

    def test_delete_order_success(self, headers, mock_repo):
        """DELETE /{id}: 削除成功時のテスト"""
        order_id = 1
        mock_repo.delete.return_value = True

        response = client.delete(f"/orders/{order_id}", headers=headers)

        assert response.status_code == 200
        assert response.json() == {"status": "deleted"}
        mock_repo.delete.assert_called_with(order_id)

    def test_delete_order_not_found(self, headers, mock_repo):
        """DELETE /{id}: 存在しないID削除時の404エラーテスト"""
        order_id = 999
        mock_repo.delete.return_value = False

        response = client.delete(f"/orders/{order_id}", headers=headers)

        assert response.status_code == 404
        assert response.json()["detail"] == "Not found"

    def test_simulate_schedule(
        self,
        headers,
        mock_repo,
        mock_product_repo,
        mock_equipment_repo,
        mock_schedule_repo,
    ):
        """POST /{order_id}/simulate: シミュレーション実行のテスト"""
        order_id = 1
        order_data = {
            "id": order_id,
            "product_id": 100,
            "quantity": 10,
            "order_number": "ORD-001",
        }

        # Mockの設定
        mock_repo.get_by_id.return_value = order_data

        # 工程データ
        routings = [
            {
                "id": 1,
                "equipment_group_id": 100,
                "setup_time_seconds": 1800,
                "unit_time_seconds": 600,
                "sequence_order": 1,
            }
        ]
        mock_product_repo.get_routings_by_product.return_value = routings

        # 設備グループのメンバー
        mock_product_repo.client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"equipment_id": 1}
        ]

        # 設備の最終終了時刻
        mock_schedule_repo.get_last_end_time.return_value = None
        mock_schedule_repo.get_schedules_by_equipment.return_value = []

        # 新しいRepositoryメソッドのモック
        mock_product_repo.get_process_name.return_value = "テスト工程"
        mock_equipment_repo.get_equipment_name.return_value = "テスト設備"

        response = client.post(f"/orders/{order_id}/simulate", headers=headers)

        assert response.status_code == 200
        result = response.json()
        assert "calculated_deadline" in result
        assert "is_feasible" in result
        assert "process_schedules" in result
        # dry_run=True のため、schedule_repo.create は呼ばれない
        mock_schedule_repo.create.assert_not_called()

    def test_simulate_schedule_not_found(self, headers, mock_repo):
        """POST /{order_id}/simulate: 注文が存在しない場合の404エラーテスト"""
        order_id = 999
        mock_repo.get_by_id.return_value = None

        response = client.post(f"/orders/{order_id}/simulate", headers=headers)

        assert response.status_code == 404
        assert response.json()["detail"] == "Order not found"

    def test_simulate_schedule_no_routing(
        self,
        headers,
        mock_repo,
        mock_product_repo,
        mock_equipment_repo,
        mock_schedule_repo,
    ):
        """POST /{order_id}/simulate: 工程が未登録の場合に422を返すテスト"""
        order_id = 1
        order_data = {
            "id": order_id,
            "product_id": 100,
            "quantity": 10,
            "order_number": "ORD-001",
        }
        mock_repo.get_by_id.return_value = order_data
        mock_product_repo.get_routings_by_product.return_value = []

        response = client.post(f"/orders/{order_id}/simulate", headers=headers)

        assert response.status_code == 422
        result = response.json()
        assert result["detail"]["error"] == "no_routing"

    def test_simulate_without_id_no_routing(
        self,
        headers,
        mock_product_repo,
        mock_equipment_repo,
        mock_schedule_repo,
    ):
        """POST /simulate: 工程が未登録の製品に対するシミュレーションのテスト"""
        mock_product_repo.get_routings_by_product.return_value = []

        payload = {"product_id": 10009, "quantity": 1}
        response = client.post("/orders/simulate", json=payload, headers=headers)

        assert response.status_code == 200
        result = response.json()
        assert result["routing_status"] == "no_routing"
        assert result["process_schedules"] == []
        assert result["calculated_deadline"] is None
        assert result["is_feasible"] is None

    def test_confirm_order(
        self,
        headers,
        mock_repo,
        mock_product_repo,
        mock_equipment_repo,
        mock_schedule_repo,
    ):
        """POST /{order_id}/confirm: 注文確定のテスト"""
        order_id = 1
        order_data = {
            "id": order_id,
            "product_id": 100,
            "quantity": 10,
            "order_number": "ORD-001",
            "status": "draft",
        }

        # Mockの設定
        mock_repo.get_by_id.return_value = order_data

        # 工程データ（is_confirmed=True で確定済み工程として設定）
        routings = [
            {
                "id": 1,
                "equipment_group_id": 100,
                "setup_time_seconds": 1800,
                "unit_time_seconds": 600,
                "sequence_order": 1,
                "is_confirmed": True,
            }
        ]
        mock_product_repo.get_routings_by_product.return_value = routings

        # 設備グループのメンバー
        mock_product_repo.client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"equipment_id": 1}
        ]

        # 設備の最終終了時刻
        mock_schedule_repo.get_last_end_time.return_value = None
        mock_schedule_repo.get_schedules_by_equipment.return_value = []
        mock_schedule_repo.create.return_value = None

        # 更新のMock
        updated_order = {**order_data, "status": "confirmed", "is_scheduled": True}
        mock_repo.update.return_value = updated_order

        response = client.post(f"/orders/{order_id}/confirm", headers=headers)

        assert response.status_code == 200
        result = response.json()
        assert result["status"] == "confirmed"
        assert "schedules" in result
        assert isinstance(result["schedules"], list)
        # dry_run=False のため、schedule_repo.create が1回以上呼ばれる（日またぎで複数回の場合あり）
        assert mock_schedule_repo.create.call_count >= 1
        # ステータスが更新される (confirmed_at, confirmed_deadline も含む)
        called_id, called_data = mock_repo.update.call_args[0]
        assert called_id == order_id
        assert called_data["status"] == "confirmed"
        assert called_data["is_scheduled"] is True
        assert "confirmed_at" in called_data
        assert "confirmed_deadline" in called_data

    def test_confirm_order_not_found(self, headers, mock_repo):
        """POST /{order_id}/confirm: 注文が存在しない場合の404エラーテスト"""
        order_id = 999
        mock_repo.get_by_id.return_value = None

        response = client.post(f"/orders/{order_id}/confirm", headers=headers)

        assert response.status_code == 404
        assert response.json()["detail"] == "Order not found"

    def test_split_order_not_found(self, headers, mock_repo):
        """POST /{order_id}/split: 注文が存在しない場合の404エラーテスト"""
        mock_repo.get_by_id.return_value = None

        response = client.post(
            "/orders/999/split",
            json={
                "line_items": [
                    {"product_id": 1, "quantity": 10, "desired_deadline": "2026-08-01"},
                    {"product_id": 2, "quantity": 20, "desired_deadline": "2026-09-01"},
                ]
            },
            headers=headers,
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Order not found"

    def test_split_order_not_draft(self, headers, mock_repo):
        """POST /{order_id}/split: draft以外の注文は分割できない"""
        mock_repo.get_by_id.return_value = {
            "id": 1,
            "status": "confirmed",
            "source_attachment_id": "att-1",
        }

        response = client.post(
            "/orders/1/split",
            json={
                "line_items": [
                    {"product_id": 1, "quantity": 10, "desired_deadline": "2026-08-01"},
                    {"product_id": 2, "quantity": 20, "desired_deadline": "2026-09-01"},
                ]
            },
            headers=headers,
        )

        assert response.status_code == 400
        assert "下書き" in response.json()["detail"]
        mock_repo.create.assert_not_called()

    def test_split_order_no_source_attachment(self, headers, mock_repo):
        """POST /{order_id}/split: source_attachment_id が無い注文は分割できない"""
        mock_repo.get_by_id.return_value = {
            "id": 1,
            "status": "draft",
            "source_attachment_id": None,
        }

        response = client.post(
            "/orders/1/split",
            json={
                "line_items": [
                    {"product_id": 1, "quantity": 10, "desired_deadline": "2026-08-01"},
                    {"product_id": 2, "quantity": 20, "desired_deadline": "2026-09-01"},
                ]
            },
            headers=headers,
        )

        assert response.status_code == 400
        assert "分割できません" in response.json()["detail"]
        mock_repo.create.assert_not_called()

    def test_split_order_success(self, headers, mock_repo, mock_supabase_client):
        """POST /{order_id}/split: 正常に2件へ分割できるテスト"""
        order_id = 1
        original_order = {
            "id": order_id,
            "status": "draft",
            "source_attachment_id": "att-1",
            "customer_id": 10,
            "customer_certainty": "forecast",
            "source_type": "email",
            "source_raw": "mail body",
            "deadline_date": "2026-07-01",
        }
        mock_repo.get_by_id.return_value = original_order

        source_row = {
            "id": "att-1",
            "storage_path": "tenant/inbox/msg-1/file.pdf",
            "original_filename": "file.pdf",
            "content_type": "application/pdf",
            "size_bytes": 1234,
        }
        (
            mock_supabase_client.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data
        ) = source_row

        created = [
            {"id": 101, "product_id": 1, "quantity": 10, "deadline_date": "2026-08-01"},
            {"id": 102, "product_id": 2, "quantity": 20, "deadline_date": "2026-09-01"},
        ]
        mock_repo.create.side_effect = created
        mock_repo.delete.return_value = True

        response = client.post(
            f"/orders/{order_id}/split",
            json={
                "line_items": [
                    {"product_id": 1, "quantity": 10, "desired_deadline": "2026-08-01"},
                    {"product_id": 2, "quantity": 20, "desired_deadline": "2026-09-01"},
                ]
            },
            headers=headers,
        )

        assert response.status_code == 200
        result = response.json()
        assert result["original_order_id"] == order_id
        assert len(result["created_orders"]) == 2

        assert mock_repo.create.call_count == 2
        first_call_data = mock_repo.create.call_args_list[0][0][0]
        assert first_call_data["tenant_id"] == headers["x-tenant-id"]
        assert first_call_data["source_attachment_id"] == "att-1"
        assert first_call_data["customer_id"] == 10
        assert first_call_data["customer_certainty"] == "forecast"

        # 新規INSERTの前に、元の注文の deadline_date を退避（NULL化）している
        mock_repo.update.assert_any_call(order_id, {"deadline_date": None})
        # 全明細の作成に成功した後、元の注文を実際に削除する
        mock_repo.delete.assert_called_once_with(order_id)
        assert mock_supabase_client.table.return_value.insert.call_count == 2

    def test_split_order_rolls_back_on_conflict(
        self, headers, mock_repo, mock_supabase_client
    ):
        """POST /{order_id}/split: 2件目の作成が重複エラーの場合、既作成分をロールバックし元注文を復元する"""
        order_id = 1
        original_order = {
            "id": order_id,
            "status": "draft",
            "source_attachment_id": "att-1",
            "customer_id": 10,
            "customer_certainty": "forecast",
            "source_type": "email",
            "source_raw": "mail body",
            "deadline_date": "2026-07-01",
        }
        mock_repo.get_by_id.return_value = original_order
        (
            mock_supabase_client.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data
        ) = {"storage_path": "p", "original_filename": "f"}

        mock_repo.create.side_effect = [
            {"id": 101, "product_id": 1, "quantity": 10, "deadline_date": "2026-08-01"},
            ValueError("重複データ: orders_dedupe_key"),
        ]

        response = client.post(
            f"/orders/{order_id}/split",
            json={
                "line_items": [
                    {"product_id": 1, "quantity": 10, "desired_deadline": "2026-08-01"},
                    {"product_id": 2, "quantity": 20, "desired_deadline": "2026-09-01"},
                ]
            },
            headers=headers,
        )

        assert response.status_code == 400
        # 失敗した明細（101）のみ削除する。元の注文は削除しない（deadline_date退避のみ）
        mock_repo.delete.assert_called_once_with(101)
        # 元の注文は退避 → 復元の2回 update される（削除・再作成は発生しない）
        assert mock_repo.update.call_count == 2
        mock_repo.update.assert_any_call(order_id, {"deadline_date": None})
        mock_repo.update.assert_any_call(
            order_id, {"deadline_date": original_order["deadline_date"]}
        )
        assert mock_repo.create.call_count == 2

    def test_split_order_source_attachment_missing(
        self, headers, mock_repo, mock_supabase_client
    ):
        """POST /{order_id}/split: source_attachment_id先のレコードが見つからない場合400"""
        order_id = 1
        mock_repo.get_by_id.return_value = {
            "id": order_id,
            "status": "draft",
            "source_attachment_id": "att-missing",
        }
        (
            mock_supabase_client.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data
        ) = None

        response = client.post(
            f"/orders/{order_id}/split",
            json={
                "line_items": [
                    {"product_id": 1, "quantity": 10, "desired_deadline": "2026-08-01"},
                    {"product_id": 2, "quantity": 20, "desired_deadline": "2026-09-01"},
                ]
            },
            headers=headers,
        )

        assert response.status_code == 400
        mock_repo.create.assert_not_called()
        mock_repo.update.assert_not_called()
