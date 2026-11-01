# __tests__/api/routers/transaction/test_order_customer_link.py
"""顧客不明の注文を既存の顧客へ紐づける API（Issue #609）。"""

from unittest.mock import MagicMock

import app.routers.transaction.orders.customer_link as customer_link_module
import pytest
from app.dependencies import get_current_user_id, get_order_repo, get_supabase_client
from app.main import app
from app.services.customer_link_service import (
    LinkContactConflictError,
    LinkCustomerNotFoundError,
    LinkOrderDuplicateError,
    LinkOrderNotUnknownError,
)
from fastapi.testclient import TestClient

client = TestClient(app)

_UNKNOWN_ORDER = {
    "id": 1,
    "customer_id": None,
    "product_id": 5,
    "deadline_date": "2026-12-01",
    "extracted_product_name": None,
    "source_attachment_id": "att-1",
}


@pytest.mark.api
class TestOrderCustomerLinkRouter:
    @pytest.fixture
    def mock_repo(self):
        repo = MagicMock()
        repo.get_by_id.return_value = dict(_UNKNOWN_ORDER)
        return repo

    @pytest.fixture(autouse=True)
    def override_dependency(self, mock_repo):
        app.dependency_overrides[get_order_repo] = lambda: mock_repo
        app.dependency_overrides[get_supabase_client] = lambda: MagicMock()
        app.dependency_overrides[get_current_user_id] = lambda: "test-user-id"
        yield
        app.dependency_overrides = {}

    @pytest.fixture
    def mock_link(self, monkeypatch):
        mock = MagicMock(
            return_value={
                "contact_registered": True,
                "sender_email": "taro@example.com",
                "linked_order_ids": [1, 2],
                "skipped_order_ids": [],
                "linked_staging_count": 1,
            }
        )
        monkeypatch.setattr(customer_link_module, "link_customer", mock)
        return mock

    def test_link_defaults_to_registering_contact(self, headers, mock_link):
        response = client.post(
            "/orders/1/link-customer", json={"customer_id": 9}, headers=headers
        )

        assert response.status_code == 200
        assert response.json()["linked_order_ids"] == [1, 2]
        args = mock_link.call_args.args
        assert args[2:] == (1, 9, True, False)

    def test_link_passes_options(self, headers, mock_link):
        client.post(
            "/orders/1/link-customer",
            json={
                "customer_id": 9,
                "register_contact": False,
                "apply_to_same_sender": True,
            },
            headers=headers,
        )

        assert mock_link.call_args.args[2:] == (1, 9, False, True)

    def test_contact_owned_by_other_customer_is_409(self, headers, mock_link):
        mock_link.side_effect = LinkContactConflictError()

        response = client.post(
            "/orders/1/link-customer", json={"customer_id": 9}, headers=headers
        )

        assert response.status_code == 409
        assert response.json()["detail"]["error"] == "contact_owned_by_other_customer"

    def test_duplicate_order_is_409_with_conflicting_order(
        self, headers, mock_link, mock_repo
    ):
        mock_link.side_effect = LinkOrderDuplicateError("orders_dedupe_key")
        mock_repo.find_dedupe_conflict.return_value = None

        response = client.post(
            "/orders/1/link-customer", json={"customer_id": 9}, headers=headers
        )

        assert response.status_code == 409
        assert response.json()["detail"]["error"] == "duplicate_order"
        # 生の制約名はレスポンスに載せない
        assert "orders_dedupe_key" not in response.text

    def test_order_that_already_has_customer_is_409(self, headers, mock_link):
        mock_link.side_effect = LinkOrderNotUnknownError()

        response = client.post(
            "/orders/1/link-customer", json={"customer_id": 9}, headers=headers
        )

        assert response.status_code == 409
        assert response.json()["detail"]["error"] == "customer_already_set"

    def test_unknown_customer_is_404(self, headers, mock_link):
        mock_link.side_effect = LinkCustomerNotFoundError()

        response = client.post(
            "/orders/1/link-customer", json={"customer_id": 999}, headers=headers
        )

        assert response.status_code == 404

    def test_missing_order_is_404(self, headers, mock_link, mock_repo):
        mock_repo.get_by_id.return_value = None

        response = client.post(
            "/orders/1/link-customer", json={"customer_id": 9}, headers=headers
        )

        assert response.status_code == 404
        mock_link.assert_not_called()

    def test_context_returns_sender_and_candidates(self, headers, monkeypatch):
        monkeypatch.setattr(
            customer_link_module,
            "get_link_context",
            MagicMock(
                return_value={
                    "sender_email": "taro@example.com",
                    "contact_owner_customer_id": None,
                    "candidate_customer_ids": [4, 2],
                    "same_sender_order_count": 3,
                }
            ),
        )

        response = client.get("/orders/1/customer-link-context", headers=headers)

        assert response.status_code == 200
        assert response.json() == {
            "sender_email": "taro@example.com",
            "contact_owner_customer_id": None,
            "candidate_customer_ids": [4, 2],
            "same_sender_order_count": 3,
        }

    def test_context_is_empty_for_order_with_customer(self, headers, mock_repo):
        mock_repo.get_by_id.return_value = {**_UNKNOWN_ORDER, "customer_id": 3}

        response = client.get("/orders/1/customer-link-context", headers=headers)

        assert response.status_code == 200
        assert response.json()["sender_email"] is None
        assert response.json()["candidate_customer_ids"] == []
