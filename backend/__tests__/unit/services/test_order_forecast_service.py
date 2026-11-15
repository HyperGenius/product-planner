from datetime import date

import pytest
from app.services.order_forecast_service import (
    forecast_period,
    forecast_quantity,
    is_forecast_line,
    parse_forecast_month,
)


@pytest.mark.unit
class TestIsForecastLine:
    @pytest.mark.parametrize(
        ("certainty", "expected"),
        [
            ("forecast", True),
            ("forecast_tentative", True),
            ("confirmed", False),
            (None, False),
            ("unknown", False),
        ],
    )
    def test_only_forecast_certainties(self, certainty, expected):
        assert is_forecast_line({"certainty": certainty}) is expected


@pytest.mark.unit
class TestParseForecastMonth:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("2026-11", date(2026, 11, 1)),
            ("2027-1", date(2027, 1, 1)),
            ("2026-12-15", date(2026, 12, 1)),
            (" 2026-11 ", date(2026, 11, 1)),
        ],
    )
    def test_reads_month(self, value, expected):
        assert parse_forecast_month(value) == expected

    @pytest.mark.parametrize(
        "value", [None, "", "11月", "2026-13", "2026-00", "2026-02-30", 202611]
    )
    def test_unreadable_is_none(self, value):
        assert parse_forecast_month(value) is None


@pytest.mark.unit
class TestForecastPeriod:
    def test_start_and_end(self):
        line = {"forecast_period_start": "2027-01", "forecast_period_end": "2027-03"}

        assert forecast_period(line) == (date(2027, 1, 1), date(2027, 3, 1))

    def test_one_side_only_is_single_month(self):
        assert forecast_period({"forecast_period_start": "2026-11"}) == (
            date(2026, 11, 1),
            date(2026, 11, 1),
        )
        assert forecast_period({"forecast_period_end": "2026-12"}) == (
            date(2026, 12, 1),
            date(2026, 12, 1),
        )

    def test_falls_back_to_delivery_month(self):
        line = {
            "forecast_period_start": None,
            "forecast_period_end": None,
            "delivery_date": "2026-11-30",
        }

        assert forecast_period(line) == (date(2026, 11, 1), date(2026, 11, 1))

    def test_period_takes_precedence_over_delivery_date(self):
        line = {
            "forecast_period_start": "2026-12",
            "forecast_period_end": "2026-12",
            "delivery_date": "2026-11-30",
        }

        assert forecast_period(line) == (date(2026, 12, 1), date(2026, 12, 1))

    def test_reversed_period_is_unknown(self):
        line = {"forecast_period_start": "2027-03", "forecast_period_end": "2027-01"}

        assert forecast_period(line) == (None, None)

    def test_nothing_readable_is_unknown(self):
        assert forecast_period({}) == (None, None)


@pytest.mark.unit
class TestForecastQuantity:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (36000, 36000),
            (0, 0),
            (-1, None),
            ("36,000", None),
            (None, None),
            (True, None),
        ],
    )
    def test_quantity(self, value, expected):
        assert forecast_quantity(value) == expected
