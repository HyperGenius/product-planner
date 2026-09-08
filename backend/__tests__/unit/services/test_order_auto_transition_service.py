# __tests__/unit/services/test_order_auto_transition_service.py
from datetime import date
from typing import Any

import pytest
from app.services.order_auto_transition_service import (
    classify_status_transitions,
    earliest_start_date_by_order,
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

    def test_schedule_start_converted_to_jst_date(self):
        # UTC 2026-09-08T20:00Z は JST では 2026-09-09 05:00。JST の暦日で判定する。
        assert resolve_effective_start_date(None, "2026-09-08T20:00:00Z") == date(
            2026, 9, 9
        )

    def test_accepts_date_fallback_as_is(self):
        assert resolve_effective_start_date(None, date(2026, 9, 1)) == date(2026, 9, 1)


@pytest.mark.unit
class TestEarliestStartDateByOrder:
    """最早 start_datetime の算出は文字列辞書順ではなく時刻順で行う (Issue #400)"""

    def test_picks_minimum_across_mixed_offsets(self):
        rows = [
            # 辞書順では "2026-09-08T09:00:00+09:00" < "2026-09-08T10:00:00Z" だが、
            # 実時刻は 00:00Z < 10:00Z なので前者が最早。
            {"order_id": 1, "start_datetime": "2026-09-08T09:00:00+09:00"},
            {"order_id": 1, "start_datetime": "2026-09-08T10:00:00Z"},
        ]
        assert earliest_start_date_by_order(rows) == {1: date(2026, 9, 8)}

    def test_utc_late_evening_rolls_to_next_jst_day(self):
        rows = [{"order_id": 2, "start_datetime": "2026-09-08T20:00:00Z"}]
        assert earliest_start_date_by_order(rows) == {2: date(2026, 9, 9)}

    def test_skips_unparseable_and_null_rows(self):
        rows: list[dict[str, Any]] = [
            {"order_id": 3, "start_datetime": None},
            {"order_id": 3, "start_datetime": "not-a-datetime"},
            {"order_id": 3, "start_datetime": "2026-09-10T09:00:00+09:00"},
            {"start_datetime": "2026-09-01T09:00:00+09:00"},
        ]
        assert earliest_start_date_by_order(rows) == {3: date(2026, 9, 10)}

    def test_empty(self):
        assert earliest_start_date_by_order([]) == {}


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
        candidates: list[dict[str, Any]] = [
            {"id": 3, "status": "confirmed", "scheduling_start_date": None},
        ]
        earliest = {3: date(2026, 9, 8)}
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
