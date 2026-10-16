"""類似製品の検索の純粋関数・DB 読み込みのテスト (Issue #516)。"""

from unittest.mock import MagicMock

import pytest
from app.services.product_similarity_service import (
    find_similar_products,
    select_similar_products,
)
from app.services.product_spec_parser import parse_product_spec


def _product(pid: int, name: str, is_active: bool = True) -> dict:
    return {"id": pid, "name": name, "code": f"C{pid}", "is_active": is_active}


PRODUCTS = [
    _product(1, "φ10.0×20L SUS100"),
    _product(2, "10φ×20L (SUS100)"),
    _product(3, "φ10x20 sus100", is_active=False),
    _product(4, "φ10.0×25L SUS100"),
    _product(5, "φ12×20L SUS100"),
    _product(6, "φ10×20L SUS304"),
    _product(7, "ABC φ10×20L SUS100"),
    _product(8, "製品A"),
]


def _ids(name: str, exclude_id: int | None = None) -> list[int]:
    target = parse_product_spec(name)
    assert target is not None
    return [p["id"] for p, _ in select_similar_products(target, PRODUCTS, exclude_id)]


@pytest.mark.unit
class TestSelectSimilarProducts:
    def test_detects_notation_variants(self):
        # φの位置・×の字形・L の有無・全角半角・空白・括弧が違っても同じ仕様とみなす
        assert _ids("φ１０．０ × ２０Ｌ ＳＵＳ１００") == [1, 2, 3, 7]

    def test_includes_inactive_products(self):
        assert 3 in _ids("φ10×20L SUS100")

    def test_excludes_the_product_being_edited(self):
        assert _ids("φ10×20L SUS100", exclude_id=1) == [2, 3, 7]

    def test_excludes_when_size_or_material_differs(self):
        ids = _ids("φ10×20L SUS100")
        assert not {4, 5, 6} & set(ids)

    def test_includes_products_with_different_prefix(self):
        assert 7 in _ids("φ10×20L SUS100")

    def test_excludes_unparseable_products(self):
        assert 8 not in _ids("φ10×20L SUS100")


@pytest.mark.unit
class TestFindSimilarProducts:
    def _db(self, products, routings):
        db = MagicMock()
        tables = {"products": products, "process_routings": routings}

        def table(name):
            query = MagicMock()
            for method in ("select", "eq", "in_", "order", "range"):
                getattr(query, method).return_value = query
            query.execute.return_value = MagicMock(data=tables[name])
            return query

        db.table.side_effect = table
        return db

    def test_unparseable_name_returns_empty_without_db(self):
        db = MagicMock()
        assert find_similar_products(db, "t", "製品A").products == []
        db.table.assert_not_called()

    def test_flags_prefix_difference_and_routing_status(self):
        db = self._db(
            [_product(1, "φ10×20L SUS100"), _product(7, "ABC φ10×20L SUS100")],
            [
                {"id": 1, "product_id": 1, "is_confirmed": True},
                {"id": 2, "product_id": 1, "is_confirmed": False},
            ],
        )

        res = find_similar_products(db, "t", "φ10×20L SUS100")

        by_id = {p.id: p for p in res.products}
        assert by_id[1].prefix_differs is False
        assert by_id[1].has_process is True
        assert by_id[1].has_unconfirmed_process is True
        assert by_id[7].prefix == "ABC"
        assert by_id[7].prefix_differs is True
        assert by_id[7].has_process is False
        assert by_id[7].has_unconfirmed_process is False

    def test_no_match_skips_routing_query(self):
        db = self._db([_product(1, "φ12×20L SUS100")], [])

        assert find_similar_products(db, "t", "φ10×20L SUS100").products == []
        assert [c.args[0] for c in db.table.call_args_list] == ["products"]
