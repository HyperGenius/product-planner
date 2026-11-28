"""製品ごとの工程ルートと日報の工程の突き合わせの DB 入出力のテスト (Issue #708)。"""

from datetime import date
from typing import Any
from unittest.mock import MagicMock, patch

import app.repositories.supa_infra  # noqa: F401  既存の循環 import を避けるため先に読む
import pytest
from app.services import daily_report_product_process_service as service
from app.services.daily_report_name_matcher import (
    CustomerRef,
    NameMatchingSnapshot,
    ProductRef,
)

TENANT = "tenant-1"


def _query(rows: list[dict[str, Any]]) -> MagicMock:
    query = MagicMock()
    for method in ("select", "eq", "order", "range"):
        getattr(query, method).return_value = query
    query.execute.return_value = MagicMock(data=rows)
    return query


def _db(
    stats: list[dict[str, Any]], tables: dict[str, list[dict[str, Any]]]
) -> MagicMock:
    db = MagicMock()
    db.rpc.return_value = _query(stats)
    db.table.side_effect = lambda name: _query(tables.get(name, []))
    return db


SNAPSHOT = NameMatchingSnapshot(
    customers=[CustomerRef(id=1, name="顧客A")],
    products=[
        ProductRef(id=10, name="ピン", code="P-1"),
        ProductRef(id=11, name="ボルト"),
    ],
    process_names=["プレス", "検査"],
)

STATS = [
    {
        "customer_raw": "顧客A",
        "product_raw": "ピン",
        "process_raw": "プレス",
        "entry_count": 4,
        "last_work_date": "2026-11-20",
    },
    {
        "customer_raw": "顧客A",
        "product_raw": "ピン",
        "process_raw": "バレル",
        "entry_count": 2,
        "last_work_date": None,
    },
    {
        "customer_raw": "顧客A",
        "product_raw": "ボルト",
        "process_raw": "バレル",
        "entry_count": 1,
        "last_work_date": None,
    },
]

TABLES = {
    "process_routings": [
        {"id": 1, "product_id": 10, "sequence_order": 1, "process_name": "プレス"},
        {"id": 2, "product_id": 10, "sequence_order": 2, "process_name": "検査"},
    ],
    "untracked_process_names": [{"id": 1, "process_name": "検査"}],
}


@pytest.fixture(autouse=True)
def _snapshot():
    with (
        patch.object(service, "load_snapshot", return_value=SNAPSHOT),
        patch.object(service, "fetch_ignored_keys", return_value=set()),
    ):
        yield


@pytest.mark.unit
class TestProductProcessService:
    def test_passes_period_to_rpc(self):
        db = _db(STATS, TABLES)
        service.list_mismatched_product_processes(db, TENANT, date(2026, 9, 1))
        db.rpc.assert_called_once_with(
            "daily_report_product_process_stats",
            {"p_tenant_id": TENANT, "p_since": "2026-09-01"},
        )

    def test_omits_period_when_all(self):
        db = _db(STATS, TABLES)
        service.list_mismatched_product_processes(db, TENANT, None)
        db.rpc.assert_called_once_with(
            "daily_report_product_process_stats", {"p_tenant_id": TENANT}
        )

    def test_lists_mismatched_products(self):
        rows = service.list_mismatched_product_processes(
            _db(STATS, TABLES), TENANT, None
        )
        assert rows == [
            {
                "product_id": 10,
                "product_name": "ピン",
                "product_code": "P-1",
                "has_routings": True,
                "mismatch_count": 1,
                "entry_count": 2,
            },
            {
                "product_id": 11,
                "product_name": "ボルト",
                "product_code": None,
                "has_routings": False,
                "mismatch_count": 1,
                "entry_count": 1,
            },
        ]

    def test_comparison(self):
        comparison = service.get_product_process_comparison(
            _db(STATS, TABLES), TENANT, 10, None
        )
        assert comparison is not None
        assert [
            (r["process_name"], r["untracked"], [raw["raw_text"] for raw in r["raws"]])
            for r in comparison["routings"]
        ] == [("プレス", False, ["プレス"]), ("検査", True, [])]
        assert comparison["routings"][0]["raws"][0]["last_work_date"] == date(
            2026, 11, 20
        )
        assert comparison["off_routing"] == []
        assert comparison["unmatched"] == [
            {
                "raw_text": "バレル",
                "entry_count": 2,
                "last_work_date": None,
                "other_product_count": 1,
            }
        ]

    def test_comparison_without_entries_still_lists_routings(self):
        comparison = service.get_product_process_comparison(
            _db([], TABLES), TENANT, 10, None
        )
        assert comparison is not None
        assert comparison["mismatch_count"] == 0
        assert len(comparison["routings"]) == 2

    def test_comparison_unknown_product(self):
        assert (
            service.get_product_process_comparison(_db(STATS, TABLES), TENANT, 99, None)
            is None
        )
