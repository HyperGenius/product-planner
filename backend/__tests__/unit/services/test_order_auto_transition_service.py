# __tests__/unit/services/test_order_auto_transition_service.py
from datetime import date

import pytest
from app.services.order_auto_transition_service import (
    classify_status_transitions,
    resolve_effective_start_date,
)


@pytest.mark.unit
class TestResolveEffectiveStartDate:
    """着手日の解決ロジック (Issue #400)"""

    def test_prefers_explicit_scheduling_start_date(self):
        assert resolve_effective_start_date(
            "2026-09-10", "2026-09-01T09:00:00+09:00"
        ) == date(2026, 9, 10)

    def test_falls_back_to_earliest_schedule_start(self):
        assert resolve_effective_start_date(None, "2026-09-01T09:00:00+09:00") == date(
            2026, 9, 1
        )

    def test_none_when_no_source(self):
        assert resolve_effective_start_date(None, None) is None

    def test_invalid_scheduling_start_date_falls_back(self):
        assert resolve_effective_start_date(
            "not-a-date", "2026-09-01T00:00:00Z"
        ) == date(2026, 9, 1)

    def test_invalid_schedule_start_is_none(self):
        assert resolve_effective_start_date(None, "garbage") is None


@pytest.mark.unit
class TestClassifyStatusTransitions:
    """confirmed <-> in_progress の振り分け (Issue #400)"""

    TODAY = date(2026, 9, 8)

    def test_confirmed_started_goes_in_progress(self):
        candidates = [
            {"id": 1, "status": "confirmed", "scheduling_start_date": "2026-09-08"},
            {"id": 2, "status": "confirmed", "scheduling_start_date": "2026-09-07"},
        ]
        to_in_progress, to_confirmed = classify_status_transitions(
            candidates, {}, self.TODAY
        )
        assert to_in_progress == [1, 2]
        assert to_confirmed == []

    def test_confirmed_future_start_stays(self):
        candidates = [
            {"id": 1, "status": "confirmed", "scheduling_start_date": "2026-09-09"},
        ]
        to_in_progress, to_confirmed = classify_status_transitions(
            candidates, {}, self.TODAY
        )
        assert to_in_progress == []
        assert to_confirmed == []

    def test_in_progress_future_start_rolls_back(self):
        candidates = [
            {"id": 5, "status": "in_progress", "scheduling_start_date": "2026-09-20"},
        ]
        to_in_progress, to_confirmed = classify_status_transitions(
            candidates, {}, self.TODAY
        )
        assert to_in_progress == []
        assert to_confirmed == [5]

    def test_in_progress_started_stays(self):
        candidates = [
            {"id": 5, "status": "in_progress", "scheduling_start_date": "2026-09-01"},
        ]
        to_in_progress, to_confirmed = classify_status_transitions(
            candidates, {}, self.TODAY
        )
        assert to_in_progress == []
        assert to_confirmed == []

    def test_uses_schedule_fallback_when_no_scheduling_start_date(self):
        candidates = [
            {"id": 3, "status": "confirmed", "scheduling_start_date": None},
        ]
        earliest = {3: "2026-09-08T09:00:00+09:00"}
        to_in_progress, to_confirmed = classify_status_transitions(
            candidates, earliest, self.TODAY
        )
        assert to_in_progress == [3]

    def test_skips_orders_without_resolvable_start_date(self):
        candidates = [
            {"id": 4, "status": "confirmed", "scheduling_start_date": None},
        ]
        to_in_progress, to_confirmed = classify_status_transitions(
            candidates, {}, self.TODAY
        )
        assert to_in_progress == []
        assert to_confirmed == []

    def test_ignores_non_target_statuses(self):
        candidates = [
            {"id": 9, "status": "draft", "scheduling_start_date": "2026-01-01"},
            {"id": 10, "status": "shipped", "scheduling_start_date": "2026-01-01"},
        ]
        to_in_progress, to_confirmed = classify_status_transitions(
            candidates, {}, self.TODAY
        )
        assert to_in_progress == []
        assert to_confirmed == []
