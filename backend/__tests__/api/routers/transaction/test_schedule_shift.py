# __tests__/api/routers/transaction/test_schedule_shift.py
"""POST /orders/{order_id}/processes/{process_routing_id}/shift（Issue #582）"""

from typing import Any
from unittest.mock import MagicMock

import pytest
from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_supabase_client,
)
from app.main import app
from app.routers.transaction.orders import schedule_shift as router_module
from app.services.schedule_shift_service import (
    ShiftConflictError,
    ShiftForbiddenError,
    ShiftOrderNotAdjustableError,
    ShiftOrderNotFoundError,
)
from fastapi.testclient import TestClient

client = TestClient(app)

URL = "/orders/1000001/processes/100002/shift"

RESPONSE: dict[str, Any] = {
    "order_id": 1000001,
    "process_routing_id": 100002,
    "working_days": 1,
    "stopped_at_previous": False,
    "processes": [
        {
            "process_routing_id": 100002,
            "process_name": "検査",
            "sequence_order": 2,
            "is_milestone": False,
            "is_completed": False,
            "before": {
                "start_datetime": "2026-11-02T13:00:00+09:00",
                "end_datetime": "2026-11-03T12:00:00+09:00",
            },
            "after": {
                "start_datetime": "2026-11-03T13:00:00+09:00",
                "end_datetime": "2026-11-04T12:00:00+09:00",
            },
            "segments": [
                {
                    "start_datetime": "2026-11-03T13:00:00+09:00",
                    "end_datetime": "2026-11-03T17:00:00+09:00",
                    "equipment_id": 102,
                },
                {
                    "start_datetime": "2026-11-04T09:00:00+09:00",
                    "end_datetime": "2026-11-04T12:00:00+09:00",
                    "equipment_id": 102,
                },
            ],
        }
    ],
    "confirmed_deadline_before": "2026-11-03",
    "confirmed_deadline_after": "2026-11-04",
    "desired_deadline": "2026-11-03",
    "exceeds_desired_deadline": True,
    "overlaps": [
        {
            "process_routing_id": 100002,
            "process_name": "検査",
            "equipment_id": 102,
            "equipment_name": "検査機1",
            "other_order_id": 1000009,
            "other_order_number": "ORD-009",
            "other_process_name": "検査",
            "start_datetime": "2026-11-03T15:00:00+09:00",
            "end_datetime": "2026-11-03T16:00:00+09:00",
        }
    ],
    "saved": False,
}


@pytest.mark.api
class TestShiftOrderProcess:
    @pytest.fixture(autouse=True)
    def override_dependency(self):
        app.dependency_overrides[get_current_user_id] = lambda: "test-user-id"
        app.dependency_overrides[get_current_tenant_id] = lambda: "test-tenant-id"
        app.dependency_overrides[get_supabase_client] = lambda: MagicMock()
        yield
        app.dependency_overrides = {}

    @pytest.fixture
    def set_role(self, monkeypatch):
        def _set(role: str) -> None:
            monkeypatch.setattr(
                router_module, "get_current_user_role", lambda *_args: role
            )

        return _set

    @pytest.fixture
    def shift_process(self, monkeypatch):
        mock = MagicMock(return_value=RESPONSE)
        monkeypatch.setattr(router_module, "shift_process", mock)
        return mock

    def test_preview(self, headers, set_role, shift_process):
        set_role("president")

        response = client.post(URL, json={"working_days": 1}, headers=headers)

        assert response.status_code == 200
        assert response.json() == RESPONSE
        # dry_run の既定は true（プレビュー）
        _, args, kwargs = shift_process.mock_calls[0]
        assert args[1:] == ("test-tenant-id", 1000001, 100002, 1)
        assert kwargs == {"dry_run": True}

    def test_save(self, headers, set_role, shift_process):
        set_role("president")
        shift_process.return_value = {**RESPONSE, "saved": True}

        response = client.post(
            URL, json={"working_days": -2, "dry_run": False}, headers=headers
        )

        assert response.status_code == 200
        assert response.json()["saved"] is True
        _, args, kwargs = shift_process.mock_calls[0]
        assert args[4] == -2
        assert kwargs == {"dry_run": False}

    @pytest.mark.parametrize("role", ["order_handler", "iso_officer", "platform_admin"])
    def test_forbidden_for_non_editor(self, headers, set_role, shift_process, role):
        set_role(role)

        response = client.post(URL, json={"working_days": 1}, headers=headers)

        assert response.status_code == 403
        shift_process.assert_not_called()

    @pytest.mark.parametrize("working_days", [0, 31, -31])
    def test_invalid_working_days(self, headers, set_role, shift_process, working_days):
        set_role("president")

        response = client.post(
            URL, json={"working_days": working_days}, headers=headers
        )

        assert response.status_code == 422
        shift_process.assert_not_called()

    @pytest.mark.parametrize(
        ("error", "status_code", "code"),
        [
            (ShiftOrderNotFoundError, 404, None),
            (ShiftOrderNotAdjustableError, 409, "order_not_adjustable"),
            (ShiftConflictError, 409, "schedule_changed"),
            (ShiftForbiddenError, 403, None),
        ],
    )
    def test_errors(self, headers, set_role, shift_process, error, status_code, code):
        set_role("president")
        shift_process.side_effect = error

        response = client.post(
            URL, json={"working_days": 1, "dry_run": False}, headers=headers
        )

        assert response.status_code == status_code
        if code is not None:
            assert response.json()["detail"]["error"] == code
