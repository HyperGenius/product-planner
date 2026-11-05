from unittest.mock import MagicMock

import pytest
from app.dependencies import get_current_user_id, get_supabase_client
from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)


def _query(data):
    q = MagicMock()
    for name in ("select", "eq", "is_", "order", "update"):
        getattr(q, name).return_value = q
    q.not_ = q
    q.in_.return_value = q
    q.execute.return_value = MagicMock(data=data)
    return q


@pytest.mark.api
class TestOrderDeliveryRequestsRouter:
    @pytest.fixture(autouse=True)
    def override_dependency(self):
        app.dependency_overrides[get_current_user_id] = lambda: "test-user-id"
        yield
        app.dependency_overrides = {}

    def _use(self, query):
        db = MagicMock()
        db.table.return_value = query
        app.dependency_overrides[get_supabase_client] = lambda: db
        return db

    def test_open_counts_group_by_order(self, headers):
        self._use(_query([{"order_id": 1}, {"order_id": 1}, {"order_id": 4}]))
        res = client.get("/orders/delivery-requests/open-counts", headers=headers)
        assert res.status_code == 200
        assert res.json() == [
            {"order_id": 1, "count": 2},
            {"order_id": 4, "count": 1},
        ]

    def test_list_open_includes_unlinked_with_customer(self, headers):
        base = {
            "kind": "delivery_chase",
            "created_at": "2026-11-01T00:00:00+00:00",
        }
        requests = [
            {**base, "id": "r1", "order_id": 5, "order_attachment_id": "a1"},
            {**base, "id": "r2", "order_id": None, "order_attachment_id": "a2"},
        ]
        by_table = {
            "order_delivery_requests": _query(requests),
            "orders": _query(
                [
                    {
                        "id": 5,
                        "order_number": "O-5",
                        "customer_id": 1,
                        "quantity": 200,
                        "deadline_date": "2026-10-20",
                        "confirmed_deadline": "2026-11-10",
                        "simulated_deadline": None,
                    }
                ]
            ),
            "order_attachments": _query([{"id": "a2", "customer_id": 2}]),
            "customers": _query(
                [{"id": 1, "name": "顧客A"}, {"id": 2, "name": "顧客B"}]
            ),
        }
        db = MagicMock()
        db.table.side_effect = lambda name: by_table.get(name, _query([]))
        app.dependency_overrides[get_supabase_client] = lambda: db
        res = client.get("/orders/delivery-requests?status=open", headers=headers)
        assert res.status_code == 200
        body = res.json()
        assert [(r["id"], r["order_number"], r["customer_name"]) for r in body] == [
            ("r1", "O-5", "顧客A"),
            ("r2", None, "顧客B"),
        ]
        linked, unlinked = body
        assert linked["order_quantity"] == 200
        assert linked["desired_deadline"] == "2026-10-20"
        assert linked["confirmed_deadline"] == "2026-11-10"
        assert linked["simulated_deadline"] is None
        assert unlinked["order_quantity"] is None
        assert unlinked["desired_deadline"] is None

    def test_list_open_empty(self, headers):
        self._use(_query([]))
        res = client.get("/orders/delivery-requests", headers=headers)
        assert res.status_code == 200
        assert res.json() == []

    def test_list_for_order(self, headers):
        row = {
            "id": "r1",
            "order_id": 5,
            "kind": "delivery_chase",
            "extracted_product_name": "製品A",
            "quantity": 500,
            "requested_date": "2026-11-03",
            "body_snippet": "本文",
            "resolved_at": None,
            "created_at": "2026-11-01T00:00:00+00:00",
        }
        self._use(_query([row]))
        res = client.get("/orders/5/delivery-requests", headers=headers)
        assert res.status_code == 200
        assert res.json()[0]["kind"] == "delivery_chase"

    def test_resolve_sets_resolver(self, headers):
        row = {
            "id": "r1",
            "order_id": 5,
            "kind": "split_delivery",
            "created_at": "2026-11-01T00:00:00+00:00",
            "resolved_at": "2026-11-02T00:00:00+00:00",
        }
        query = _query([row])
        self._use(query)
        res = client.patch(
            "/orders/delivery-requests/r1", json={"resolved": True}, headers=headers
        )
        assert res.status_code == 200
        update = query.update.call_args.args[0]
        assert update["resolved_by"] == "test-user-id"
        assert update["resolved_at"] is not None

    def test_unresolve_clears_resolver(self, headers):
        row = {"id": "r1", "order_id": 5, "kind": "split_delivery", "created_at": "x"}
        query = _query([row])
        self._use(query)
        res = client.patch(
            "/orders/delivery-requests/r1",
            json={"resolved": False},
            headers=headers,
        )
        assert res.status_code == 200
        assert query.update.call_args.args[0] == {
            "resolved_at": None,
            "resolved_by": None,
        }

    def test_resolve_unknown_request_is_404(self, headers):
        self._use(_query([]))
        res = client.patch(
            "/orders/delivery-requests/nope",
            json={"resolved": True},
            headers=headers,
        )
        assert res.status_code == 404
