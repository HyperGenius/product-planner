"""重複製品の統合の純粋関数のテスト (Issue #515)。

DB の読み込み（find_merge_candidates / load_merge_preview）は integration テストで確認する。
"""

from typing import Any
from unittest.mock import MagicMock

import pytest
from app.models.master.product_merge_schemas import (
    ProductMergeCounts,
    ProductMergeOrderRef,
    ProductMergePreview,
)
from app.services import product_merge_service
from app.services.product_merge_service import (
    MergeConflictError,
    MergeForbiddenError,
    MergeProductNotFoundError,
    correctness_rank,
    execute_merge,
    group_duplicate_products,
    plan_merge,
    summarize_candidates,
)
from app.services.product_spec_parser import parse_product_spec
from postgrest.exceptions import APIError

KEEP = {"id": 1, "name": "φ10.0×20L SUS100", "code": None, "is_active": True}
MERGE_A = {"id": 2, "name": "10φ×20L (SUS100)", "code": None, "is_active": True}
MERGE_B = {"id": 3, "name": "φ10x20 sus100", "code": None, "is_active": False}


def _routing(rid: int, product_id: int, seq: int, unit: Any = 1) -> dict[str, Any]:
    return {
        "id": rid,
        "product_id": product_id,
        "sequence_order": seq,
        "unit_time_seconds": unit,
    }


def _order(
    oid: int,
    product_id: int,
    status: str = "confirmed",
    customer_id: int | None = 10,
    deadline: str | None = "2026-11-01",
) -> dict[str, Any]:
    return {
        "id": oid,
        "order_number": f"ORD-{oid}",
        "product_id": product_id,
        "customer_id": customer_id,
        "deadline_date": deadline,
        "status": status,
    }


def _plan(
    merge_products=None,
    routings=None,
    orders=None,
    schedules=None,
    keep=KEEP,
) -> ProductMergePreview:
    return plan_merge(
        keep_product=keep,
        merge_products=merge_products or [MERGE_A],
        routings=routings or [],
        orders=orders or [],
        schedules=schedules or [],
        alias_count=0,
        alias_history_count=0,
    )


@pytest.mark.unit
class TestCorrectnessRank:
    @pytest.mark.parametrize(
        ("units", "rank"),
        [
            ([], 0),
            ([0, 0], 1),
            ([0, 12], 2),
            (["12.0000", 3], 2),
            ([0, "12.5000"], 3),
            ([0.25], 3),
        ],
    )
    def test_rank(self, units, rank):
        routings = [_routing(i, 1, i, u) for i, u in enumerate(units, start=1)]

        assert correctness_rank(routings) == rank


@pytest.mark.unit
class TestGroupDuplicateProducts:
    def _product(self, pid: int, name: str) -> dict[str, Any]:
        return {"id": pid, "name": name, "code": None, "is_active": True}

    def test_groups_same_spec_and_skips_singletons(self):
        groups = group_duplicate_products(
            [
                self._product(3, "φ10x20 sus100"),
                self._product(1, "φ10.0×20L SUS100"),
                self._product(2, "10φ×L20 (SUS100)"),
                self._product(4, "φ12×20L SUS100"),
                self._product(5, "フィルター"),
                self._product(6, "φ14.5×30L"),
                self._product(7, "14.50φ×30"),
            ]
        )

        assert [g.model_dump() for g in groups] == [
            {
                "diameter": "10",
                "length": "20",
                "material": "SUS100",
                "product_count": 3,
                "mergeable": True,
                "product_names": [
                    "φ10.0×20L SUS100",
                    "10φ×L20 (SUS100)",
                    "φ10x20 sus100",
                ],
            },
            {
                "diameter": "14.5",
                "length": "30",
                "material": "",
                "product_count": 2,
                "mergeable": True,
                "product_names": ["φ14.5×30L", "14.50φ×30"],
            },
        ]

    def test_prefix_only_group_is_not_mergeable_and_sorted_last(self):
        groups = group_duplicate_products(
            [
                self._product(1, "A社φ8×10L SUS100"),
                self._product(2, "φ8×10L SUS100"),
                self._product(3, "φ20×40L SUS100"),
                self._product(4, "φ20×40L SUS100"),
            ]
        )

        assert [(g.diameter, g.mergeable) for g in groups] == [
            ("20", True),
            ("8", False),
        ]

    def test_mergeable_when_same_prefix_pair_exists(self):
        groups = group_duplicate_products(
            [
                self._product(1, "A社φ8×10L SUS100"),
                self._product(2, "A社 8φ×10L SUS100"),
                self._product(3, "φ8×10L SUS100"),
            ]
        )

        assert [(g.product_count, g.mergeable) for g in groups] == [(3, True)]

    def test_empty(self):
        assert group_duplicate_products([]) == []


@pytest.mark.unit
class TestSummarizeCandidates:
    def _products(self, *products):
        return [(p, parse_product_spec(p["name"])) for p in products]

    def test_counts_and_default_keep(self):
        candidates, default_keep = summarize_candidates(
            self._products(KEEP, MERGE_A, MERGE_B),
            routings=[
                _routing(11, 1, 1, "1.5"),
                _routing(12, 1, 2, 0),
                _routing(21, 2, 1, 3),
            ],
            orders=[
                _order(100, 2, "shipped"),
                _order(101, 2, "confirmed"),
                _order(102, 2, "shipped"),
            ],
            aliases=[{"id": "a", "product_id": 3}, {"id": "b", "product_id": 3}],
        )

        assert default_keep == 1
        assert [c.id for c in candidates] == [1, 2, 3]
        keep, merge_a, merge_b = candidates
        assert (
            keep.routing_count,
            keep.timed_routing_count,
            keep.has_decimal_time,
        ) == (
            2,
            1,
            True,
        )
        assert keep.rank == 3
        assert merge_a.order_counts == {"shipped": 2, "confirmed": 1}
        assert merge_a.rank == 2
        assert merge_b.alias_count == 2
        assert merge_b.rank == 0
        assert merge_b.is_active is False

    def test_no_default_keep_when_top_rank_ties(self):
        _, default_keep = summarize_candidates(
            self._products(KEEP, MERGE_A),
            routings=[_routing(11, 1, 1, 3), _routing(21, 2, 1, 4)],
            orders=[],
            aliases=[],
        )

        assert default_keep is None

    def test_keeps_prefix(self):
        prefixed = {"id": 4, "name": "A社φ10×20L SUS100", "code": None}

        candidates, _ = summarize_candidates(
            self._products(prefixed), routings=[], orders=[], aliases=[]
        )

        assert candidates[0].prefix == "A社"
        assert candidates[0].prefix_key == "A社"

    def test_empty(self):
        assert summarize_candidates([], [], [], []) == ([], None)


@pytest.mark.unit
class TestPlanMergeSpec:
    def test_same_spec_has_no_blocker(self):
        preview = _plan(merge_products=[MERGE_A, MERGE_B])

        assert preview.blockers == []
        assert preview.counts.products_deleted == 2

    def test_prefix_mismatch_blocks(self):
        prefixed = {"id": 4, "name": "A社φ10×20L SUS100"}

        preview = _plan(merge_products=[prefixed])

        assert [(b.reason, b.product_id) for b in preview.blockers] == [
            ("prefix_mismatch", 4)
        ]

    def test_prefix_mismatch_when_keep_has_prefix(self):
        keep = {"id": 4, "name": "A社φ10×20L SUS100"}

        preview = _plan(keep=keep, merge_products=[MERGE_A])

        assert [b.reason for b in preview.blockers] == ["prefix_mismatch"]

    @pytest.mark.parametrize("name", ["φ10×25L SUS100", "φ10×20L SUS200", "フィルター"])
    def test_spec_mismatch_blocks(self, name):
        preview = _plan(merge_products=[{"id": 4, "name": name}])

        assert [b.reason for b in preview.blockers] == ["spec_mismatch"]


@pytest.mark.unit
class TestPlanMergeOrders:
    def test_reassigns_orders_without_conflict(self):
        preview = _plan(
            orders=[
                _order(100, 1, deadline="2026-11-01"),
                _order(101, 2, deadline="2026-11-02"),
                _order(102, 2, customer_id=None),
                _order(103, 2, deadline=None),
            ]
        )

        assert preview.blockers == []
        assert preview.counts.orders_reassigned == 3
        assert preview.counts.orders_deleted == 0

    def test_deletes_shipped_order_conflicting_with_keep(self):
        preview = _plan(orders=[_order(100, 1), _order(101, 2, "shipped")])

        assert preview.blockers == []
        assert preview.deleted_orders == [
            ProductMergeOrderRef(
                id=101, order_number="ORD-101", product_id=2, status="shipped"
            )
        ]
        assert preview.counts.orders_reassigned == 0
        assert preview.counts.orders_deleted == 1

    @pytest.mark.parametrize("status", ["in_progress", "draft", "canceled"])
    def test_blocks_non_shipped_order_conflicting_with_keep(self, status):
        # 残す側が出荷済みでも、統合される側が出荷済みでなければ止める
        preview = _plan(orders=[_order(100, 1, "shipped"), _order(101, 2, status)])

        assert len(preview.blockers) == 1
        blocker = preview.blockers[0]
        assert blocker.reason == "order_conflict"
        assert (blocker.order_id, blocker.order_status) == (101, status)
        assert (blocker.conflicting_order_id, blocker.conflicting_order_number) == (
            100,
            "ORD-100",
        )
        assert preview.deleted_orders == []

    def test_conflict_between_merged_products(self):
        # 統合される製品どうしの衝突: 出荷済みでない受注が枠を持ち、出荷済みは削除する
        preview = _plan(
            merge_products=[MERGE_A, MERGE_B],
            orders=[_order(101, 2, "shipped"), _order(102, 3, "confirmed")],
        )

        assert preview.blockers == []
        assert [o.id for o in preview.deleted_orders] == [101]
        assert preview.counts.orders_reassigned == 1

    def test_conflict_between_merged_non_shipped_orders_blocks(self):
        preview = _plan(
            merge_products=[MERGE_A, MERGE_B],
            orders=[_order(101, 2, "confirmed"), _order(102, 3, "draft")],
        )

        assert [(b.order_id, b.conflicting_order_id) for b in preview.blockers] == [
            (102, 101)
        ]

    def test_conflict_between_merged_shipped_orders_keeps_one(self):
        preview = _plan(
            merge_products=[MERGE_A, MERGE_B],
            orders=[_order(102, 3, "shipped"), _order(101, 2, "shipped")],
        )

        assert preview.blockers == []
        assert [o.id for o in preview.deleted_orders] == [102]
        assert preview.counts.orders_reassigned == 1


@pytest.mark.unit
class TestPlanMergeSchedules:
    ROUTINGS = [
        _routing(11, 1, 1),
        _routing(12, 1, 2),
        _routing(21, 2, 1),
        _routing(22, 2, 2),
        _routing(23, 2, 3),
    ]

    def test_counts_schedules_and_routings(self):
        preview = _plan(
            routings=self.ROUTINGS[:4],
            orders=[_order(101, 2)],
            schedules=[
                {"id": 1, "order_id": 101, "process_routing_id": 21},
                {"id": 2, "order_id": 101, "process_routing_id": 22},
                {"id": 3, "order_id": 101, "process_routing_id": 22},
            ],
        )

        assert preview.blockers == []
        assert preview.counts.schedules_reassigned == 3
        assert preview.counts.routings_deleted == 2

    def test_blocks_when_keep_lacks_sequence(self):
        preview = _plan(
            routings=self.ROUTINGS,
            orders=[_order(101, 2)],
            schedules=[
                {"id": 1, "order_id": 101, "process_routing_id": 21},
                {"id": 2, "order_id": 101, "process_routing_id": 23},
                {"id": 3, "order_id": 101, "process_routing_id": 23},
            ],
        )

        assert [
            (b.reason, b.order_id, b.order_number, b.sequence_order)
            for b in preview.blockers
        ] == [("routing_mismatch", 101, "ORD-101", 3)]

    def test_unscheduled_extra_routing_does_not_block(self):
        preview = _plan(routings=self.ROUTINGS, orders=[_order(101, 2)])

        assert preview.blockers == []
        assert preview.counts.routings_deleted == 3

    def test_ignores_schedules_of_deleted_orders(self):
        preview = _plan(
            routings=self.ROUTINGS,
            orders=[_order(100, 1), _order(101, 2, "shipped")],
            schedules=[{"id": 1, "order_id": 101, "process_routing_id": 23}],
        )

        assert preview.blockers == []
        assert preview.counts.schedules_reassigned == 0
        assert preview.counts.orders_deleted == 1


@pytest.mark.unit
class TestExecuteMerge:
    PREVIEW = ProductMergePreview(
        keep_product_id=1,
        merge_product_ids=[2, 3],
        counts=ProductMergeCounts(
            orders_reassigned=1,
            schedules_reassigned=2,
            aliases_reassigned=0,
            alias_history_reassigned=0,
            orders_deleted=1,
            routings_deleted=2,
            products_deleted=2,
        ),
        deleted_orders=[
            ProductMergeOrderRef(
                id=101, order_number=None, product_id=2, status="shipped"
            )
        ],
        blockers=[],
    )

    def test_calls_rpc(self):
        db = MagicMock()
        db.rpc.return_value.execute.return_value.data = self.PREVIEW.counts.model_dump()

        counts = execute_merge(db, "tenant-1", self.PREVIEW)

        assert counts == self.PREVIEW.counts
        db.rpc.assert_called_once_with(
            "merge_products",
            {
                "p_tenant_id": "tenant-1",
                "p_keep_product_id": 1,
                "p_merge_product_ids": [2, 3],
                "p_delete_order_ids": [101],
            },
        )

    @pytest.mark.parametrize(
        ("code", "error"),
        [
            ("42501", MergeForbiddenError),
            ("P0002", MergeProductNotFoundError),
            ("23505", MergeConflictError),
            ("23503", MergeConflictError),
            ("P0001", MergeConflictError),
        ],
    )
    def test_maps_rpc_errors(self, code, error, monkeypatch):
        monkeypatch.setattr(product_merge_service.logger, "error", MagicMock())
        db = MagicMock()
        db.rpc.return_value.execute.side_effect = APIError(
            {"message": "raw db message", "code": code}
        )

        with pytest.raises(error):
            execute_merge(db, "tenant-1", self.PREVIEW)
