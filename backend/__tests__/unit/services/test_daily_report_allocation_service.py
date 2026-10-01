"""日報の実績の割り付けと進捗の DB 入出力のテスト (Issue #490)。"""

from datetime import UTC, date, datetime
from typing import Any
from unittest.mock import MagicMock

import pytest
from app.services import daily_report_allocation_service as service

TENANT = "tenant-1"
OTHER_TENANT = "tenant-2"
COMPUTED_AT = datetime(2026, 10, 1, 3, 0, tzinfo=UTC)


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

    def gt(self, column, value):
        self._rows = [r for r in self._rows if (r.get(column) or 0) > value]
        return self

    def in_(self, column, values):
        self._rows = [r for r in self._rows if r.get(column) in values]
        return self

    def is_(self, column, value):
        # `.not_.is_(column, "null")` のみ使う
        assert value == "null"
        self._rows = [r for r in self._rows if r.get(column) is not None]
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


def _fake_db(tables: dict[str, list[dict[str, Any]]], rpc_result: str = "replaced"):
    db = MagicMock()
    db.table.side_effect = lambda name: _FakeQuery(tables.get(name, []))
    db.rpc.return_value.execute.return_value = MagicMock(data=rpc_result)
    return db


def _entry(entry_id, qty, process, product="ピン", customer="顧客A", **extra):
    return {
        "id": entry_id,
        "tenant_id": TENANT,
        "work_date": "2026-09-10",
        "customer_raw": customer,
        "product_raw": product,
        "process_raw": process,
        "good_qty": qty,
        **extra,
    }


def _tables(**overrides) -> dict[str, list[dict[str, Any]]]:
    tables: dict[str, list[dict[str, Any]]] = {
        "customers": [
            {
                "id": 10,
                "tenant_id": TENANT,
                "name": "顧客A",
                "alias": None,
                "status": None,
            }
        ],
        "products": [
            {
                "id": 100,
                "tenant_id": TENANT,
                "name": "ピン",
                "code": None,
                "is_active": True,
            },
            {
                "id": 900,
                "tenant_id": OTHER_TENANT,
                "name": "ピン",
                "code": None,
                "is_active": True,
            },
        ],
        "process_routings": [
            {
                "id": 11,
                "tenant_id": TENANT,
                "product_id": 100,
                "sequence_order": 1,
                "process_name": "プレス",
            },
            {
                "id": 12,
                "tenant_id": TENANT,
                "product_id": 100,
                "sequence_order": 2,
                "process_name": "カシメ",
            },
            {
                "id": 13,
                "tenant_id": TENANT,
                "product_id": 100,
                "sequence_order": 3,
                "process_name": "クグシ",
            },
            {
                "id": 91,
                "tenant_id": OTHER_TENANT,
                "product_id": 900,
                "sequence_order": 1,
                "process_name": "プレス",
            },
        ],
        "orders": [
            {
                "id": 1,
                "tenant_id": TENANT,
                "status": "confirmed",
                "product_id": 100,
                "customer_id": 10,
                "quantity": 100,
                "deadline_date": None,
                "confirmed_deadline": "2026-10-10",
                # JST では 9/10（UTC の 9/9 夜）
                "order_date": "2026-09-09T20:00:00+00:00",
            },
            {
                "id": 2,
                "tenant_id": TENANT,
                "status": "in_progress",
                "product_id": 100,
                "customer_id": 10,
                "quantity": 100,
                "deadline_date": "2026-10-20",
                "confirmed_deadline": None,
                "order_date": "2026-09-01T00:00:00+00:00",
            },
            # 候補外: ステータス・製品未照合・他テナント
            {
                "id": 3,
                "tenant_id": TENANT,
                "status": "shipped",
                "product_id": 100,
                "customer_id": 10,
                "quantity": 100,
                "deadline_date": "2026-09-01",
                "confirmed_deadline": None,
                "order_date": None,
            },
            {
                "id": 4,
                "tenant_id": TENANT,
                "status": "draft",
                "product_id": 100,
                "customer_id": 10,
                "quantity": 100,
                "deadline_date": "2026-09-01",
                "confirmed_deadline": None,
                "order_date": None,
            },
            {
                "id": 5,
                "tenant_id": TENANT,
                "status": "confirmed",
                "product_id": None,
                "customer_id": 10,
                "quantity": 100,
                "deadline_date": "2026-09-01",
                "confirmed_deadline": None,
                "order_date": None,
            },
            {
                "id": 9,
                "tenant_id": OTHER_TENANT,
                "status": "confirmed",
                "product_id": 900,
                "customer_id": None,
                "quantity": 100,
                "deadline_date": "2026-09-01",
                "confirmed_deadline": None,
                "order_date": None,
            },
        ],
        "daily_report_entries": [
            _entry(1, 120, "プレス"),
            _entry(2, 30, "カシメ、仕上げ加工"),
            # 良品数0・空は読まない
            _entry(3, 0, "プレス"),
            _entry(4, None, "プレス"),
            # 製品が照合できない
            _entry(5, 10, "プレス", product="謎の部品"),
            {**_entry(6, 999, "プレス"), "tenant_id": OTHER_TENANT},
        ],
    }
    tables.update(overrides)
    return tables


def _rpc_params(db: MagicMock) -> dict[str, Any]:
    db.rpc.assert_called_once()
    name, params = db.rpc.call_args.args
    assert name == "replace_daily_report_allocation"
    return params


class TestRecomputeTenantAllocation:
    def test_replaces_allocation_with_matched_entries(self):
        db = _fake_db(_tables())

        summary = service.recompute_tenant_allocation(db, TENANT, COMPUTED_AT)

        params = _rpc_params(db)
        assert params["p_tenant_id"] == TENANT
        assert params["p_computed_at"] == COMPUTED_AT.isoformat()
        progress = {
            (p["order_id"], p["process_routing_id"]): p for p in params["p_progress"]
        }
        # 候補は同じテナントの confirmed / in_progress の受注だけ（全工程の行を持つ）
        assert set(progress) == {(o, r) for o in (1, 2) for r in (11, 12, 13)}
        # 受注1（confirmed_deadline 10/10）→ 受注2（deadline_date 10/20）の順に充当
        assert progress[(1, 11)] == {
            "order_id": 1,
            "process_routing_id": 11,
            "good_qty": 100,
            "first_actual_date": "2026-09-10",
            "last_actual_date": "2026-09-10",
            "status": "completed",
            "completed_by": "quantity",
        }
        assert progress[(2, 11)]["good_qty"] == 20
        # 「カシメ、仕上げ加工」は辞書が無いので照合できず、割り付けに使わない
        assert progress[(1, 12)]["status"] == "not_started"
        assert params["p_unallocated"] == []
        assert summary == {
            "status": "replaced",
            "entries": 1,
            "unmatched_entries": 2,
            "progress": 6,
            "unallocated": 0,
        }

    def test_alias_change_is_reflected_by_recomputation(self):
        tables = _tables()
        before = _fake_db(tables)
        service.recompute_tenant_allocation(before, TENANT, COMPUTED_AT)

        tables["process_name_aliases"] = [
            {
                "id": "a",
                "tenant_id": TENANT,
                "raw_text": "カシメ、仕上げ加工",
                "process_names": ["カシメ", "クグシ"],
            }
        ]
        after = _fake_db(tables)
        summary = service.recompute_tenant_allocation(after, TENANT, COMPUTED_AT)

        progress = {
            (p["order_id"], p["process_routing_id"]): p
            for p in _rpc_params(after)["p_progress"]
        }
        assert progress[(1, 12)]["good_qty"] == 30
        assert progress[(1, 13)]["good_qty"] == 30
        assert progress[(1, 12)]["status"] == "completed"
        assert progress[(1, 12)]["completed_by"] == "later_process"
        assert summary["unmatched_entries"] == 1

    def test_unallocated_actuals_are_sent_with_reason(self):
        tables = _tables()
        tables["daily_report_entries"].append(_entry(7, 500, "プレス"))
        db = _fake_db(tables)

        service.recompute_tenant_allocation(db, TENANT, COMPUTED_AT)

        assert _rpc_params(db)["p_unallocated"] == [
            {
                "entry_id": 7,
                "product_id": 100,
                "customer_id": 10,
                "process_name": "プレス",
                "work_date": "2026-09-10",
                # 1件目の 120 で残り 80、500 のうち 80 を充当して 420 があふれる
                "qty": 420,
                "reason": "exceeds_order_qty",
            }
        ]

    def test_order_date_is_compared_as_jst_date(self):
        tables = _tables()
        # 受注1の受注日は JST 9/10。9/9 の実績は受注1に充当せず受注2へ
        tables["daily_report_entries"] = [
            {**_entry(1, 10, "プレス"), "work_date": "2026-09-09"}
        ]
        db = _fake_db(tables)

        service.recompute_tenant_allocation(db, TENANT, COMPUTED_AT)

        progress = {
            (p["order_id"], p["process_routing_id"]): p
            for p in _rpc_params(db)["p_progress"]
        }
        assert progress[(1, 11)]["good_qty"] == 0
        assert progress[(2, 11)]["good_qty"] == 10

    def test_returns_stale_from_rpc(self):
        db = _fake_db(_tables(), rpc_result="stale")

        summary = service.recompute_tenant_allocation(db, TENANT, COMPUTED_AT)

        assert summary["status"] == "stale"


class TestRecomputeAllTenants:
    def test_targets_tenants_with_sheets_or_previous_runs(self):
        db = _fake_db(
            {
                "daily_report_sheets": [
                    {"tenant_id": TENANT, "sheet_name": "2609製造"},
                    {"tenant_id": TENANT, "sheet_name": "2610製造"},
                ],
                # 明細が無くなったテナントも前回の結果を空で置き換える
                "daily_report_allocation_runs": [{"tenant_id": OTHER_TENANT}],
            }
        )

        assert service.list_target_tenants(db) == [TENANT, OTHER_TENANT]

    def test_one_tenant_failure_does_not_stop_others(self, monkeypatch):
        monkeypatch.setattr(
            service, "list_target_tenants", lambda _db: ["t1", "t2", "t3"]
        )
        results = {
            "t1": {
                "status": "replaced",
                "entries": 3,
                "unmatched_entries": 1,
                "progress": 5,
                "unallocated": 2,
            },
            "t3": {
                "status": "stale",
                "entries": 0,
                "unmatched_entries": 0,
                "progress": 0,
                "unallocated": 0,
            },
        }

        def recompute(_db, tenant_id):
            if tenant_id == "t2":
                raise RuntimeError("boom")
            return results[tenant_id]

        monkeypatch.setattr(service, "recompute_tenant_allocation", recompute)

        assert service.recompute_all_tenants(MagicMock()) == {
            "tenants": 3,
            "replaced": 1,
            "stale": 1,
            "failed": 1,
            "progress": 5,
            "unallocated": 2,
            "unmatched_entries": 1,
        }


class TestParsing:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("2026-09-09T15:00:00+00:00", date(2026, 9, 10)),
            ("2026-09-09T14:59:59Z", date(2026, 9, 9)),
            # オフセット無しは JST とみなす
            ("2026-09-09T23:00:00", date(2026, 9, 9)),
            (None, None),
            ("not-a-date", None),
        ],
    )
    def test_order_date_to_jst_date(self, value, expected):
        assert service._to_jst_date(value) == expected

    def test_invalid_date_only_value_is_none(self):
        assert service._parse_date("2026-02-30") is None
        assert service._parse_date("2026-09-10") == date(2026, 9, 10)


class TestFetch:
    def test_fetch_order_progress_flattens_routing_and_sorts_by_sequence(self):
        rows = [
            {
                "tenant_id": TENANT,
                "order_id": 1,
                "process_routing_id": 13,
                "good_qty": 0,
                "status": "not_started",
                "process_routings": {"sequence_order": 2, "process_name": "カシメ"},
            },
            {
                "tenant_id": TENANT,
                "order_id": 1,
                "process_routing_id": 14,
                "good_qty": 5,
                "status": "in_progress",
                "process_routings": {"sequence_order": 1, "process_name": "プレス"},
            },
            {
                "tenant_id": TENANT,
                "order_id": 2,
                "process_routing_id": 14,
                "good_qty": 0,
                "status": "not_started",
                "process_routings": None,
            },
        ]
        db = _fake_db({"order_process_progress": rows})

        result = service.fetch_order_progress(db, TENANT, [1])

        assert [
            (r["process_routing_id"], r["sequence_order"], r["process_name"])
            for r in result
        ] == [
            (14, 1, "プレス"),
            (13, 2, "カシメ"),
        ]
        assert "process_routings" not in result[0]

    def test_fetch_unallocated_actuals_attaches_entry_columns(self):
        rows = [
            {
                "tenant_id": TENANT,
                "id": 1,
                "work_date": "2026-09-01",
                "daily_report_entries": {
                    "sheet_name": "2609製造",
                    "row_no": 5,
                    "customer_raw": "顧客A",
                    "product_raw": "ピン",
                    "process_raw": "プレス",
                },
            },
            {
                "tenant_id": TENANT,
                "id": 2,
                "work_date": "2026-09-03",
                "daily_report_entries": None,
            },
        ]
        db = _fake_db({"daily_report_unallocated_actuals": rows})

        result = service.fetch_unallocated_actuals(db, TENANT)

        assert [r["id"] for r in result] == [2, 1]
        assert result[1]["sheet_name"] == "2609製造"
        assert result[1]["row_no"] == 5
        assert result[0]["product_raw"] is None
        assert "daily_report_entries" not in result[0]

    def test_fetch_last_computed_at(self):
        db = _fake_db(
            {
                "daily_report_allocation_runs": [
                    {"tenant_id": TENANT, "computed_at": "2026-10-01T03:00:00+00:00"}
                ]
            }
        )

        assert service.fetch_last_computed_at(db, TENANT) == "2026-10-01T03:00:00+00:00"
        assert service.fetch_last_computed_at(db, OTHER_TENANT) is None
