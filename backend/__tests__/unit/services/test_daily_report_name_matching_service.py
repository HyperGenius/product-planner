"""日報の名寄せの DB 入出力のテスト (Issue #488)。"""

from typing import Any
from unittest.mock import MagicMock

import pytest
from app.services import daily_report_name_matching_service as service
from app.services.daily_report_name_matcher import EquipmentRef, ProductRef

TENANT = "tenant-1"


class _FakeQuery:
    """select/rpc のクエリチェーンを受け、`.range()` の範囲の行を返す。"""

    def __init__(self, rows: list[dict[str, Any]], calls: list[tuple]):
        self._rows = rows
        self._calls = calls
        self._range: tuple[int, int] | None = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, column, value):
        self._calls.append(("eq", column, value))
        return self

    def order(self, *_args, **_kwargs):
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def execute(self):
        assert self._range is not None, "fetch_all_rows は必ず range() でページングする"
        start, end = self._range
        return MagicMock(data=self._rows[start : end + 1])


def _fake_db(tables: dict[str, list[dict[str, Any]]], stats: list[dict[str, Any]]):
    calls: list[tuple] = []
    db = MagicMock()
    db.table.side_effect = lambda name: _FakeQuery(tables.get(name, []), calls)

    def rpc(name, params):
        assert name == "daily_report_name_stats"
        calls.append(("rpc", name, params))
        return _FakeQuery(stats, calls)

    db.rpc.side_effect = rpc
    db._calls = calls
    return db


def _stat(kind, raw, count, last, customer_raw=None):
    return {
        "kind": kind,
        "raw_text": raw,
        "customer_raw": customer_raw,
        "entry_count": count,
        "last_work_date": last,
    }


MASTERS: dict[str, list[dict[str, Any]]] = {
    "equipments": [
        {"id": 1, "name": "200tプレス", "short_name": None, "ledger_no": 3},
        {"id": 2, "name": "自動組立機", "short_name": "組立", "ledger_no": None},
    ],
    "customers": [
        {"id": 10, "name": "株式会社サンプル工業", "alias": None, "status": "active"}
    ],
    "products": [
        {"id": 100, "name": "ピン φ6×20", "code": "PN-0620", "is_active": True},
        {"id": 101, "name": "ブラケット", "code": None, "is_active": False},
    ],
    "process_routings": [
        {"id": 1, "process_name": "カシメ"},
        {"id": 2, "process_name": "カシメ"},
        {"id": 3, "process_name": " クグシ "},
        {"id": 4, "process_name": None},
    ],
    "equipment_name_aliases": [{"id": "a", "raw_text": "組立機A", "equipment_id": 2}],
    "process_name_aliases": [
        {
            "id": "b",
            "raw_text": "カシメ、仕上げ加工",
            "process_names": ["カシメ", "クグシ"],
        }
    ],
    "customer_name_aliases": [{"id": "c", "raw_text": "SK", "customer_id": 10}],
    "product_name_aliases": [
        {"id": "d", "customer_id": 10, "raw_text": "短いピン", "product_id": 100}
    ],
}


@pytest.mark.unit
class TestFetchAllRows:
    def test_reads_all_pages(self, monkeypatch):
        monkeypatch.setattr(service, "_PAGE_SIZE", 2)
        rows = [{"id": i} for i in range(5)]
        calls: list[tuple] = []

        assert service.fetch_all_rows(lambda: _FakeQuery(rows, calls)) == rows

    def test_exact_multiple_of_page_size(self, monkeypatch):
        monkeypatch.setattr(service, "_PAGE_SIZE", 2)
        rows = [{"id": i} for i in range(4)]

        assert service.fetch_all_rows(lambda: _FakeQuery(rows, [])) == rows


@pytest.mark.unit
class TestLoadSnapshot:
    def test_builds_snapshot_scoped_to_tenant(self):
        db = _fake_db(MASTERS, [])

        snapshot = service.load_snapshot(db, TENANT)

        assert snapshot.equipments[0] == EquipmentRef(
            id=1, name="200tプレス", short_name=None, ledger_no=3
        )
        assert snapshot.products[1] == ProductRef(
            id=101, name="ブラケット", code=None, is_active=False
        )
        assert snapshot.process_names == ["カシメ", "クグシ"]
        assert snapshot.equipment_aliases == {"組立機A": 2}
        assert snapshot.process_aliases == {"カシメ、仕上げ加工": ["カシメ", "クグシ"]}
        assert snapshot.customer_aliases == {"SK": 10}
        assert snapshot.product_aliases == {(10, "短いピン"): 100}
        # service role から呼ばれても他テナントの行を読まないよう、全クエリをテナントで絞る
        tenant_filters = [c for c in db._calls if c[0] == "eq"]
        assert len(tenant_filters) == 8
        assert all(c[1:] == ("tenant_id", TENANT) for c in tenant_filters)


@pytest.mark.unit
class TestListUnmatchedNames:
    STATS = [
        _stat("customer", "SK", 5, "2026-09-10"),
        _stat("customer", "未登録の顧客", 2, "2026-09-03"),
        _stat("equipment", "200t 3号機", 30, "2026-09-30"),
        _stat("equipment", "200t 9号機", 4, "2026-09-12"),
        _stat("equipment", "組立機B", 4, "2026-09-20"),
        _stat("process", "カシメ", 20, "2026-09-30"),
        _stat("process", "カシメ、仕上げ加工", 3, "2026-09-05"),
        _stat("process", "検査", 7, None),
        _stat("product", "短いピン", 6, "2026-09-11", customer_raw="SK"),
        _stat("product", "短いピン", 3, "2026-09-09", customer_raw="未登録の顧客"),
        _stat("product", "ピン6x20", 9, "2026-09-29", customer_raw=None),
        _stat("product", "ブラケット", 1, "2026-09-01", customer_raw="SK"),
    ]

    def test_returns_only_unmatched_sorted_by_count(self):
        db = _fake_db(MASTERS, self.STATS)

        result = service.list_unmatched_names(db, TENANT)

        assert result == [
            {
                "kind": "process",
                "raw_text": "検査",
                "customer_raw": None,
                "customer_id": None,
                "entry_count": 7,
                "last_work_date": None,
            },
            {
                "kind": "equipment",
                "raw_text": "組立機B",
                "customer_raw": None,
                "customer_id": None,
                "entry_count": 4,
                "last_work_date": "2026-09-20",
            },
            {
                "kind": "equipment",
                "raw_text": "200t 9号機",
                "customer_raw": None,
                "customer_id": None,
                "entry_count": 4,
                "last_work_date": "2026-09-12",
            },
            {
                "kind": "product",
                "raw_text": "短いピン",
                "customer_raw": "未登録の顧客",
                "customer_id": None,
                "entry_count": 3,
                "last_work_date": "2026-09-09",
            },
            {
                "kind": "customer",
                "raw_text": "未登録の顧客",
                "customer_raw": None,
                "customer_id": None,
                "entry_count": 2,
                "last_work_date": "2026-09-03",
            },
        ]
        assert ("rpc", "daily_report_name_stats", {"p_tenant_id": TENANT}) in db._calls

    def test_filters_by_kind(self):
        db = _fake_db(MASTERS, self.STATS)

        result = service.list_unmatched_names(db, TENANT, "product")

        assert [(i["raw_text"], i["customer_raw"]) for i in result] == [
            ("短いピン", "未登録の顧客")
        ]

    def test_product_item_carries_resolved_customer(self):
        stats = [_stat("product", "未登録の製品", 2, "2026-09-02", customer_raw="SK")]
        db = _fake_db(MASTERS, stats)

        [item] = service.list_unmatched_names(db, TENANT)

        assert item["customer_raw"] == "SK"
        assert item["customer_id"] == 10

    def test_alias_change_is_reflected_without_rewriting_entries(self):
        """照合結果を明細に保存しないので、辞書を足せば過去の明細の表記も照合済みになる。"""
        stats = [_stat("equipment", "組立機B", 4, "2026-09-20")]
        before = service.list_unmatched_names(_fake_db(MASTERS, stats), TENANT)

        masters = {
            **MASTERS,
            "equipment_name_aliases": [
                *MASTERS["equipment_name_aliases"],
                {"id": "e", "raw_text": "組立機B", "equipment_id": 2},
            ],
        }
        after = service.list_unmatched_names(_fake_db(masters, stats), TENANT)

        assert [i["raw_text"] for i in before] == ["組立機B"]
        assert after == []
