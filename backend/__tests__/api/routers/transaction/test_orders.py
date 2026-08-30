# __tests__/api/routers/transaction/test_orders.py
import json
from unittest.mock import MagicMock

import pytest
from app.dependencies import (
    get_current_user_id,
    get_equipment_repo,
    get_order_approval_log_repo,
    get_order_repo,
    get_product_repo,
    get_schedule_repo,
    get_supabase_admin_client,
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

    @pytest.fixture
    def mock_admin_client(self):
        """profiles/orders 補完取得用の管理者クライアントのモック"""
        return MagicMock()

    @pytest.fixture
    def mock_approval_log_repo(self):
        """承認監査ログリポジトリのモックを作成するフィクスチャ"""
        mock = MagicMock()
        mock.get_all.return_value = []
        return mock

    @pytest.fixture(autouse=True)
    def override_dependency(
        self,
        mock_repo,
        mock_product_repo,
        mock_equipment_repo,
        mock_schedule_repo,
        mock_settings_repo,
        mock_supabase_client,
        mock_admin_client,
        mock_approval_log_repo,
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
        app.dependency_overrides[get_supabase_admin_client] = lambda: mock_admin_client
        app.dependency_overrides[get_order_approval_log_repo] = (
            lambda: mock_approval_log_repo
        )
        app.dependency_overrides[get_current_user_id] = lambda: "test-user-id"
        yield
        app.dependency_overrides = {}

    @staticmethod
    def _set_role(mock_supabase_client, role: str):
        """organization_members.role の問い合わせ結果をモックする"""
        (
            mock_supabase_client.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value.data
        ) = {"role": role}

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

    def test_list_email_intake_results(
        self, headers, mock_supabase_client, mock_admin_client
    ):
        """GET /orders/email-intake-results: 受信受注メール（ステージング行）ごとに
        起票件数・スキップ理由・元PDFリンクを一覧で返す（Issue #357）。
        全明細が重複スキップされ起票0件のメールも、parse_status='success' かつ
        created_order_count=0 / parse_log_reasons=['no_order_created'] として
        判別できること。"""

        def _q(data):
            q = MagicMock()
            for m in ("select", "eq", "in_", "is_", "order", "limit"):
                getattr(q, m).return_value = q
            q.execute.return_value = MagicMock(data=data)
            return q

        staging_q = _q(
            [
                {
                    "id": "att-1",
                    "tenant_id": headers["x-tenant-id"],
                    "customer_id": 2,
                    "storage_path": "t/inbox/m1/order.pdf",
                    "original_filename": "order.pdf",
                    "content_type": "application/pdf",
                    "size_bytes": 100,
                    "parse_status": "success",
                    "gmail_message_id": "1a04679c33ae25b5",
                    "created_at": "2026-08-30T00:00:00+00:00",
                },
                {
                    "id": "att-2",
                    "tenant_id": headers["x-tenant-id"],
                    "customer_id": 2,
                    "storage_path": "t/inbox/m2/order.pdf",
                    "original_filename": "order2.pdf",
                    "content_type": "application/pdf",
                    "size_bytes": 100,
                    "parse_status": "success",
                    "gmail_message_id": "m2",
                    "created_at": "2026-08-29T00:00:00+00:00",
                },
            ]
        )
        customers_q = _q([{"id": 2, "name": "株式会社 飯野製作所"}])
        orders_q = _q([{"id": 1000062, "source_attachment_id": "att-2"}])
        logs_q = _q(
            [
                {
                    "order_attachment_id": "att-1",
                    "reason": "no_order_created",
                    "created_at": "2026-08-30T00:00:01+00:00",
                }
            ]
        )
        table_map = {
            "order_attachments": staging_q,
            "customers": customers_q,
            "orders": orders_q,
            "order_parse_log": logs_q,
        }
        # organization_members など未登録テーブルは get_current_tenant_id の
        # メンバーシップ検証用なので、デフォルトの MagicMock を返す
        mock_supabase_client.table.side_effect = lambda name: table_map.get(
            name, MagicMock()
        )
        mock_admin_client.storage.from_.return_value.create_signed_urls.return_value = [
            {"path": "t/inbox/m1/order.pdf", "signedURL": "https://signed/1"},
            {"path": "t/inbox/m2/order.pdf", "signedURL": "https://signed/2"},
        ]

        response = client.get("/orders/email-intake-results", headers=headers)

        assert response.status_code == 200
        rows = response.json()
        assert [r["id"] for r in rows] == ["att-1", "att-2"]

        deduped = rows[0]
        assert deduped["parse_status"] == "success"
        assert deduped["created_order_count"] == 0
        assert deduped["parse_log_reasons"] == ["no_order_created"]
        assert deduped["customer_name"] == "株式会社 飯野製作所"
        assert deduped["signed_url"] == "https://signed/1"
        assert deduped["gmail_url"].endswith("1a04679c33ae25b5")

        created = rows[1]
        assert created["created_order_count"] == 1
        assert created["created_order_ids"] == [1000062]
        assert created["parse_log_reasons"] == []

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

    def test_update_order_sets_manually_corrected_flag_on_product_id_change(
        self, headers, mock_repo
    ):
        """PATCH /{id}: product_id を変更したら product_id_manually_corrected=true
        を立てる（Issue #350）。"""
        order_id = 1
        mock_repo.get_by_id.return_value = {
            "id": order_id,
            "product_id": 5,
            "product_id_manually_corrected": False,
        }
        mock_repo.update.return_value = {"id": order_id, "product_id": 9}

        response = client.patch(
            f"/orders/{order_id}", json={"product_id": 9}, headers=headers
        )

        assert response.status_code == 200
        _, called_data = mock_repo.update.call_args[0]
        assert called_data == {"product_id": 9, "product_id_manually_corrected": True}

    def test_update_order_keeps_manually_corrected_flag_true(self, headers, mock_repo):
        """PATCH /{id}: 既に true のフラグは false へ戻さない（再送でも冪等。Issue #350）。"""
        order_id = 1
        mock_repo.get_by_id.return_value = {
            "id": order_id,
            "product_id": 5,
            "product_id_manually_corrected": True,
        }
        mock_repo.update.return_value = {"id": order_id, "product_id": 9}

        response = client.patch(
            f"/orders/{order_id}", json={"product_id": 9}, headers=headers
        )

        assert response.status_code == 200
        _, called_data = mock_repo.update.call_args[0]
        assert called_data == {"product_id": 9}

    def test_update_order_no_flag_when_product_id_unchanged(self, headers, mock_repo):
        """PATCH /{id}: product_id が同値なら（他項目だけの更新）フラグに触れない。"""
        order_id = 1
        mock_repo.get_by_id.return_value = {
            "id": order_id,
            "product_id": 5,
            "product_id_manually_corrected": False,
        }
        mock_repo.update.return_value = {"id": order_id, "product_id": 5}

        response = client.patch(
            f"/orders/{order_id}",
            json={"product_id": 5, "quantity": 3},
            headers=headers,
        )

        assert response.status_code == 200
        _, called_data = mock_repo.update.call_args[0]
        assert "product_id_manually_corrected" not in called_data

    def test_request_order_approval_records_auto_match_alias(
        self, headers, mock_repo, mock_supabase_client, monkeypatch
    ):
        """POST /{order_id}/request-approval: 自動マッチのまま承認依頼したら
        別名辞書への反映フックを呼ぶ（Issue #350）。"""
        import app.routers.transaction.orders as orders_module

        recorded: dict = {}

        def _fake_record(client_, tenant_id, order, changed_by):
            recorded["order"] = order
            recorded["changed_by"] = changed_by

        monkeypatch.setattr(
            orders_module, "record_auto_match_alias_if_applicable", _fake_record
        )

        order_id = 1
        order_data = {
            "id": order_id,
            "product_id": 100,
            "order_number": "ORD-001",
            "status": "draft",
            "source_type": "email",
            "extracted_product_name": "セイヒンA",
            "customer_id": 55,
            "product_id_manually_corrected": False,
        }
        self._set_role(mock_supabase_client, "order_handler")
        mock_repo.get_by_id.return_value = order_data
        mock_repo.update.return_value = {**order_data, "status": "pending_approval"}

        response = client.post(f"/orders/{order_id}/request-approval", headers=headers)

        assert response.status_code == 200
        assert recorded["order"]["id"] == order_id
        assert recorded["changed_by"] == "test-user-id"

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
        mock_supabase_client,
    ):
        """POST /{order_id}/confirm: 注文確定（承認）のテスト"""
        order_id = 1
        order_data = {
            "id": order_id,
            "product_id": 100,
            "quantity": 10,
            "order_number": "ORD-001",
            "status": "pending_approval",
        }
        self._set_role(mock_supabase_client, "president")

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

    def test_confirm_order_not_found(self, headers, mock_repo, mock_supabase_client):
        """POST /{order_id}/confirm: 注文が存在しない場合の404エラーテスト"""
        order_id = 999
        self._set_role(mock_supabase_client, "president")
        mock_repo.get_by_id.return_value = None

        response = client.post(f"/orders/{order_id}/confirm", headers=headers)

        assert response.status_code == 404
        assert response.json()["detail"] == "Order not found"

    def test_confirm_order_invalid_transition_from_draft(
        self, headers, mock_repo, mock_supabase_client
    ):
        """POST /{order_id}/confirm: draftから直接confirmedへの遷移は拒否される (Issue #324)"""
        order_id = 1
        order_data = {
            "id": order_id,
            "product_id": 100,
            "quantity": 10,
            "order_number": "ORD-001",
            "status": "draft",
        }
        self._set_role(mock_supabase_client, "president")
        mock_repo.get_by_id.return_value = order_data

        response = client.post(f"/orders/{order_id}/confirm", headers=headers)

        assert response.status_code == 400
        mock_repo.update.assert_not_called()

    def test_confirm_order_forbidden_for_non_president(
        self, headers, mock_repo, mock_supabase_client
    ):
        """POST /{order_id}/confirm: president以外は403"""
        order_id = 1
        self._set_role(mock_supabase_client, "order_handler")

        response = client.post(f"/orders/{order_id}/confirm", headers=headers)

        assert response.status_code == 403
        mock_repo.get_by_id.assert_not_called()

    def test_request_order_approval_success(
        self, headers, mock_repo, mock_supabase_client
    ):
        """POST /{order_id}/request-approval: draft -> pending_approval への遷移が成功する"""
        order_id = 1
        order_data = {
            "id": order_id,
            "product_id": 100,
            "quantity": 10,
            "order_number": "ORD-001",
            "status": "draft",
        }
        self._set_role(mock_supabase_client, "order_handler")
        mock_repo.get_by_id.return_value = order_data
        mock_repo.update.return_value = {**order_data, "status": "pending_approval"}

        response = client.post(f"/orders/{order_id}/request-approval", headers=headers)

        assert response.status_code == 200
        assert response.json()["status"] == "pending_approval"
        mock_repo.update.assert_called_once_with(
            order_id, {"status": "pending_approval", "rejection_reason": None}
        )

    def test_request_order_approval_forbidden_for_non_order_handler(
        self, headers, mock_repo, mock_supabase_client
    ):
        """POST /{order_id}/request-approval: order_handler以外は403"""
        order_id = 1
        self._set_role(mock_supabase_client, "president")

        response = client.post(f"/orders/{order_id}/request-approval", headers=headers)

        assert response.status_code == 403
        mock_repo.get_by_id.assert_not_called()

    def test_request_order_approval_product_unmatched(
        self, headers, mock_repo, mock_supabase_client
    ):
        """POST /{order_id}/request-approval: product_id未確定の場合は422"""
        order_id = 1
        self._set_role(mock_supabase_client, "order_handler")
        mock_repo.get_by_id.return_value = {
            "id": order_id,
            "product_id": None,
            "status": "draft",
        }

        response = client.post(f"/orders/{order_id}/request-approval", headers=headers)

        assert response.status_code == 422
        mock_repo.update.assert_not_called()

    def test_request_order_approval_invalid_transition(
        self, headers, mock_repo, mock_supabase_client
    ):
        """POST /{order_id}/request-approval: pending_approvalからは再度依頼できない"""
        order_id = 1
        self._set_role(mock_supabase_client, "order_handler")
        mock_repo.get_by_id.return_value = {
            "id": order_id,
            "product_id": 100,
            "status": "pending_approval",
        }

        response = client.post(f"/orders/{order_id}/request-approval", headers=headers)

        assert response.status_code == 400
        mock_repo.update.assert_not_called()

    def test_reject_order_success(self, headers, mock_repo, mock_supabase_client):
        """POST /{order_id}/reject: pending_approval -> draft への差し戻しが成功する"""
        order_id = 1
        self._set_role(mock_supabase_client, "president")
        mock_repo.get_by_id.return_value = {
            "id": order_id,
            "product_id": 100,
            "status": "pending_approval",
        }
        mock_repo.update.return_value = {
            "id": order_id,
            "status": "draft",
            "rejection_reason": "表記揺れを修正してください",
        }

        response = client.post(
            f"/orders/{order_id}/reject",
            json={"reason": "表記揺れを修正してください"},
            headers=headers,
        )

        assert response.status_code == 200
        assert response.json()["status"] == "draft"
        mock_repo.update.assert_called_once_with(
            order_id,
            {"status": "draft", "rejection_reason": "表記揺れを修正してください"},
        )

    def test_reject_order_reason_optional(
        self, headers, mock_repo, mock_supabase_client
    ):
        """POST /{order_id}/reject: reasonなしでも差し戻しできる"""
        order_id = 1
        self._set_role(mock_supabase_client, "president")
        mock_repo.get_by_id.return_value = {
            "id": order_id,
            "product_id": 100,
            "status": "pending_approval",
        }
        mock_repo.update.return_value = {"id": order_id, "status": "draft"}

        response = client.post(f"/orders/{order_id}/reject", json={}, headers=headers)

        assert response.status_code == 200
        mock_repo.update.assert_called_once_with(
            order_id, {"status": "draft", "rejection_reason": None}
        )

    def test_reject_order_forbidden_for_non_president(
        self, headers, mock_repo, mock_supabase_client
    ):
        """POST /{order_id}/reject: president以外は403"""
        order_id = 1
        self._set_role(mock_supabase_client, "order_handler")

        response = client.post(f"/orders/{order_id}/reject", json={}, headers=headers)

        assert response.status_code == 403
        mock_repo.get_by_id.assert_not_called()

    def test_reject_order_invalid_transition(
        self, headers, mock_repo, mock_supabase_client
    ):
        """POST /{order_id}/reject: draftからは差し戻しできない"""
        order_id = 1
        self._set_role(mock_supabase_client, "president")
        mock_repo.get_by_id.return_value = {"id": order_id, "status": "draft"}

        response = client.post(f"/orders/{order_id}/reject", json={}, headers=headers)

        assert response.status_code == 400
        mock_repo.update.assert_not_called()

    def test_withdraw_order_approval_success(
        self, headers, mock_repo, mock_supabase_client, mock_approval_log_repo
    ):
        """POST /{order_id}/withdraw-approval: pending_approval -> draft への取り下げが成功する"""
        order_id = 1
        self._set_role(mock_supabase_client, "order_handler")
        mock_repo.get_by_id.return_value = {
            "id": order_id,
            "product_id": 100,
            "status": "pending_approval",
        }
        mock_repo.update.return_value = {"id": order_id, "status": "draft"}

        response = client.post(f"/orders/{order_id}/withdraw-approval", headers=headers)

        assert response.status_code == 200
        assert response.json()["status"] == "draft"
        mock_repo.update.assert_called_once_with(order_id, {"status": "draft"})
        mock_approval_log_repo.log_action.assert_called_once_with(
            headers["x-tenant-id"], order_id, "withdraw", "test-user-id", None
        )

    def test_withdraw_order_approval_forbidden_for_non_order_handler(
        self, headers, mock_repo, mock_supabase_client
    ):
        """POST /{order_id}/withdraw-approval: order_handler以外は403"""
        order_id = 1
        self._set_role(mock_supabase_client, "president")

        response = client.post(f"/orders/{order_id}/withdraw-approval", headers=headers)

        assert response.status_code == 403
        mock_repo.get_by_id.assert_not_called()

    def test_withdraw_order_approval_invalid_transition(
        self, headers, mock_repo, mock_supabase_client
    ):
        """POST /{order_id}/withdraw-approval: draftからは取り下げできない"""
        order_id = 1
        self._set_role(mock_supabase_client, "order_handler")
        mock_repo.get_by_id.return_value = {"id": order_id, "status": "draft"}

        response = client.post(f"/orders/{order_id}/withdraw-approval", headers=headers)

        assert response.status_code == 400
        mock_repo.update.assert_not_called()

    def test_withdraw_order_approval_not_found(
        self, headers, mock_repo, mock_supabase_client
    ):
        """POST /{order_id}/withdraw-approval: 注文が存在しない場合の404エラーテスト"""
        order_id = 999
        self._set_role(mock_supabase_client, "order_handler")
        mock_repo.get_by_id.return_value = None

        response = client.post(f"/orders/{order_id}/withdraw-approval", headers=headers)

        assert response.status_code == 404

    def test_approve_orders_bulk_partial_failure(
        self,
        headers,
        mock_repo,
        mock_product_repo,
        mock_equipment_repo,
        mock_schedule_repo,
        mock_supabase_client,
    ):
        """POST /approve-bulk: 1件成功・1件404の混在結果を返す"""
        self._set_role(mock_supabase_client, "president")

        order_data = {
            "id": 1,
            "product_id": 100,
            "quantity": 10,
            "order_number": "ORD-001",
            "status": "pending_approval",
        }

        def get_by_id(order_id):
            return order_data if order_id == 1 else None

        mock_repo.get_by_id.side_effect = get_by_id

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
        mock_product_repo.client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"equipment_id": 1}
        ]
        mock_schedule_repo.get_last_end_time.return_value = None
        mock_schedule_repo.get_schedules_by_equipment.return_value = []
        mock_schedule_repo.create.return_value = None
        mock_repo.update.return_value = {**order_data, "status": "confirmed"}

        response = client.post(
            "/orders/approve-bulk",
            json={"order_ids": [1, 2]},
            headers=headers,
        )

        assert response.status_code == 200
        results = {r["order_id"]: r for r in response.json()["results"]}
        assert results[1]["status"] == "confirmed"
        assert results[2]["status"] == "error"
        assert results[2]["detail"] == "Order not found"

    def test_approve_orders_bulk_forbidden_for_non_president(
        self, headers, mock_repo, mock_supabase_client
    ):
        """POST /approve-bulk: president以外は403"""
        self._set_role(mock_supabase_client, "order_handler")

        response = client.post(
            "/orders/approve-bulk", json={"order_ids": [1]}, headers=headers
        )

        assert response.status_code == 403
        mock_repo.get_by_id.assert_not_called()

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

    # --- 監査ログ記録 (Issue #326) ---

    def test_request_order_approval_logs_action(
        self, headers, mock_repo, mock_supabase_client, mock_approval_log_repo
    ):
        """POST /{order_id}/request-approval: 承認依頼送信が監査ログに記録される"""
        order_id = 1
        order_data = {
            "id": order_id,
            "product_id": 100,
            "quantity": 10,
            "order_number": "ORD-001",
            "status": "draft",
        }
        self._set_role(mock_supabase_client, "order_handler")
        mock_repo.get_by_id.return_value = order_data
        mock_repo.update.return_value = {**order_data, "status": "pending_approval"}

        response = client.post(f"/orders/{order_id}/request-approval", headers=headers)

        assert response.status_code == 200
        mock_approval_log_repo.log_action.assert_called_once_with(
            headers["x-tenant-id"], order_id, "request_approval", "test-user-id", None
        )

    # --- アプリ内通知 (Issue #327) ---

    def test_request_order_approval_notifies_approval_requested(
        self, headers, mock_repo, mock_supabase_client
    ):
        """POST /{order_id}/request-approval: notificationsにapproval_requestedが書き込まれる"""
        order_id = 1
        order_data = {
            "id": order_id,
            "product_id": 100,
            "quantity": 10,
            "order_number": "ORD-001",
            "status": "draft",
        }
        self._set_role(mock_supabase_client, "order_handler")
        mock_repo.get_by_id.return_value = order_data
        mock_repo.update.return_value = {**order_data, "status": "pending_approval"}

        response = client.post(f"/orders/{order_id}/request-approval", headers=headers)

        assert response.status_code == 200
        insert_calls = [
            call
            for call in mock_supabase_client.table.return_value.insert.call_args_list
            if call.args and call.args[0].get("notif_type") == "approval_requested"
        ]
        assert len(insert_calls) == 1
        inserted = insert_calls[0].args[0]
        assert inserted["tenant_id"] == headers["x-tenant-id"]
        assert inserted["source_table"] == "orders"
        assert inserted["source_id"] == str(order_id)
        assert inserted["detail"] == {"order_no": "ORD-001"}

    def test_confirm_order_logs_action(
        self,
        headers,
        mock_repo,
        mock_product_repo,
        mock_schedule_repo,
        mock_supabase_client,
        mock_approval_log_repo,
    ):
        """POST /{order_id}/confirm: 承認が監査ログに記録される"""
        order_id = 1
        order_data = {
            "id": order_id,
            "product_id": 100,
            "quantity": 10,
            "order_number": "ORD-001",
            "status": "pending_approval",
        }
        self._set_role(mock_supabase_client, "president")
        mock_repo.get_by_id.return_value = order_data
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
        mock_product_repo.client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"equipment_id": 1}
        ]
        mock_schedule_repo.get_last_end_time.return_value = None
        mock_schedule_repo.get_schedules_by_equipment.return_value = []
        mock_schedule_repo.create.return_value = None
        mock_repo.update.return_value = {**order_data, "status": "confirmed"}

        response = client.post(f"/orders/{order_id}/confirm", headers=headers)

        assert response.status_code == 200
        mock_approval_log_repo.log_action.assert_called_once_with(
            headers["x-tenant-id"], order_id, "approve", "test-user-id", None
        )

    def test_reject_order_logs_action_with_reason(
        self, headers, mock_repo, mock_supabase_client, mock_approval_log_repo
    ):
        """POST /{order_id}/reject: 差し戻し理由付きで監査ログに記録される"""
        order_id = 1
        self._set_role(mock_supabase_client, "president")
        mock_repo.get_by_id.return_value = {
            "id": order_id,
            "product_id": 100,
            "status": "pending_approval",
        }
        mock_repo.update.return_value = {"id": order_id, "status": "draft"}

        response = client.post(
            f"/orders/{order_id}/reject",
            json={"reason": "表記揺れを修正してください"},
            headers=headers,
        )

        assert response.status_code == 200
        mock_approval_log_repo.log_action.assert_called_once_with(
            headers["x-tenant-id"],
            order_id,
            "reject",
            "test-user-id",
            "表記揺れを修正してください",
        )

    def test_approve_orders_bulk_logs_action_per_order(
        self,
        headers,
        mock_repo,
        mock_product_repo,
        mock_schedule_repo,
        mock_supabase_client,
        mock_approval_log_repo,
    ):
        """POST /approve-bulk: 成功した注文ごとに監査ログが記録される"""
        self._set_role(mock_supabase_client, "president")
        order_data = {
            "id": 1,
            "product_id": 100,
            "quantity": 10,
            "order_number": "ORD-001",
            "status": "pending_approval",
        }
        mock_repo.get_by_id.side_effect = lambda oid: (order_data if oid == 1 else None)
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
        mock_product_repo.client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"equipment_id": 1}
        ]
        mock_schedule_repo.get_last_end_time.return_value = None
        mock_schedule_repo.get_schedules_by_equipment.return_value = []
        mock_schedule_repo.create.return_value = None
        mock_repo.update.return_value = {**order_data, "status": "confirmed"}

        response = client.post(
            "/orders/approve-bulk",
            json={"order_ids": [1, 2]},
            headers=headers,
        )

        assert response.status_code == 200
        mock_approval_log_repo.log_action.assert_called_once_with(
            headers["x-tenant-id"], 1, "approve", "test-user-id", None
        )

    def test_approve_orders_bulk_succeeds_even_if_log_action_raises(
        self,
        headers,
        mock_repo,
        mock_product_repo,
        mock_schedule_repo,
        mock_supabase_client,
        mock_approval_log_repo,
    ):
        """
        POST /approve-bulk: 監査ログ記録が例外を送出しても、既に確定した注文の結果は
        失われず200で返る（記録はベストエフォート）
        """
        self._set_role(mock_supabase_client, "president")
        order_data = {
            "id": 1,
            "product_id": 100,
            "quantity": 10,
            "order_number": "ORD-001",
            "status": "pending_approval",
        }
        mock_repo.get_by_id.return_value = order_data
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
        mock_product_repo.client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"equipment_id": 1}
        ]
        mock_schedule_repo.get_last_end_time.return_value = None
        mock_schedule_repo.get_schedules_by_equipment.return_value = []
        mock_schedule_repo.create.return_value = None
        mock_repo.update.return_value = {**order_data, "status": "confirmed"}
        mock_approval_log_repo.log_action.side_effect = RuntimeError("DB down")

        response = client.post(
            "/orders/approve-bulk",
            json={"order_ids": [1]},
            headers=headers,
        )

        assert response.status_code == 200
        results = {r["order_id"]: r for r in response.json()["results"]}
        assert results[1]["status"] == "confirmed"

    # --- 監査ログ閲覧・出力 (Issue #326) ---

    _SAMPLE_LOG_ROW = {
        "id": "log-1",
        "order_id": 1,
        "action": "approve",
        "actor_user_id": "user-1",
        "reason": None,
        "created_at": "2026-08-11T00:00:00+00:00",
    }

    def _mock_enrichment(self, mock_supabase_client):
        """
        orders / profiles への補完クエリのモックを設定する。
        監査ログの補完取得はユーザーJWTクライアント（mock_supabase_client）で行うため、
        `_set_role` が使う organization_members 向けチェーンはそのまま残しつつ、
        table("orders") / table("profiles") の呼び出しだけ差し替える。
        """
        default_table_return = mock_supabase_client.table.return_value

        def table_side_effect(name):
            if name == "orders":
                m = MagicMock()
                m.select.return_value.in_.return_value.execute.return_value.data = [
                    {"id": 1, "order_number": "ORD-001"}
                ]
                return m
            if name == "profiles":
                m = MagicMock()
                m.select.return_value.in_.return_value.execute.return_value.data = [
                    {
                        "id": "user-1",
                        "full_name": "承認 太郎",
                        "email": "taro@example.com",
                    }
                ]
                return m
            return default_table_return

        mock_supabase_client.table.side_effect = table_side_effect

    def test_list_approval_logs_success(
        self, headers, mock_supabase_client, mock_approval_log_repo
    ):
        """GET /approval-logs: iso_officer は承認履歴を閲覧できる"""
        self._set_role(mock_supabase_client, "iso_officer")
        mock_approval_log_repo.get_all.return_value = [self._SAMPLE_LOG_ROW]
        self._mock_enrichment(mock_supabase_client)

        response = client.get("/orders/approval-logs", headers=headers)

        assert response.status_code == 200
        result = response.json()
        assert len(result) == 1
        assert result[0]["order_number"] == "ORD-001"
        assert result[0]["actor_full_name"] == "承認 太郎"
        assert result[0]["actor_email"] == "taro@example.com"
        assert result[0]["action"] == "approve"

    def test_list_approval_logs_forbidden_for_order_handler(
        self, headers, mock_supabase_client, mock_approval_log_repo
    ):
        """GET /approval-logs: order_handler は閲覧できない"""
        self._set_role(mock_supabase_client, "order_handler")

        response = client.get("/orders/approval-logs", headers=headers)

        assert response.status_code == 403
        mock_approval_log_repo.get_all.assert_not_called()

    def test_list_approval_logs_allowed_for_president(
        self, headers, mock_supabase_client, mock_approval_log_repo
    ):
        """GET /approval-logs: president も閲覧できる"""
        self._set_role(mock_supabase_client, "president")
        mock_approval_log_repo.get_all.return_value = []

        response = client.get("/orders/approval-logs", headers=headers)

        assert response.status_code == 200
        assert response.json() == []

    def test_export_approval_logs_csv(
        self, headers, mock_supabase_client, mock_approval_log_repo
    ):
        """GET /approval-logs/export: CSVとして出力される"""
        self._set_role(mock_supabase_client, "iso_officer")
        mock_approval_log_repo.get_all.return_value = [self._SAMPLE_LOG_ROW]
        self._mock_enrichment(mock_supabase_client)

        response = client.get("/orders/approval-logs/export", headers=headers)

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/csv")
        body = response.content.decode("utf-8-sig")
        assert "ORD-001" in body
        assert "承認 太郎" in body

    def test_export_approval_logs_csv_falls_back_to_order_id_when_order_number_missing(
        self, headers, mock_supabase_client, mock_approval_log_repo
    ):
        """GET /approval-logs/export: order_numberがNULLの場合は #order_id にフォールバックする"""
        self._set_role(mock_supabase_client, "iso_officer")
        mock_approval_log_repo.get_all.return_value = [self._SAMPLE_LOG_ROW]

        default_table_return = mock_supabase_client.table.return_value

        def table_side_effect(name):
            if name == "orders":
                m = MagicMock()
                # order_number が NULL の注文（例: 未確定の自動起票注文）
                m.select.return_value.in_.return_value.execute.return_value.data = [
                    {"id": 1, "order_number": None}
                ]
                return m
            if name == "profiles":
                m = MagicMock()
                m.select.return_value.in_.return_value.execute.return_value.data = []
                return m
            return default_table_return

        mock_supabase_client.table.side_effect = table_side_effect

        response = client.get("/orders/approval-logs/export", headers=headers)

        assert response.status_code == 200
        body = response.content.decode("utf-8-sig")
        assert "#1" in body

    def test_export_approval_logs_csv_forbidden_for_order_handler(
        self, headers, mock_supabase_client, mock_approval_log_repo
    ):
        """GET /approval-logs/export: order_handler は出力できない"""
        self._set_role(mock_supabase_client, "order_handler")

        response = client.get("/orders/approval-logs/export", headers=headers)

        assert response.status_code == 403
        mock_approval_log_repo.get_all.assert_not_called()

    # ------------------------------------------------------------------
    # POST /orders/email-intake （手動メール起票 / 分納の複数明細, Issue #358）
    # ------------------------------------------------------------------

    @staticmethod
    def _stub_attachment_insert(mock_supabase_client, staging_id="staging-1"):
        """order_attachments への insert().execute().data[0] をスタブする"""
        mock_supabase_client.table.return_value.insert.return_value.execute.return_value.data = [  # noqa: E501
            {"id": staging_id}
        ]

    def test_email_intake_success_multi_line_with_attachment(
        self, headers, mock_repo, mock_supabase_client, mock_admin_client
    ):
        """POST /email-intake: 本文＋添付付きで分納2明細をまとめて起票できる"""

        self._stub_attachment_insert(mock_supabase_client, "staging-1")
        mock_repo.create.side_effect = [
            {"id": 101, "order_number": None, "product_id": 1, "quantity": 10},
            {"id": 102, "order_number": None, "product_id": 1, "quantity": 20},
        ]

        payload = {
            "customer_id": 7,
            "customer_certainty": "confirmed",
            "source_raw": "発注のご依頼\n分納でお願いします",
            "line_items": [
                {"product_id": 1, "quantity": 10, "desired_deadline": "2026-09-01"},
                {"product_id": 1, "quantity": 20, "desired_deadline": "2026-10-01"},
            ],
        }

        response = client.post(
            "/orders/email-intake",
            data={"payload": json.dumps(payload)},
            files={"files": ("order.pdf", b"%PDF-1.4 test", "application/pdf")},
            headers=headers,
        )

        assert response.status_code == 200
        body = response.json()
        assert body["staging_attachment_id"] == "staging-1"
        assert len(body["created_orders"]) == 2

        assert mock_repo.create.call_count == 2
        first = mock_repo.create.call_args_list[0][0][0]
        assert first["source_type"] == "email"
        assert first["status"] == "draft"
        assert first["source_raw"] == payload["source_raw"]
        assert first["customer_id"] == 7
        assert first["source_attachment_id"] == "staging-1"
        assert first["tenant_id"] == headers["x-tenant-id"]

        # Storage へ添付をアップロードしている
        assert mock_admin_client.storage.from_.return_value.upload.called

        # 集約行1件 + 明細ごとの添付行2件 = 3回 insert
        insert_calls = mock_supabase_client.table.return_value.insert.call_args_list
        assert len(insert_calls) == 3
        staging_insert = insert_calls[0][0][0]
        # 集約行は order_id を持たない（DB default で NULL = 受信メール相当のステージング行）
        assert "order_id" not in staging_insert
        assert staging_insert["parse_status"] == "success"
        per_order_insert = insert_calls[1][0][0]
        assert per_order_insert[0]["order_id"] == 101
        assert per_order_insert[0]["parse_status"] == "success"

    def test_email_intake_body_only_no_attachment(
        self, headers, mock_repo, mock_supabase_client
    ):
        """POST /email-intake: 添付なし・本文のみでも起票でき parse_status は failed_no_attachment"""

        self._stub_attachment_insert(mock_supabase_client, "staging-2")
        mock_repo.create.side_effect = [
            {"id": 201, "order_number": None, "product_id": None, "quantity": 5}
        ]

        payload = {
            "customer_id": 3,
            "source_raw": "本文のみ",
            "line_items": [{"quantity": 5, "desired_deadline": "2026-09-15"}],
        }

        response = client.post(
            "/orders/email-intake",
            data={"payload": json.dumps(payload)},
            headers=headers,
        )

        assert response.status_code == 200
        body = response.json()
        assert len(body["created_orders"]) == 1

        insert_calls = mock_supabase_client.table.return_value.insert.call_args_list
        staging_insert = insert_calls[0][0][0]
        # 集約行の parse_status は処理状態を表すため添付なしでも success
        assert staging_insert["parse_status"] == "success"
        assert staging_insert["storage_path"] == ""
        # 「添付なし」は各注文に紐づく行の parse_status で表現する
        per_order_insert = insert_calls[1][0][0]
        assert per_order_insert[0]["parse_status"] == "failed_no_attachment"

    def test_email_intake_rejects_empty_line_items(self, headers):
        """POST /email-intake: line_items が空なら422"""

        response = client.post(
            "/orders/email-intake",
            data={"payload": json.dumps({"customer_id": 1, "line_items": []})},
            headers=headers,
        )

        assert response.status_code == 422

    def test_email_intake_staging_insert_api_error_returns_400(
        self, headers, mock_repo, mock_supabase_client
    ):
        """POST /email-intake: 集約行の INSERT が APIError なら 500 でなく 400 を返す"""
        from postgrest.exceptions import APIError

        mock_supabase_client.table.return_value.insert.return_value.execute.side_effect = APIError(  # noqa: E501
            {"message": "new row violates row-level security policy", "code": "42501"}
        )

        response = client.post(
            "/orders/email-intake",
            data={
                "payload": json.dumps(
                    {
                        "customer_id": 1,
                        "line_items": [
                            {"quantity": 1, "desired_deadline": "2026-09-01"}
                        ],
                    }
                )
            },
            headers=headers,
        )

        assert response.status_code == 400
        mock_repo.create.assert_not_called()

    def test_email_intake_rolls_back_created_orders_on_failure(
        self, headers, mock_repo, mock_supabase_client
    ):
        """POST /email-intake: 2件目の作成失敗時は既作成分と集約行をロールバックする"""

        self._stub_attachment_insert(mock_supabase_client, "staging-3")
        mock_repo.create.side_effect = [
            {"id": 301, "order_number": None, "product_id": 1, "quantity": 10},
            ValueError("重複データ"),
        ]

        payload = {
            "customer_id": 9,
            "line_items": [
                {"product_id": 1, "quantity": 10, "desired_deadline": "2026-09-01"},
                {"product_id": 1, "quantity": 20, "desired_deadline": "2026-10-01"},
            ],
        }

        response = client.post(
            "/orders/email-intake",
            data={"payload": json.dumps(payload)},
            headers=headers,
        )

        assert response.status_code == 400
        mock_repo.delete.assert_any_call(301)
