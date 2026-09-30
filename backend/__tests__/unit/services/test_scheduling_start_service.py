"""scheduling_start_service のユニットテスト（Issue #372）。"""

from datetime import UTC, date, datetime

import app.services.scheduling_start_service as scheduling_start_module
import pytest
from app.services.scheduling_start_service import (
    PastSchedulingStartDateError,
    default_scheduling_start_date,
    is_backdated,
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

    def test_iso_datetime_string_is_reduced_to_date(self):
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

    def test_trailing_junk_is_rejected(self):
        # 先頭10文字だけ切り出すパースはしない（入力ミスを見逃さない）
        with pytest.raises(ValueError):
            parse_scheduling_start_date("2026-09-10xxx")

    def test_non_string_non_date_is_rejected(self):
        with pytest.raises(ValueError):
            parse_scheduling_start_date(20260910)  # type: ignore[arg-type]


class TestToSchedulingStartTime:
    def test_none_returns_none(self):
        assert to_scheduling_start_time(None) is None

    def test_returns_jst_work_start(self):
        dt = to_scheduling_start_time("2026-09-10")
        assert dt == datetime(2026, 9, 10, WORK_START_HOUR, 0, tzinfo=JST)
        assert dt.tzinfo is not None


class TestIsBackdated:
    _TODAY = date(2026, 9, 3)

    def test_none_is_not_backdated(self):
        assert is_backdated(None, today=self._TODAY) is False

    def test_today_is_not_backdated(self):
        assert is_backdated("2026-09-03", today=self._TODAY) is False

    def test_future_is_not_backdated(self):
        assert is_backdated("2026-09-04", today=self._TODAY) is False

    def test_past_is_backdated(self):
        assert is_backdated("2026-09-02", today=self._TODAY) is True

    def test_invalid_string_raises(self):
        with pytest.raises(ValueError):
            is_backdated("not-a-date", today=self._TODAY)


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


class TestDefaultSchedulingStartDate:
    """作業開始日の既定値＝本日 JST の翌日（Issue #477）。"""

    def test_returns_next_calendar_day(self):
        assert default_scheduling_start_date(today=date(2026, 9, 29)) == date(
            2026, 9, 30
        )

    def test_does_not_skip_weekend_or_month_end(self):
        # 2026-10-03 は土曜。稼働日への繰り上げはスケジューラに任せ、暦日の翌日を返す
        assert default_scheduling_start_date(today=date(2026, 10, 2)) == date(
            2026, 10, 3
        )
        assert default_scheduling_start_date(today=date(2026, 12, 31)) == date(
            2027, 1, 1
        )

    def test_uses_jst_today_across_utc_date_boundary(self, monkeypatch):
        """UTC では前日の深夜（JST 0〜9時）でも、JST の暦日を基準に翌日を返す。"""
        # 2026-09-29T16:30Z == 2026-09-30T01:30+09:00
        fixed_utc = datetime(2026, 9, 29, 16, 30, tzinfo=UTC)

        class _FixedDatetime(datetime):
            @classmethod
            def now(cls, tz=None):
                return fixed_utc.astimezone(tz) if tz else fixed_utc

        monkeypatch.setattr(scheduling_start_module, "datetime", _FixedDatetime)

        assert default_scheduling_start_date() == date(2026, 10, 1)
