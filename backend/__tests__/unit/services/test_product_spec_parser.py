"""品名から (接頭辞, 直径, 長さ, 材質) を読み取る純粋関数のテスト (Issue #515)。

実データは使わず、表記ゆれのパターンだけをダミー値で再現する。
"""

from decimal import Decimal

import pytest
from app.services.product_spec_parser import (
    format_decimal,
    normalize_material,
    parse_product_spec,
)


@pytest.mark.unit
class TestParseProductSpec:
    @pytest.mark.parametrize(
        "name",
        [
            "φ10.0×20L SUS100",
            # φ の位置（数字の後）
            "10.0φ×20L SUS100",
            # × の字形
            "φ10.0x20L SUS100",
            "φ10.0X20L SUS100",
            "φ10.0Ｘ20L SUS100",
            # L の位置・有無
            "φ10.0×L20 SUS100",
            "φ10.0×20 SUS100",
            # 全角半角・空白
            "Φ１０．０　×　２０Ｌ　ＳＵＳ１００",
            "φ 10.0 × 20 L SUS100",
            "φ10.0×20LSUS100",
            # 材質の括弧・ハイフン・大小
            "φ10.0×20L (SUS100)",
            "φ10.0×20L（sus-100）",
            # 直径・長さの小数の桁
            "φ10×20.0L SUS100",
        ],
    )
    def test_absorbs_notation_variants(self, name):
        spec = parse_product_spec(name)

        assert spec is not None
        assert spec.prefix == ""
        assert spec.diameter == Decimal("10")
        assert spec.length == Decimal("20")
        assert spec.material_key == "SUS100"

    def test_keeps_numeric_precision_for_comparison(self):
        spec = parse_product_spec("φ14.50×30L SUS100")

        assert spec is not None
        assert spec.diameter == Decimal("14.5")
        assert format_decimal(spec.diameter) == "14.5"

    @pytest.mark.parametrize(
        ("name", "prefix"),
        [
            ("A社φ10.0×20L SUS100", "A社"),
            ("A社 10.0φ×20L SUS100", "A社"),
            ("ＡＢ工業　φ10×20L SUS100", "AB工業"),
        ],
    )
    def test_reads_company_prefix(self, name, prefix):
        spec = parse_product_spec(name)

        assert spec is not None
        assert spec.prefix == prefix
        assert spec.diameter == Decimal("10")
        assert spec.material_key == "SUS100"

    def test_prefix_key_ignores_whitespace_and_case(self):
        left = parse_product_spec("ab 工業φ10×20L SUS100")
        right = parse_product_spec("AB工業 φ10×20L SUS100")

        assert left is not None and right is not None
        assert left.prefix_key == right.prefix_key

    def test_number_before_phi_is_not_part_of_prefix(self):
        spec = parse_product_spec("A1 12.5φ×20L SUS100")

        assert spec is not None
        assert spec.prefix == "A1"
        assert spec.diameter == Decimal("12.5")

    def test_without_material(self):
        spec = parse_product_spec("φ10×20L")

        assert spec is not None
        assert spec.material == ""
        assert spec.material_key == ""

    @pytest.mark.parametrize(
        "name",
        ["フィルター", "10×20 SUS100", "φ10 SUS100", "", "ピン 6x20"],
    )
    def test_returns_none_without_diameter_and_length(self, name):
        assert parse_product_spec(name) is None

    def test_same_size_and_material(self):
        base = parse_product_spec("φ10.0×20L SUS100")
        same = parse_product_spec("A社 10φ×L20.00 (sus100)")
        other = parse_product_spec("φ10.0×25L SUS100")

        assert base is not None and same is not None and other is not None
        assert base.same_size_and_material(same)
        assert not base.same_size_and_material(other)


@pytest.mark.unit
class TestNormalizeMaterial:
    @pytest.mark.parametrize(
        "text",
        [
            "SUS100",
            "sus100",
            "ＳＵＳ１００",
            " SUS 100 ",
            "SUS-100",
            "(SUS100)",
            "【SUS100】",
        ],
    )
    def test_ignores_width_case_space_hyphen_brackets(self, text):
        assert normalize_material(text) == "SUS100"


@pytest.mark.unit
class TestFormatDecimal:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [("10", "10"), ("10.0", "10"), ("14.50", "14.5"), ("100", "100")],
    )
    def test_formats_without_exponent(self, value, expected):
        assert format_decimal(Decimal(value)) == expected
