# __tests__/api/routers/transaction/test_repair_orders.py
"""修理注文（orders.order_type='repair'）の受注 API（Issue #493）。"""

from unittest.mock import MagicMock

import app.routers.transaction.orders.approval_workflow as approval_workflow_module
import pytest
from app.dependencies import (
    get_current_user_id,
    get_equipment_repo,
    get_order_approval_log_repo,
    get_order_repo,
    get_order_scheduling_start_backdate_log_repo,
    get_product_repo,
    get_schedule_repo,
    get_supabase_client,
)
from app.main import app
from app.repositories.supa_infra.common import DuplicateRecordError
from app.routers.transaction.orders import get_settings_repo
from fastapi.testclient import TestClient

client = TestClient(app)

_REPAIR_DRAFT = {
    "id": 1,
    "order_type": "repair",
    "product_id": None,
    "quantity": None,
    "status": "draft",
    "work_description": "基板 はんだ補修\n・補修部1〜3ヶ所 ×11",
    "deadline_date": "2099-11-10",
    "scheduling_start_date": None,
    "simulated_deadline": None,
    "is_scheduled": False,
}


@pytest.mark.api
class TestRepairOrderRouter:
    @pytest.fixture
    def mock_repo(self):
        return MagicMock()

    @pytest.fixture
    def mock_schedule_repo(self):
        return MagicMock()

    @pytest.fixture
    def mock_supabase_client(self):
        return MagicMock()

    @pytest.fixture
    def mock_approval_log_repo(self):
        return MagicMock()

    @pytest.fixture
    def mock_schedule_order(self, monkeypatch):
        """承認で schedule_order を呼ばないことを確認する（呼び出し元モジュールを差し替える）"""
        mock = MagicMock(return_value=[])
        monkeypatch.setattr(approval_workflow_module, "schedule_order", mock)
        return mock

    @pytest.fixture(autouse=True)
    def override_dependency(
        self,
        mock_repo,
        mock_schedule_repo,
        mock_supabase_client,
        mock_approval_log_repo,
    ):
        app.dependency_overrides[get_order_repo] = lambda: mock_repo
        app.dependency_overrides[get_product_repo] = lambda: MagicMock()
        app.dependency_overrides[get_equipment_repo] = lambda: MagicMock()
        app.dependency_overrides[get_schedule_repo] = lambda: mock_schedule_repo
        app.dependency_overrides[get_settings_repo] = lambda: MagicMock()
        app.dependency_overrides[get_supabase_client] = lambda: mock_supabase_client
        app.dependency_overrides[get_order_approval_log_repo] = lambda: (
            mock_approval_log_repo
        )
        app.dependency_overrides[get_order_scheduling_start_backdate_log_repo] = (
            lambda: MagicMock()
        )
        app.dependency_overrides[get_current_user_id] = lambda: "test-user-id"
        yield
        app.dependency_overrides = {}

    @staticmethod
    def _set_role(mock_supabase_client, role: str):
        (
            mock_supabase_client.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value.data
        ) = {"role": role}

    # --- POST /orders -------------------------------------------------------

    def test_create_repair_order_without_product(self, headers, mock_repo):
        mock_repo.create.return_value = {"id": 5, "order_type": "repair"}

        response = client.post(
            "/orders",
            json={
                "order_type": "repair",
                "customer_id": 3,
                "work_description": "基板 はんだ補修",
                "desired_deadline": "2099-11-10",
                "scheduling_start_date": "2099-11-01",
                "simulated_deadline": "2099-11-03",
            },
            headers=headers,
        )

        assert response.status_code == 200
        payload = mock_repo.create.call_args.args[0]
        assert payload["order_type"] == "repair"
        assert payload["product_id"] is None
        assert payload["quantity"] is None
        assert payload["work_description"] == "基板 はんだ補修"
        assert payload["deadline_date"] == "2099-11-10"
        assert payload["simulated_deadline"] == "2099-11-03"
        # 日付が揃っていれば承認依頼できる状態（シミュ済みと同じ扱い）
        assert payload["is_scheduled"] is True

    def test_create_repair_order_without_dates_is_not_scheduled(
        self, headers, mock_repo
    ):
        mock_repo.create.return_value = {"id": 5, "order_type": "repair"}

        response = client.post(
            "/orders",
            json={"order_type": "repair", "work_description": "補修"},
            headers=headers,
        )

        assert response.status_code == 200
        assert mock_repo.create.call_args.args[0]["is_scheduled"] is False

    @pytest.mark.parametrize(
        "extra", [{"product_id": 100}, {"quantity": 3}], ids=["product", "quantity"]
    )
    def test_create_repair_order_with_product_returns_422(
        self, headers, mock_repo, extra
    ):
        response = client.post(
            "/orders", json={"order_type": "repair", **extra}, headers=headers
        )

        assert response.status_code == 422
        assert response.json()["detail"] == {
            "error": "repair_order_product_not_allowed"
        }
        mock_repo.create.assert_not_called()

    def test_create_repair_order_end_before_start_returns_422(self, headers, mock_repo):
        response = client.post(
            "/orders",
            json={
                "order_type": "repair",
                "scheduling_start_date": "2099-11-05",
                "simulated_deadline": "2099-11-04",
            },
            headers=headers,
        )

        assert response.status_code == 422
        assert response.json()["detail"] == {"error": "repair_dates_out_of_order"}
        mock_repo.create.assert_not_called()

    def test_create_repair_order_invalid_simulated_deadline_returns_422(
        self, headers, mock_repo
    ):
        response = client.post(
            "/orders",
            json={"order_type": "repair", "simulated_deadline": "2099/11/04"},
            headers=headers,
        )

        assert response.status_code == 422
        assert response.json()["detail"] == {"error": "invalid_simulated_deadline"}

    def test_create_unknown_order_type_returns_422(self, headers, mock_repo):
        response = client.post(
            "/orders", json={"order_type": "maintenance"}, headers=headers
        )

        assert response.status_code == 422
        mock_repo.create.assert_not_called()

    def test_create_production_order_with_simulated_deadline_returns_422(
        self, headers, mock_repo
    ):
        response = client.post(
            "/orders",
            json={"product_id": 100, "quantity": 5, "simulated_deadline": "2099-11-04"},
            headers=headers,
        )

        assert response.status_code == 422
        assert response.json()["detail"] == {"error": "simulated_deadline_not_editable"}

    def test_create_production_order_defaults_to_production(self, headers, mock_repo):
        mock_repo.create.return_value = {"id": 5}

        response = client.post(
            "/orders", json={"product_id": 100, "quantity": 5}, headers=headers
        )

        assert response.status_code == 200
        payload = mock_repo.create.call_args.args[0]
        assert payload["order_type"] == "production"
        assert "is_scheduled" not in payload

    # --- PATCH /orders/{id} -------------------------------------------------

    def test_update_repair_dates_keeps_simulated_deadline(self, headers, mock_repo):
        """実施開始日を変えても完了予定日は消さず、日付が揃えば is_scheduled を立てる。"""
        mock_repo.get_by_id.return_value = {
            **_REPAIR_DRAFT,
            "simulated_deadline": "2099-11-05",
        }
        mock_repo.update.return_value = {**_REPAIR_DRAFT}

        response = client.patch(
            "/orders/1",
            json={
                "scheduling_start_date": "2099-11-01",
                "work_description": "補修（追記）",
            },
            headers=headers,
        )

        assert response.status_code == 200
        _, payload = mock_repo.update.call_args.args
        assert payload == {
            "scheduling_start_date": "2099-11-01",
            "work_description": "補修（追記）",
            "scheduling_start_date_auto": False,
            "is_scheduled": True,
        }

    def test_update_repair_simulated_deadline(self, headers, mock_repo):
        mock_repo.get_by_id.return_value = {
            **_REPAIR_DRAFT,
            "scheduling_start_date": "2099-11-01",
            "simulated_deadline": "2099-11-03",
            "is_scheduled": True,
        }
        mock_repo.update.return_value = {**_REPAIR_DRAFT}

        response = client.patch(
            "/orders/1", json={"simulated_deadline": "2099-11-04"}, headers=headers
        )

        assert response.status_code == 200
        _, payload = mock_repo.update.call_args.args
        assert payload == {"simulated_deadline": "2099-11-04"}

    def test_update_repair_clearing_date_unsets_is_scheduled(self, headers, mock_repo):
        mock_repo.get_by_id.return_value = {
            **_REPAIR_DRAFT,
            "scheduling_start_date": "2099-11-01",
            "simulated_deadline": "2099-11-03",
            "is_scheduled": True,
        }
        mock_repo.update.return_value = {**_REPAIR_DRAFT}

        response = client.patch(
            "/orders/1", json={"simulated_deadline": None}, headers=headers
        )

        assert response.status_code == 200
        _, payload = mock_repo.update.call_args.args
        assert payload == {"simulated_deadline": None, "is_scheduled": False}

    def test_update_repair_end_before_stored_start_returns_422(
        self, headers, mock_repo
    ):
        mock_repo.get_by_id.return_value = {
            **_REPAIR_DRAFT,
            "scheduling_start_date": "2099-11-05",
        }

        response = client.patch(
            "/orders/1", json={"simulated_deadline": "2099-11-04"}, headers=headers
        )

        assert response.status_code == 422
        assert response.json()["detail"] == {"error": "repair_dates_out_of_order"}
        mock_repo.update.assert_not_called()

    def test_update_repair_with_product_returns_422(self, headers, mock_repo):
        mock_repo.get_by_id.return_value = {**_REPAIR_DRAFT}

        response = client.patch("/orders/1", json={"product_id": 100}, headers=headers)

        assert response.status_code == 422
        assert response.json()["detail"] == {
            "error": "repair_order_product_not_allowed"
        }
        mock_repo.update.assert_not_called()

    def test_update_repair_order_type_is_ignored(self, headers, mock_repo):
        """order_type は作成後に変更できない（更新スキーマに無いキーは無視される）。"""
        mock_repo.get_by_id.return_value = {**_REPAIR_DRAFT}
        mock_repo.update.return_value = {**_REPAIR_DRAFT}

        response = client.patch(
            "/orders/1",
            json={"order_type": "production", "work_description": "補修"},
            headers=headers,
        )

        assert response.status_code == 200
        _, payload = mock_repo.update.call_args.args
        assert "order_type" not in payload

    def test_update_repair_duplicate_returns_409(self, headers, mock_repo):
        mock_repo.get_by_id.return_value = {**_REPAIR_DRAFT}
        mock_repo.update.side_effect = DuplicateRecordError(
            "重複データにより更新できません",
            constraint='duplicate key value violates unique constraint "orders_repair_customer_order_no_key"',
        )

        response = client.patch("/orders/1", json={"customer_id": 9}, headers=headers)

        assert response.status_code == 409
        detail = response.json()["detail"]
        assert detail["error"] == "duplicate_repair_order"
        assert "orders_repair" not in detail["message"]
        mock_repo.find_dedupe_conflict.assert_not_called()

    def test_update_production_with_simulated_deadline_returns_422(
        self, headers, mock_repo
    ):
        mock_repo.get_by_id.return_value = {
            "id": 1,
            "order_type": "production",
            "product_id": 100,
            "simulated_deadline": "2099-11-03",
        }

        response = client.patch(
            "/orders/1", json={"simulated_deadline": None}, headers=headers
        )

        assert response.status_code == 422
        assert response.json()["detail"] == {"error": "simulated_deadline_not_editable"}
        mock_repo.update.assert_not_called()

    # --- 承認依頼・承認 -----------------------------------------------------

    @pytest.mark.parametrize(
        "dates",
        [
            {},
            {"scheduling_start_date": "2099-11-01"},
            {"simulated_deadline": "2099-11-03"},
        ],
        ids=["none", "start_only", "end_only"],
    )
    def test_request_approval_without_dates_returns_422(
        self, headers, mock_repo, mock_supabase_client, dates
    ):
        self._set_role(mock_supabase_client, "order_handler")
        mock_repo.get_by_id.return_value = {**_REPAIR_DRAFT, **dates}

        response = client.post("/orders/1/request-approval", headers=headers)

        assert response.status_code == 422
        assert response.json()["detail"] == {"error": "repair_dates_missing"}
        mock_repo.update.assert_not_called()

    def test_request_approval_with_dates_succeeds_without_product(
        self, headers, mock_repo, mock_supabase_client
    ):
        self._set_role(mock_supabase_client, "order_handler")
        mock_repo.get_by_id.return_value = {
            **_REPAIR_DRAFT,
            "scheduling_start_date": "2099-11-01",
            "simulated_deadline": "2099-11-03",
        }
        mock_repo.update.return_value = {**_REPAIR_DRAFT, "status": "pending_approval"}

        response = client.post("/orders/1/request-approval", headers=headers)

        assert response.status_code == 200
        _, payload = mock_repo.update.call_args.args
        assert payload["status"] == "pending_approval"

    def test_confirm_repair_copies_simulated_deadline_without_schedules(
        self,
        headers,
        mock_repo,
        mock_schedule_repo,
        mock_supabase_client,
        mock_schedule_order,
    ):
        self._set_role(mock_supabase_client, "president")
        mock_repo.get_by_id.return_value = {
            **_REPAIR_DRAFT,
            "status": "pending_approval",
            # 過去日でも修理では繰り上げない（スケジュールを組まないため）
            "scheduling_start_date": "2000-01-03",
            "scheduling_start_date_auto": True,
            "simulated_deadline": "2000-01-05",
        }

        response = client.post("/orders/1/confirm", headers=headers)

        assert response.status_code == 200
        assert response.json() == {"status": "confirmed", "schedules": []}
        mock_schedule_order.assert_not_called()
        mock_schedule_repo.create.assert_not_called()
        _, payload = mock_repo.update.call_args.args
        assert payload["status"] == "confirmed"
        assert payload["is_scheduled"] is True
        assert payload["confirmed_deadline"] == "2000-01-05"
        assert "confirmed_at" in payload
        assert "scheduling_start_date" not in payload

    def test_confirm_repair_without_dates_returns_422(
        self, headers, mock_repo, mock_supabase_client, mock_schedule_order
    ):
        self._set_role(mock_supabase_client, "president")
        mock_repo.get_by_id.return_value = {
            **_REPAIR_DRAFT,
            "status": "pending_approval",
        }

        response = client.post("/orders/1/confirm", headers=headers)

        assert response.status_code == 422
        assert response.json()["detail"] == {"error": "repair_dates_missing"}
        mock_repo.update.assert_not_called()

    def test_approve_bulk_includes_repair(
        self, headers, mock_repo, mock_supabase_client, mock_schedule_order
    ):
        self._set_role(mock_supabase_client, "president")
        mock_repo.get_by_id.return_value = {
            **_REPAIR_DRAFT,
            "status": "pending_approval",
            "scheduling_start_date": "2099-11-01",
            "simulated_deadline": "2099-11-03",
        }

        response = client.post(
            "/orders/approve-bulk", json={"order_ids": [1]}, headers=headers
        )

        assert response.status_code == 200
        assert response.json()["results"] == [
            {"order_id": 1, "status": "confirmed", "schedules": []}
        ]
        mock_schedule_order.assert_not_called()

    # --- シミュレーション・分割 ---------------------------------------------

    def test_simulate_repair_returns_422(self, headers, mock_repo):
        mock_repo.get_by_id.return_value = {**_REPAIR_DRAFT}

        response = client.post("/orders/1/simulate", headers=headers)

        assert response.status_code == 422
        assert response.json()["detail"] == {"error": "repair_order_not_simulatable"}

    def test_split_repair_returns_400(self, headers, mock_repo):
        mock_repo.get_by_id.return_value = {
            **_REPAIR_DRAFT,
            "source_attachment_id": "att-1",
        }

        response = client.post(
            "/orders/1/split",
            json={
                "line_items": [
                    {"product_id": 1, "quantity": 1, "desired_deadline": "2099-11-01"},
                    {"product_id": 2, "quantity": 1, "desired_deadline": "2099-11-01"},
                ]
            },
            headers=headers,
        )

        assert response.status_code == 400
        mock_repo.update.assert_not_called()

    # --- 生産の下書き → 修理等（Issue #568） ---------------------------------

    _PRODUCTION_DRAFT = {
        "id": 1,
        "order_type": "production",
        "product_id": None,
        "quantity": 11,
        "extracted_product_name": "基板 はんだ補修",
        "status": "draft",
        "deadline_date": "2099-11-10",
        "scheduling_start_date": "2099-10-25",
        "scheduling_start_date_auto": True,
        "simulated_deadline": None,
        "is_scheduled": False,
    }

    _CONVERT_BODY = {
        "order_no": "R-001",
        "customer_id": 3,
        "desired_deadline": "2099-11-10",
        "work_description": "  基板 はんだ補修\n・補修部1〜3ヶ所 ×11  ",
        "scheduling_start_date": "2099-11-01",
        "simulated_deadline": "2099-11-03",
    }

    def test_convert_to_repair_clears_product_and_sets_repair_fields(
        self, headers, mock_repo, mock_approval_log_repo
    ):
        mock_repo.get_by_id.return_value = {**self._PRODUCTION_DRAFT}
        mock_repo.convert_draft_to_repair.return_value = {
            **_REPAIR_DRAFT,
            "order_number": "R-001",
        }

        response = client.post(
            "/orders/1/convert-to-repair", json=self._CONVERT_BODY, headers=headers
        )

        assert response.status_code == 200
        assert response.json()["order_no"] == "R-001"
        order_id, payload = mock_repo.convert_draft_to_repair.call_args.args
        assert order_id == 1
        assert payload == {
            "order_number": "R-001",
            "customer_id": 3,
            "deadline_date": "2099-11-10",
            "work_description": "基板 はんだ補修\n・補修部1〜3ヶ所 ×11",
            "scheduling_start_date": "2099-11-01",
            "scheduling_start_date_auto": False,
            "simulated_deadline": "2099-11-03",
            "is_scheduled": True,
            "product_id": None,
            "quantity": None,
            "extracted_product_name": None,
            "product_candidates": None,
        }
        mock_repo.update.assert_not_called()
        mock_approval_log_repo.log_action.assert_called_once_with(
            headers["x-tenant-id"], 1, "convert_to_repair", "test-user-id", None
        )

    def test_convert_to_repair_without_dates_is_not_scheduled(self, headers, mock_repo):
        mock_repo.get_by_id.return_value = {**self._PRODUCTION_DRAFT}
        mock_repo.convert_draft_to_repair.return_value = {**_REPAIR_DRAFT}

        response = client.post(
            "/orders/1/convert-to-repair",
            json={"work_description": "補修"},
            headers=headers,
        )

        assert response.status_code == 200
        _, payload = mock_repo.convert_draft_to_repair.call_args.args
        assert payload["is_scheduled"] is False
        assert payload["scheduling_start_date"] is None
        assert payload["order_number"] is None

    @pytest.mark.parametrize("work_description", ["", "  \n "])
    def test_convert_to_repair_requires_work_description(
        self, headers, mock_repo, work_description
    ):
        response = client.post(
            "/orders/1/convert-to-repair",
            json={"work_description": work_description},
            headers=headers,
        )

        assert response.status_code == 422
        assert response.json()["detail"] == {"error": "work_description_required"}
        mock_repo.convert_draft_to_repair.assert_not_called()

    def test_convert_to_repair_end_before_start_returns_422(self, headers, mock_repo):
        response = client.post(
            "/orders/1/convert-to-repair",
            json={
                "work_description": "補修",
                "scheduling_start_date": "2099-11-05",
                "simulated_deadline": "2099-11-03",
            },
            headers=headers,
        )

        assert response.status_code == 422
        assert response.json()["detail"] == {"error": "repair_dates_out_of_order"}
        mock_repo.convert_draft_to_repair.assert_not_called()

    @pytest.mark.parametrize(
        "order",
        [
            {**_REPAIR_DRAFT},
            {**_PRODUCTION_DRAFT, "status": "pending_approval"},
            {**_PRODUCTION_DRAFT, "status": "confirmed"},
        ],
        ids=["already_repair", "pending_approval", "confirmed"],
    )
    def test_convert_to_repair_rejects_non_production_draft(
        self, headers, mock_repo, mock_approval_log_repo, order
    ):
        mock_repo.get_by_id.return_value = order

        response = client.post(
            "/orders/1/convert-to-repair",
            json={"work_description": "補修"},
            headers=headers,
        )

        assert response.status_code == 400
        mock_repo.convert_draft_to_repair.assert_not_called()
        mock_approval_log_repo.log_action.assert_not_called()

    def test_convert_to_repair_not_found(self, headers, mock_repo):
        mock_repo.get_by_id.return_value = None

        response = client.post(
            "/orders/999/convert-to-repair",
            json={"work_description": "補修"},
            headers=headers,
        )

        assert response.status_code == 404

    def test_convert_to_repair_returns_400_when_status_changed_before_update(
        self, headers, mock_repo, mock_approval_log_repo
    ):
        """確認後に承認依頼された等で、条件付き UPDATE が0件だった"""
        mock_repo.get_by_id.return_value = {**self._PRODUCTION_DRAFT}
        mock_repo.convert_draft_to_repair.return_value = None

        response = client.post(
            "/orders/1/convert-to-repair",
            json={"work_description": "補修"},
            headers=headers,
        )

        assert response.status_code == 400
        mock_approval_log_repo.log_action.assert_not_called()

    def test_convert_to_repair_duplicate_returns_409(
        self, headers, mock_repo, mock_approval_log_repo
    ):
        mock_repo.get_by_id.return_value = {**self._PRODUCTION_DRAFT}
        mock_repo.convert_draft_to_repair.side_effect = DuplicateRecordError(
            "重複データにより更新できません",
            constraint='duplicate key value violates unique constraint "orders_repair_customer_order_no_key"',
        )

        response = client.post(
            "/orders/1/convert-to-repair", json=self._CONVERT_BODY, headers=headers
        )

        assert response.status_code == 409
        detail = response.json()["detail"]
        assert detail["error"] == "duplicate_repair_order"
        assert "orders_repair" not in detail["message"]
        mock_approval_log_repo.log_action.assert_not_called()

    def test_convert_to_repair_backdated_start_forbidden_for_order_handler(
        self, headers, mock_repo, mock_supabase_client
    ):
        self._set_role(mock_supabase_client, "order_handler")

        response = client.post(
            "/orders/1/convert-to-repair",
            json={"work_description": "補修", "scheduling_start_date": "2000-01-01"},
            headers=headers,
        )

        assert response.status_code == 403
        mock_repo.convert_draft_to_repair.assert_not_called()
