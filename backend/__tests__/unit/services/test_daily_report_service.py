# __tests__/unit/services/test_daily_report_service.py
from datetime import UTC, datetime

import pytest
from app.services.daily_report_service import (
    InvalidDailyReportHeaderError,
    build_storage_path,
    decode_file_path,
    normalize_sha256,
    parse_file_modified_at,
)
from app.utils.calendar import JST


class TestNormalizeSha256:
    def test_lowercases_and_strips(self):
        value = "AB" * 32
        assert normalize_sha256(f" {value} ") == "ab" * 32

    @pytest.mark.parametrize("raw", ["", "abc", "z" * 64, "a" * 63, "a" * 65])
    def test_rejects_invalid_values(self, raw):
        with pytest.raises(InvalidDailyReportHeaderError):
            normalize_sha256(raw)


class TestDecodeFilePath:
    def test_restores_japanese_unc_path(self):
        # [System.Uri]::EscapeDataString("\\srv\共有\日報.xlsx") 相当
        raw = "%5C%5Csrv%5C%E5%85%B1%E6%9C%89%5C%E6%97%A5%E5%A0%B1.xlsx"
        assert decode_file_path(raw) == (r"\\srv\共有\日報.xlsx", "日報.xlsx")

    def test_forward_slash_path(self):
        assert decode_file_path("C%3A/reports/a%20b.xlsx") == (
            "C:/reports/a b.xlsx",
            "a b.xlsx",
        )

    def test_plus_is_not_treated_as_space(self):
        # EscapeDataString は空白を %20 にするので、+ はそのまま残す
        assert decode_file_path("a+b.xlsx") == ("a+b.xlsx", "a+b.xlsx")

    @pytest.mark.parametrize("raw", ["", "%FF%FE.xlsx", "%5C%5Csrv%5Cdir%5C"])
    def test_rejects_invalid_values(self, raw):
        with pytest.raises(InvalidDailyReportHeaderError):
            decode_file_path(raw)


class TestParseFileModifiedAt:
    def test_powershell_round_trip_format(self):
        # PowerShell の ToString("o")（小数7桁・オフセット付き）
        parsed = parse_file_modified_at("2026-09-29T17:05:12.1234567+09:00")
        assert parsed == datetime(2026, 9, 29, 17, 5, 12, 123456, tzinfo=JST)

    def test_utc_z_suffix(self):
        parsed = parse_file_modified_at("2026-09-29T08:05:12Z")
        assert parsed == datetime(2026, 9, 29, 8, 5, 12, tzinfo=UTC)

    def test_naive_value_is_treated_as_jst(self):
        parsed = parse_file_modified_at("2026-09-29T17:05:12")
        assert parsed is not None
        assert parsed.utcoffset() == JST.utcoffset(datetime(2026, 9, 29))

    @pytest.mark.parametrize("raw", [None, "", "  ", "2026/09/29 17:05", "yesterday"])
    def test_missing_or_unparsable_returns_none(self, raw):
        assert parse_file_modified_at(raw) is None


def test_build_storage_path_is_ascii_safe():
    path = build_storage_path("11111111-1111-1111-1111-111111111111", "a" * 64)
    assert path == f"11111111-1111-1111-1111-111111111111/{'a' * 64}"
    assert path.isascii()
