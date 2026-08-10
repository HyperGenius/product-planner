# __tests__/unit/services/test_order_status_service.py
import pytest
from app.services.order_status_service import (
    InvalidOrderStatusTransitionError,
    validate_order_status_transition,
)


@pytest.mark.unit
class TestOrderStatusService:
    """orders.status 遷移バリデーションのユニットテスト (Issue #324)"""

    @pytest.mark.parametrize(
        ("current_status", "new_status"),
        [
            ("draft", "pending_approval"),
            ("pending_approval", "confirmed"),
            ("pending_approval", "draft"),
            ("confirmed", "completed"),
            ("confirmed", "canceled"),
        ],
    )
    def test_allowed_transitions(self, current_status, new_status):
        """順方向遷移および差し戻し(pending_approval->draft)は許可される"""
        validate_order_status_transition(current_status, new_status)

    @pytest.mark.parametrize(
        ("current_status", "new_status"),
        [
            ("draft", "confirmed"),
            ("draft", "completed"),
            ("draft", "canceled"),
            ("pending_approval", "completed"),
            ("pending_approval", "canceled"),
            ("confirmed", "pending_approval"),
            ("confirmed", "draft"),
            ("completed", "confirmed"),
            ("canceled", "draft"),
            (None, "confirmed"),
        ],
    )
    def test_disallowed_transitions(self, current_status, new_status):
        """不正な遷移(逆行・飛び越し・未知の状態からの遷移)は拒否される"""
        with pytest.raises(InvalidOrderStatusTransitionError):
            validate_order_status_transition(current_status, new_status)
