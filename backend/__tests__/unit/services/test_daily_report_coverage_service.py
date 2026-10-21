"""日報の照合状況の参照のテスト (Issue #542)。"""

from datetime import date
from typing import Any
from unittest.mock import MagicMock

from app.services import daily_report_coverage_service as service

TENANT = "tenant-1"
OTHER_TENANT = "tenant-2"
TODAY = date(2026, 10, 21)


class _FakeQuery:
    """PostgREST のクエリチェーンを受け、絞り込みを行に適用して `.range()` の範囲を返す。"""

    def __init__(self, rows: list[dict[str, Any]]):
        self._rows = list(rows)
        self._range: tuple[int, int] | None = None
        self.not_ = self

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, column, value):
        self._rows = [r for r in self._rows if r.get(column) == value]
        return self

    def in_(self, column, values):
        self._rows = [r for r in self._rows if r.get(column) in values]
        return self

    def is_(self, column, value):
        # `.not_.is_(column, "null")` のみ使う
        assert value == "null"
        self._rows = [r for r in self._rows if r.get(column) is not None]
        return self

    def or_(self, filters):
        # `work_date.gte.<日付>,work_date.is.null` のみ使う
        gte, _ = filters.split(",")
        column, _, value = gte.split(".", 2)
        self._rows = [
            r for r in self._rows if r.get(column) is None or r[column] >= value
        ]
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, count):
        self._range = (0, count - 1)
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def execute(self):
        assert self._range is not None, "全件読み込みは range() でページングする"
        start, end = self._range
        return MagicMock(data=self._rows[start : end + 1])


def _fake_db(tables: dict[str, list[dict[str, Any]]]):
    db = MagicMock()
    db.table.side_effect = lambda name: _FakeQuery(tables.get(name, []))
    return db


def _unallocated(row_id, qty, reason, work_date, **extra):
    return {
        "tenant_id": TENANT,
        "id": row_id,
        "product_id": 100,
        "customer_id": 10,
        "process_name": "プレス",
        "work_date": work_date,
        "qty": qty,
        "reason": reason,
        **extra,
    }


def _tables(**overrides) -> dict[str, list[dict[str, Any]]]:
    tables: dict[str, list[dict[str, Any]]] = {
        "daily_report_allocation_runs": [
            {
                "tenant_id": TENANT,
                "computed_at": "2026-10-21T03:00:00+00:00",
                "coverage": [
                    {
                        "work_month": "2026-07-01",
                        "matched_rows": 5,
                        "matched_qty": 500,
                        "unmatched_rows": 1,
                        "unmatched_qty": 50,
                    },
                    {
                        "work_month": "2026-09-01",
                        "matched_rows": 3,
                        "matched_qty": 300,
                        "unmatched_rows": 2,
                        "unmatched_qty": 20,
                    },
                    {
                        "work_month": None,
                        "matched_rows": 1,
                        "matched_qty": 10,
                        "unmatched_rows": 0,
                        "unmatched_qty": 0,
                    },
                ],
            },
            {"tenant_id": OTHER_TENANT, "computed_at": "x", "coverage": []},
        ],
        "daily_report_unallocated_actuals": [
            _unallocated(1, 40, "no_candidate_order", "2026-09-10"),
            _unallocated(2, 60, "no_candidate_order", "2026-07-10"),
            _unallocated(3, 10, "no_work_date", None),
            _unallocated(
                4,
                30,
                "no_routing_process",
                "2026-10-01",
                product_id=200,
                process_name="溶接",
                customer_id=None,
            ),
            {
                **_unallocated(9, 999, "no_candidate_order", "2026-10-01"),
                "tenant_id": OTHER_TENANT,
            },
        ],
        "orders": [
            {"tenant_id": TENANT, "id": 1, "product_id": 100, "status": "shipped"},
            {"tenant_id": TENANT, "id": 2, "product_id": 100, "status": "confirmed"},
            {"tenant_id": TENANT, "id": 3, "product_id": None, "status": "draft"},
            {"tenant_id": OTHER_TENANT, "id": 9, "product_id": 100, "status": "draft"},
        ],
        "products": [
            {"tenant_id": TENANT, "id": 100, "name": "ピン", "code": "P-1"},
            {"tenant_id": TENANT, "id": 200, "name": "ブラケット", "code": None},
        ],
        "customers": [{"tenant_id": TENANT, "id": 10, "name": "顧客A"}],
        "process_routings": [
            {"tenant_id": TENANT, "id": 11, "product_id": 100},
            {"tenant_id": OTHER_TENANT, "id": 91, "product_id": 200},
        ],
    }
    tables.update(overrides)
    return tables


class TestGetCoverage:
    def test_all_periods(self):
        result = service.get_coverage(_fake_db(_tables()), TENANT, None, TODAY)

        assert result["computed_at"] == "2026-10-21T03:00:00+00:00"
        assert result["since"] is None
        assert result["summary"] == {
            "total_qty": 880,
            "allocated_qty": 670,
            "unallocated_qty": 140,
            "unmatched_rows": 3,
            "unmatched_qty": 70,
            "unallocated": [
                # 出荷済みの受注だけがある製品の「受注が無い」実績
                {"category": "closed_order_only", "row_count": 2, "qty": 100},
                {"category": "no_routing_process", "row_count": 1, "qty": 30},
                {"category": "no_work_date", "row_count": 1, "qty": 10},
            ],
        }
        assert [
            (g["product_id"], g["process_name"], g["category"], g["qty"])
            for g in result["groups"]
        ] == [
            (100, "プレス", "closed_order_only", 100),
            (200, "溶接", "no_routing_process", 30),
            (100, "プレス", "no_work_date", 10),
        ]
        press = result["groups"][0]
        assert press["product_name"] == "ピン"
        assert press["product_code"] == "P-1"
        assert press["product_has_routings"] is True
        assert press["customer_names"] == ["顧客A"]
        assert (press["first_work_date"], press["last_work_date"]) == (
            "2026-07-10",
            "2026-09-10",
        )
        # 他テナントの工程ルートは数えない
        welding = result["groups"][1]
        assert welding["product_has_routings"] is False
        assert welding["customer_names"] == []

    def test_recent_months_keep_undated_rows(self):
        result = service.get_coverage(_fake_db(_tables()), TENANT, 3, TODAY)

        assert result["since"] == date(2026, 8, 1)
        summary = result["summary"]
        # 7月の集計・未割当を除く（加工日の無い分は残す）
        assert summary["total_qty"] == 330
        assert summary["unallocated_qty"] == 80
        assert summary["allocated_qty"] == 230
        assert [g["qty"] for g in result["groups"]] == [40, 30, 10]

    def test_not_computed_yet(self):
        result = service.get_coverage(
            _fake_db(
                _tables(
                    daily_report_allocation_runs=[],
                    daily_report_unallocated_actuals=[],
                )
            ),
            TENANT,
            None,
            TODAY,
        )

        assert result["computed_at"] is None
        assert result["summary"]["total_qty"] == 0
        assert result["groups"] == []
