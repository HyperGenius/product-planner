# __tests__/unit/services/test_order_status_service.py
from datetime import date

import pytest
from app.services.order_status_service import (
    InvalidOrderStatusTransitionError,
    is_overdue_draft,
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
            ("confirmed", "shipped"),
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
            ("draft", "shipped"),
            ("pending_approval", "shipped"),
            ("shipped", "completed"),
            ("shipped", "confirmed"),
        ],
    )
    def test_disallowed_transitions(self, current_status, new_status):
        """不正な遷移(逆行・飛び越し・未知の状態からの遷移)は拒否される"""
        with pytest.raises(InvalidOrderStatusTransitionError):
            validate_order_status_transition(current_status, new_status)


@pytest.mark.unit
class TestIsOverdueDraft:
    """納期超過の下書き判定のユニットテスト (Issue #367)"""

    TODAY = date(2026, 8, 31)

    @pytest.mark.parametrize(
        ("status", "deadline_date"),
        [
            ("draft", "2026-08-30"),
            ("draft", "2000-01-01"),
            ("draft", "2026-08-30T00:00:00"),
        ],
    )
    def test_overdue_draft_is_target(self, status, deadline_date):
        """draft かつ 納期 < today は対象"""
        assert is_overdue_draft(status, deadline_date, self.TODAY) is True

    @pytest.mark.parametrize(
        ("status", "deadline_date"),
        [
            ("draft", "2026-08-31"),  # 当日は超過扱いにしない
            ("draft", "2026-09-01"),  # 未来
            ("draft", None),  # 納期未設定
            ("draft", ""),  # 納期未設定
            ("draft", "not-a-date"),  # 不正な日付
            ("pending_approval", "2026-08-30"),  # draft 以外
            ("confirmed", "2026-08-30"),
            ("shipped", "2026-08-30"),
            (None, "2026-08-30"),
        ],
    )
    def test_not_target(self, status, deadline_date):
        assert is_overdue_draft(status, deadline_date, self.TODAY) is False
