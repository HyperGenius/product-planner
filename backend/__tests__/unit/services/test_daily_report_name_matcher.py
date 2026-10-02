"""日報の名寄せ（純粋関数）のテスト (Issue #488)。

実データ（顧客名・製品コード・設備名）は使わず、表記のパターンだけをダミー値で再現する。
"""

import pytest
from app.services.daily_report_name_matcher import (
    CustomerRef,
    DailyReportNameMatcher,
    EntryMatch,
    EquipmentRef,
    NameMatch,
    NameMatchingSnapshot,
    ProductRef,
    extract_equipment_ledger_no,
    normalize_name_key,
    normalize_product_name,
)


@pytest.mark.unit
class TestNormalizeProductName:
    @pytest.mark.parametrize(
        ("left", "right"),
        [
            # 全角半角・英字の大小
            ("ＡＢ－１２", "ab-12"),
            # 空白（半角・全角・前後）
            ("AB 12　X", " ab12x "),
            # 径の記号の有無（φ / Φ / ϕ / ø / ⌀）
            ("φ6 ピン", "6ピン"),
            ("Φ6ピン", "6ピン"),
            ("ϕ6ピン", "⌀6ピン"),
            ("Ø6ピン", "6ピン"),
            # 掛け算の記号（x / X / × / * / ＊ / ✕）
            ("6×20", "6x20"),
            ("6X20", "6*20"),
            ("6＊20", "6✕20"),
            # 区切りの記号（+ / , / . と全角）
            ("A+B", "A,B"),
            ("A．B", "A＋B"),
            ("A，B", "A.B"),
            # ハイフンの字形
            ("AB−12", "AB-12"),
            ("AB–12", "AB‐12"),
        ],
    )
    def test_equivalent_notations(self, left, right):
        assert normalize_product_name(left) == normalize_product_name(right)

    @pytest.mark.parametrize(
        ("left", "right"),
        [
            ("AB-12", "AB-13"),
            ("6x20", "6x2"),
            # 長音記号はハイフンに寄せない
            ("フィルタ-", "フィルター"),
            # 区切りは消さずに寄せるので、区切りの有無は区別する
            ("A+B", "AB"),
        ],
    )
    def test_different_notations(self, left, right):
        assert normalize_product_name(left) != normalize_product_name(right)


@pytest.mark.unit
class TestNormalizeNameKey:
    def test_ignores_width_whitespace_and_case(self):
        assert normalize_name_key(" Ａ工程　加工 ") == normalize_name_key("a工程加工")


@pytest.mark.unit
class TestExtractEquipmentLedgerNo:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("200t 3号機", 3),
            ("200t3号機", 3),
            ("80t １２号機", 12),
            ("溶接機 7号機", 7),
            ("溶接機　07号機", 7),
            # 番号の無い表記
            ("自動組立機", None),
            ("3号", None),
            # 番号が決められない
            ("1号機・2号機", None),
            ("0号機", None),
        ],
    )
    def test_extract(self, raw, expected):
        assert extract_equipment_ledger_no(raw) == expected

    def test_same_number_twice_is_ok(self):
        assert extract_equipment_ledger_no("3号機（3号機）") == 3


def _matcher(**kwargs) -> DailyReportNameMatcher:
    return DailyReportNameMatcher(NameMatchingSnapshot(**kwargs))


@pytest.mark.unit
class TestMatchEquipment:
    EQUIPMENTS = [
        EquipmentRef(
            id=1, name="200tプレス（メーカーA）", short_name="200t 3号機", ledger_no=3
        ),
        EquipmentRef(id=2, name="溶接機（メーカーB）", ledger_no=7),
        EquipmentRef(id=3, name="自動組立機", short_name="組立"),
        EquipmentRef(id=4, name="汎用設備グループ"),
    ]

    def test_ledger_no(self):
        matcher = _matcher(equipments=self.EQUIPMENTS)
        assert matcher.match_equipment("80t 3号機") == NameMatch(1, "ledger_no")
        assert matcher.match_equipment("溶接機 7号機") == NameMatch(2, "ledger_no")

    def test_unknown_ledger_no_does_not_fall_back_to_name(self):
        matcher = _matcher(equipments=self.EQUIPMENTS)
        assert matcher.match_equipment("200t 99号機") is None

    def test_name_or_short_name_without_number(self):
        matcher = _matcher(equipments=self.EQUIPMENTS)
        assert matcher.match_equipment("自動組立機") == NameMatch(3, "exact")
        assert matcher.match_equipment("組 立") == NameMatch(3, "exact")
        assert matcher.match_equipment("フィルター組立機") is None

    def test_same_name_equipments(self):
        """同名の設備（Issue #501）は設備名では照合せず、台帳番号・呼称で照合する"""
        matcher = _matcher(
            equipments=[
                EquipmentRef(id=1, name="15Tプレス", short_name="A15t(1)", ledger_no=1),
                EquipmentRef(id=2, name="15Tプレス", short_name="A15t(2)", ledger_no=2),
            ]
        )
        assert matcher.match_equipment("15Tプレス") is None
        assert matcher.match_equipment("15t 2号機") == NameMatch(2, "ledger_no")
        assert matcher.match_equipment("A15t(1)") == NameMatch(1, "exact")

    def test_alias_takes_precedence_over_ledger_no(self):
        matcher = _matcher(
            equipments=self.EQUIPMENTS,
            equipment_aliases={"200t 3号機": 2, "フィルター組立機": 3},
        )
        assert matcher.match_equipment(" 200t 3号機 ") == NameMatch(2, "alias")
        assert matcher.match_equipment("フィルター組立機") == NameMatch(3, "alias")

    def test_blank(self):
        matcher = _matcher(equipments=self.EQUIPMENTS)
        assert matcher.match_equipment(None) is None
        assert matcher.match_equipment("  ") is None


@pytest.mark.unit
class TestMatchProcess:
    def test_exact_master_name(self):
        matcher = _matcher(process_names=["カシメ", "クグシ"])
        assert matcher.match_process("カシメ") == NameMatch(["カシメ"], "exact")
        assert matcher.match_process("カシメ加工") is None

    def test_alias_one_to_many(self):
        matcher = _matcher(
            process_names=["カシメ", "クグシ"],
            process_aliases={
                "カシメ加工": ["カシメ"],
                "カシメ、仕上げ加工": ["カシメ", "クグシ"],
            },
        )
        assert matcher.match_process("カシメ加工") == NameMatch(["カシメ"], "alias")
        assert matcher.match_process("カシメ、仕上げ加工") == NameMatch(
            ["カシメ", "クグシ"], "alias"
        )

    def test_alias_result_is_a_copy(self):
        aliases = {"仕上げ": ["クグシ"]}
        matcher = _matcher(process_names=["クグシ"], process_aliases=aliases)
        result = matcher.match_process("仕上げ")
        assert result is not None
        result.target.append("カシメ")
        assert aliases["仕上げ"] == ["クグシ"]

    def test_ambiguous_master_names(self):
        matcher = _matcher(process_names=["ﾌﾟﾚｽ", "プレス"])
        assert matcher.match_process("プレス") is None


@pytest.mark.unit
class TestMatchCustomer:
    CUSTOMERS = [
        CustomerRef(
            id=10, name="株式会社サンプル工業", alias="サンプル", status="active"
        ),
        CustomerRef(id=11, name="テスト製作所", status="active"),
    ]

    def test_normalized_name_and_alias(self):
        matcher = _matcher(customers=self.CUSTOMERS)
        assert matcher.match_customer("サンプル工業") == NameMatch(10, "exact")
        assert matcher.match_customer("(株)サンプル工業") == NameMatch(10, "exact")
        assert matcher.match_customer("サンプル") == NameMatch(10, "exact")
        assert matcher.match_customer("ﾃｽﾄ製作所") == NameMatch(11, "exact")

    def test_partial_match_is_not_used(self):
        matcher = _matcher(customers=self.CUSTOMERS)
        assert matcher.match_customer("テスト") is None

    def test_alias_dictionary(self):
        matcher = _matcher(customers=self.CUSTOMERS, customer_aliases={"SK": 10})
        assert matcher.match_customer("SK") == NameMatch(10, "alias")

    def test_prefers_non_draft_customer(self):
        matcher = _matcher(
            customers=[
                *self.CUSTOMERS,
                CustomerRef(id=12, name="テスト製作所", status="draft"),
            ]
        )
        assert matcher.match_customer("テスト製作所") == NameMatch(11, "exact")

    def test_ambiguous(self):
        matcher = _matcher(
            customers=[
                CustomerRef(id=1, name="テスト製作所", status="active"),
                CustomerRef(id=2, name="株式会社テスト製作所", status="active"),
            ]
        )
        assert matcher.match_customer("テスト製作所") is None


@pytest.mark.unit
class TestMatchProduct:
    PRODUCTS = [
        ProductRef(id=100, name="ピン φ6×20", code="PN-0620"),
        ProductRef(id=101, name="ピン φ6×25", code="PN-0625"),
        ProductRef(id=102, name="ブラケット", code="BR-01"),
    ]

    def test_exact_name_or_code(self):
        matcher = _matcher(products=self.PRODUCTS)
        assert matcher.match_product("ブラケット", None) == NameMatch(102, "exact")
        assert matcher.match_product("PN-0625", None) == NameMatch(101, "exact")

    def test_normalized(self):
        matcher = _matcher(products=self.PRODUCTS)
        assert matcher.match_product("ﾋﾟﾝ 6x20", None) == NameMatch(100, "normalized")
        assert matcher.match_product("pn－0620", None) == NameMatch(100, "normalized")
        assert matcher.match_product("ピン 6x30", None) is None

    def test_alias_requires_customer(self):
        matcher = _matcher(
            products=self.PRODUCTS, product_aliases={(10, "短いピン"): 100}
        )
        assert matcher.match_product("短いピン", 10) == NameMatch(100, "alias")
        # 別の顧客・顧客不明では別名を使わない（他の顧客の別名にフォールバックしない）
        assert matcher.match_product("短いピン", 11) is None
        assert matcher.match_product("短いピン", None) is None

    def test_alias_takes_precedence_over_normalized(self):
        matcher = _matcher(
            products=self.PRODUCTS, product_aliases={(10, "ピン6x20"): 101}
        )
        assert matcher.match_product("ピン6x20", 10) == NameMatch(101, "alias")
        assert matcher.match_product("ピン6x20", 11) == NameMatch(100, "normalized")

    def test_ambiguous_normalized_products(self):
        matcher = _matcher(
            products=[
                ProductRef(id=1, name="ピン φ6×20"),
                ProductRef(id=2, name="ピン 6x20"),
            ]
        )
        assert matcher.match_product("ピン6*20", None) is None

    def test_prefers_active_product(self):
        matcher = _matcher(
            products=[
                ProductRef(id=1, name="ピン φ6×20", is_active=False),
                ProductRef(id=2, name="ピン 6x20"),
            ]
        )
        assert matcher.match_product("ピン6*20", None) == NameMatch(2, "normalized")

    def test_symbols_only_raw_does_not_match(self):
        # 正規化すると空になる表記は、正規化後の一致では照合しない
        matcher = _matcher(products=[ProductRef(id=1, name="φ")])
        assert matcher.match_product("φ", None) == NameMatch(1, "exact")
        assert matcher.match_product("Φ", None) is None


@pytest.mark.unit
class TestMatchEntry:
    def _matcher(self) -> DailyReportNameMatcher:
        return _matcher(
            equipments=[EquipmentRef(id=1, name="200tプレス", ledger_no=3)],
            customers=[CustomerRef(id=10, name="株式会社サンプル工業")],
            products=[ProductRef(id=100, name="ピン φ6×20")],
            process_names=["カシメ", "クグシ"],
            process_aliases={"カシメ、仕上げ加工": ["カシメ", "クグシ"]},
            product_aliases={(10, "短いピン"): 100},
        )

    def test_matched_entry(self):
        entry = {
            "equipment_raw": "200t 3号機",
            "customer_raw": "サンプル工業",
            "product_raw": "短いピン",
            "process_raw": "カシメ、仕上げ加工",
        }
        assert self._matcher().match_entry(entry) == EntryMatch(
            equipment_id=1,
            customer_id=10,
            product_id=100,
            process_names=["カシメ", "クグシ"],
        )

    def test_unmatched_customer_falls_back_to_normalized_product(self):
        entry = {
            "equipment_raw": None,
            "customer_raw": "未登録の顧客",
            "product_raw": "ピン6x20",
            "process_raw": "検査",
        }
        assert self._matcher().match_entry(entry) == EntryMatch(
            equipment_id=None, customer_id=None, product_id=100, process_names=None
        )

    def test_is_matched(self):
        matcher = self._matcher()
        assert matcher.is_matched("equipment", "80t 3号機")
        assert not matcher.is_matched("equipment", "80t 4号機")
        assert matcher.is_matched("process", "カシメ")
        assert not matcher.is_matched("process", "検査")
        assert matcher.is_matched("customer", "サンプル工業")
        assert matcher.is_matched("product", "短いピン", "サンプル工業")
        assert not matcher.is_matched("product", "短いピン", "未登録の顧客")
        assert not matcher.is_matched("product", "短いピン", None)
