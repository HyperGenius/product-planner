"""顧客の統合の事前チェック（純粋関数）のテスト (Issue #610)。"""

from typing import Any

import pytest
from app.services.customer_merge_service import (
    count_dropped_aliases,
    plan_merge,
    plan_order_conflicts,
)

KEEP = {"id": 1, "name": "顧客A社", "alias": None, "email": None}
MERGED = [
    {"id": 2, "name": "顧客A社 担当X", "alias": None, "email": "x@example.com"},
    {"id": 3, "name": "顧客A社 担当Y", "alias": None, "email": "Y@example.com "},
]
NAMES = {2: "顧客A社 担当X", 3: "顧客A社 担当Y"}


def _order(id: int, customer_id: int, **kw: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": id,
        "order_number": None,
        "customer_id": customer_id,
        "product_id": 10,
        "deadline_date": "2026-11-30",
        "status": "draft",
        "order_type": "production",
        "extracted_product_name": None,
        "customer_order_no": None,
    }
    return {**base, **kw}


@pytest.mark.unit
class TestPlanOrderConflicts:
    def test_no_conflict_when_keys_differ(self):
        orders = [_order(1, 1), _order(2, 2, deadline_date="2026-12-01")]
        assert plan_order_conflicts(1, NAMES, orders) == []

    def test_keep_customer_order_holds_the_slot(self):
        blockers = plan_order_conflicts(1, NAMES, [_order(5, 1), _order(2, 2)])
        assert [(b.order_id, b.conflicting_order_id) for b in blockers] == [(2, 5)]
        assert blockers[0].customer_id == 2
        assert blockers[0].customer_name == "顧客A社 担当X"

    def test_without_keep_order_lowest_id_holds_the_slot(self):
        blockers = plan_order_conflicts(1, NAMES, [_order(7, 2), _order(4, 3)])
        assert [(b.order_id, b.conflicting_order_id) for b in blockers] == [(7, 4)]

    def test_shipped_orders_also_block(self):
        blockers = plan_order_conflicts(
            1, NAMES, [_order(5, 1), _order(2, 2, status="shipped")]
        )
        assert [b.order_status for b in blockers] == ["shipped"]

    def test_null_deadline_never_conflicts(self):
        orders = [_order(1, 1, deadline_date=None), _order(2, 2, deadline_date=None)]
        assert plan_order_conflicts(1, NAMES, orders) == []

    def test_unmatched_product_uses_extracted_name(self):
        def unmatched(id: int, customer_id: int, name: str | None):
            return _order(id, customer_id, product_id=None, extracted_product_name=name)

        orders = [unmatched(1, 1, "φ10"), unmatched(2, 2, "φ10"), unmatched(3, 2, None)]
        assert [b.order_id for b in plan_order_conflicts(1, NAMES, orders)] == [2]

    def test_repair_orders_conflict_on_customer_order_no(self):
        def repair(id: int, customer_id: int):
            return _order(
                id,
                customer_id,
                product_id=None,
                deadline_date=None,
                order_type="repair",
                customer_order_no="R-1",
            )

        assert [
            b.order_id
            for b in plan_order_conflicts(1, NAMES, [repair(1, 1), repair(2, 2)])
        ] == [2]

    def test_same_merged_customer_orders_are_not_compared_with_each_other(self):
        # 同じ顧客内の重複は既存の UNIQUE が許していないので起きないが、顧客をまたがない組は対象外
        assert (
            plan_order_conflicts(1, NAMES, [_order(2, 2), _order(3, 2, product_id=11)])
            == []
        )


@pytest.mark.unit
class TestCountDroppedAliases:
    def test_keep_side_wins(self):
        aliases = [
            {"customer_id": 1, "raw_text": "a"},
            {"customer_id": 2, "raw_text": "a"},
            {"customer_id": 2, "raw_text": "b"},
        ]
        assert count_dropped_aliases(1, aliases) == 1

    def test_duplicates_among_merged_keep_one(self):
        aliases = [
            {"customer_id": 2, "raw_text": "a"},
            {"customer_id": 3, "raw_text": "a"},
            {"customer_id": 3, "raw_text": "b"},
        ]
        assert count_dropped_aliases(1, aliases) == 1


@pytest.mark.unit
class TestPlanMerge:
    def test_counts(self):
        preview = plan_merge(
            keep_customer=KEEP,
            merge_customers=MERGED,
            orders=[
                _order(1, 1),
                _order(2, 2, deadline_date="2026-12-01"),
                _order(3, 3, product_id=11),
            ],
            attachment_count=4,
            product_aliases=[
                {"customer_id": 1, "raw_text": "a"},
                {"customer_id": 2, "raw_text": "a"},
                {"customer_id": 3, "raw_text": "c"},
            ],
            alias_history_count=5,
            customer_alias_count=1,
            unallocated_count=2,
            prompt_history_count=3,
            contacts=[{"id": "c1", "email": "x@example.com"}],
        )
        c = preview.counts
        assert preview.blockers == []
        assert preview.merge_customer_ids == [2, 3]
        assert c.orders_reassigned == 2
        assert c.attachments_reassigned == 4
        assert (c.aliases_reassigned, c.aliases_dropped) == (1, 1)
        assert c.alias_history_reassigned == 5
        assert c.customer_aliases_reassigned == 1
        assert c.unallocated_actuals_reassigned == 2
        assert c.prompt_history_reassigned == 3
        # 既存の担当者1件 + 担当者に無い customers.email（正規化後 y@example.com）1件
        assert c.contacts_reassigned == 2
        assert c.customers_deleted == 2

    def test_blockers_are_reported(self):
        preview = plan_merge(
            keep_customer=KEEP,
            merge_customers=MERGED,
            orders=[_order(1, 1), _order(2, 2)],
            attachment_count=0,
            product_aliases=[],
            alias_history_count=0,
            customer_alias_count=0,
            unallocated_count=0,
            prompt_history_count=0,
            contacts=[],
        )
        assert [b.reason for b in preview.blockers] == ["order_conflict"]
