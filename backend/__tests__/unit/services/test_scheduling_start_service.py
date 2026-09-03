"""scheduling_start_service のユニットテスト（Issue #372）。"""

from datetime import date, datetime

import pytest
from app.services.scheduling_start_service import (
    PastSchedulingStartDateError,
    parse_scheduling_start_date,
    to_scheduling_start_time,
    validate_scheduling_start_date,
)
from app.utils.calendar import JST, WORK_START_HOUR


class TestParseSchedulingStartDate:
    def test_none_returns_none(self):
        assert parse_scheduling_start_date(None) is None

    def test_iso_date_string(self):
        assert parse_scheduling_start_date("2026-09-10") == date(2026, 9, 10)

    def test_iso_datetime_string_is_truncated_to_date(self):
        assert parse_scheduling_start_date("2026-09-10T09:00:00+09:00") == date(
            2026, 9, 10
        )

    def test_date_passthrough(self):
        d = date(2026, 9, 10)
        assert parse_scheduling_start_date(d) == d

    def test_datetime_reduced_to_date(self):
        assert parse_scheduling_start_date(datetime(2026, 9, 10, 15, 30)) == date(
            2026, 9, 10
        )

    def test_invalid_string_raises(self):
        with pytest.raises(ValueError):
            parse_scheduling_start_date("not-a-date")


class TestToSchedulingStartTime:
    def test_none_returns_none(self):
        assert to_scheduling_start_time(None) is None

    def test_returns_jst_work_start(self):
        dt = to_scheduling_start_time("2026-09-10")
        assert dt == datetime(2026, 9, 10, WORK_START_HOUR, 0, tzinfo=JST)
        assert dt.tzinfo is not None


class TestValidateSchedulingStartDate:
    _TODAY = date(2026, 9, 3)

    def test_none_is_allowed_for_any_role(self):
        assert (
            validate_scheduling_start_date(None, "order_handler", today=self._TODAY)
            is None
        )

    def test_today_is_allowed_for_non_privileged(self):
        assert validate_scheduling_start_date(
            "2026-09-03", "order_handler", today=self._TODAY
        ) == date(2026, 9, 3)

    def test_future_is_allowed_for_non_privileged(self):
        assert validate_scheduling_start_date(
            "2026-09-30", "iso_officer", today=self._TODAY
        ) == date(2026, 9, 30)

    def test_past_rejected_for_non_privileged(self):
        with pytest.raises(PastSchedulingStartDateError):
            validate_scheduling_start_date(
                "2026-09-01", "order_handler", today=self._TODAY
            )

    def test_past_rejected_for_iso_officer(self):
        with pytest.raises(PastSchedulingStartDateError):
            validate_scheduling_start_date(
                "2026-09-01", "iso_officer", today=self._TODAY
            )

    @pytest.mark.parametrize("role", ["president", "platform_admin"])
    def test_past_allowed_for_privileged_roles(self, role):
        assert validate_scheduling_start_date(
            "2026-08-20", role, today=self._TODAY
        ) == date(2026, 8, 20)

    def test_past_rejected_when_role_is_none(self):
        with pytest.raises(PastSchedulingStartDateError):
            validate_scheduling_start_date("2026-09-01", None, today=self._TODAY)
