"""
Integration テスト: 重複製品の統合 RPC merge_products (Issue #515)

以下は実際の Postgres (RLS込み) でしか検証できないため integration tier に置く。
- ユーザー JWT（SECURITY INVOKER）で受注・スケジュール・別名・別名履歴が残す製品へ付け替わり、
  統合される側の工程・製品が削除されること（日報の進捗は CASCADE で消える）
- 事前チェック（load_merge_preview）の後に状況が変わった場合、制約違反で全体が失敗し何も変わらないこと
- president / platform_admin 以外・他テナントの製品では実行できないこと
- product_name_alias_history の UPDATE は president の product_id だけに許可されていること

実行:
  supabase start
  cd backend && pytest __tests__/integration/test_merge_products.py -v --run-integration
"""

from datetime import UTC, datetime
from typing import Any, cast

import pytest
from app.main import app
from app.services.product_merge_service import load_merge_preview
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

KEEP_NAME = "φ10.0×20L SUS100"
MERGE_NAME = "10φ×20L (SUS100)"
SEGMENTS = (
    ("2026-11-02T09:00:00+09:00", "2026-11-02T12:00:00+09:00"),
    ("2026-11-02T13:00:00+09:00", "2026-11-02T17:00:00+09:00"),
)


def _rows(res) -> list[dict[str, Any]]:
    return cast(list[dict[str, Any]], res.data)


def _insert(admin_db, table: str, values: dict[str, Any] | list[dict[str, Any]]):
    return _rows(admin_db.table(table).insert(values).execute())


def _set_role(admin_db, tenant_id: str, user_id: str, role: str) -> None:
    admin_db.table("organization_members").update({"role": role}).eq(
        "tenant_id", tenant_id
    ).eq("user_id", user_id).execute()


def _create_product(admin_db, tenant_id: str, name: str, sequences) -> dict[str, Any]:
    product_id = _insert(
        admin_db, "products", {"tenant_id": tenant_id, "name": name, "code": None}
    )[0]["id"]
    routings = _insert(
        admin_db,
        "process_routings",
        [
            {
                "tenant_id": tenant_id,
                "product_id": product_id,
                "sequence_order": seq,
                "process_name": f"工程{seq}",
                "unit_time_seconds": "1.5",
            }
            for seq in sequences
        ],
    )
    return {
        "id": product_id,
        "routings": {r["sequence_order"]: r["id"] for r in routings},
    }


def _create_order(
    admin_db, tenant: dict[str, Any], product_id: int, status: str, deadline: str
) -> int:
    return _insert(
        admin_db,
        "orders",
        {
            "tenant_id": tenant["id"],
            "product_id": product_id,
            "customer_id": tenant["customer_id"],
            "quantity": 10,
            "status": status,
            "deadline_date": deadline,
            "order_date": "2026-10-01T00:00:00+09:00",
        },
    )[0]["id"]


def _schedule(admin_db, tenant_id: str, order_id: int, routing_ids: list[int]) -> None:
    _insert(
        admin_db,
        "production_schedules",
        [
            {
                "tenant_id": tenant_id,
                "order_id": order_id,
                "process_routing_id": routing_id,
                "start_datetime": start,
                "end_datetime": end,
            }
            for routing_id, (start, end) in zip(routing_ids, SEGMENTS, strict=True)
        ],
    )


@pytest.fixture()
def tenants(admin_db, auth_user_id):
    """ログインユーザーが president として所属する own と、所属しない other を作る。"""
    ids: dict[str, dict[str, Any]] = {}
    for key in ("own", "other"):
        tenant_id = _insert(
            admin_db, "tenants", {"name": f"integration test merge products ({key})"}
        )[0]["id"]
        customer_id = _insert(
            admin_db,
            "customers",
            {"tenant_id": tenant_id, "name": "株式会社サンプル工業"},
        )[0]["id"]
        ids[key] = {
            "id": tenant_id,
            "customer_id": customer_id,
            "keep": _create_product(admin_db, tenant_id, KEEP_NAME, (1, 2)),
            "merge": _create_product(admin_db, tenant_id, MERGE_NAME, (1, 2)),
        }

    _insert(
        admin_db,
        "organization_members",
        {"user_id": auth_user_id, "tenant_id": ids["own"]["id"], "role": "president"},
    )

    yield ids

    for tenant in ids.values():
        tid = tenant["id"]
        for table in (
            "order_process_progress",
            "product_name_alias_history",
            "product_name_aliases",
            "production_schedules",
            "orders",
            "process_routings",
            "products",
            "customers",
        ):
            admin_db.table(table).delete().eq("tenant_id", tid).execute()
    admin_db.table("organization_members").delete().eq("user_id", auth_user_id).eq(
        "tenant_id", ids["own"]["id"]
    ).execute()
    for tenant in ids.values():
        admin_db.table("tenants").delete().eq("id", tenant["id"]).execute()


def _merge(client, tenant: dict[str, Any], delete_order_ids=()):
    return client.rpc(
        "merge_products",
        {
            "p_tenant_id": tenant["id"],
            "p_keep_product_id": tenant["keep"]["id"],
            "p_merge_product_ids": [tenant["merge"]["id"]],
            "p_delete_order_ids": list(delete_order_ids),
        },
    ).execute()


def _product_ids(admin_db, tenant_id: str) -> set[int]:
    return {
        r["id"]
        for r in _rows(
            admin_db.table("products").select("id").eq("tenant_id", tenant_id).execute()
        )
    }


@pytest.mark.integration
class TestMergeProducts:
    def test_reassigns_and_deletes(
        self, admin_db, real_supabase_client, auth_user_id, tenants
    ):
        own = tenants["own"]
        keep, merge = own["keep"], own["merge"]
        keep_order = _create_order(admin_db, own, keep["id"], "confirmed", "2026-11-10")
        merge_order = _create_order(
            admin_db, own, merge["id"], "in_progress", "2026-11-20"
        )
        # 残す製品の受注と同じ顧客・納期の出荷済み受注 → 削除される
        shipped_order = _create_order(
            admin_db, own, merge["id"], "shipped", "2026-11-10"
        )
        _schedule(
            admin_db,
            own["id"],
            merge_order,
            [merge["routings"][1], merge["routings"][2]],
        )
        _schedule(
            admin_db,
            own["id"],
            shipped_order,
            [merge["routings"][1], merge["routings"][2]],
        )
        alias_id = _insert(
            admin_db,
            "product_name_aliases",
            {
                "tenant_id": own["id"],
                "customer_id": own["customer_id"],
                "product_id": merge["id"],
                "raw_text": "10φ×20 SUS100",
                "created_by": auth_user_id,
            },
        )[0]["id"]
        history_id = _insert(
            admin_db,
            "product_name_alias_history",
            {
                "tenant_id": own["id"],
                "customer_id": own["customer_id"],
                "customer_name_snapshot": "株式会社サンプル工業",
                "product_id": merge["id"],
                "product_name_snapshot": MERGE_NAME,
                "raw_text": "10φ×20 SUS100",
                "changed_by": auth_user_id,
                "action": "created",
                "source_order_label_snapshot": "製品マスタからの直接修正",
            },
        )[0]["id"]
        _insert(
            admin_db,
            "order_process_progress",
            {
                "tenant_id": own["id"],
                "order_id": merge_order,
                "process_routing_id": merge["routings"][1],
                "good_qty": 5,
                "status": "in_progress",
                "computed_at": datetime.now(UTC).isoformat(),
            },
        )

        # ユーザー JWT で事前チェック（RLS 下のクエリ）
        preview = load_merge_preview(
            real_supabase_client, own["id"], keep["id"], [merge["id"]]
        )
        assert preview.blockers == []
        assert [o.id for o in preview.deleted_orders] == [shipped_order]
        assert preview.counts.model_dump() == {
            "orders_reassigned": 1,
            "schedules_reassigned": 2,
            "aliases_reassigned": 1,
            "alias_history_reassigned": 1,
            "orders_deleted": 1,
            "routings_deleted": 2,
            "products_deleted": 1,
        }

        result = _merge(real_supabase_client, own, [shipped_order])

        assert result.data == preview.counts.model_dump()
        orders = {
            r["id"]: r
            for r in _rows(
                admin_db.table("orders")
                .select("id, product_id")
                .eq("tenant_id", own["id"])
                .execute()
            )
        }
        assert orders == {
            keep_order: {"id": keep_order, "product_id": keep["id"]},
            merge_order: {"id": merge_order, "product_id": keep["id"]},
        }
        segments = _rows(
            admin_db.table("production_schedules")
            .select("process_routing_id, start_datetime, end_datetime")
            .eq("order_id", merge_order)
            .order("start_datetime")
            .execute()
        )
        assert [s["process_routing_id"] for s in segments] == [
            keep["routings"][1],
            keep["routings"][2],
        ]
        # 時刻は変えない（ガントの配置は変わらない）
        assert [datetime.fromisoformat(s["start_datetime"]) for s in segments] == [
            datetime.fromisoformat(start) for start, _ in SEGMENTS
        ]
        alias = _rows(
            admin_db.table("product_name_aliases")
            .select("product_id")
            .eq("id", alias_id)
            .execute()
        )
        assert alias == [{"product_id": keep["id"]}]
        history = _rows(
            admin_db.table("product_name_alias_history")
            .select("product_id")
            .eq("id", history_id)
            .execute()
        )
        assert history == [{"product_id": keep["id"]}]
        assert _product_ids(admin_db, own["id"]) == {keep["id"]}
        assert (
            _rows(
                admin_db.table("process_routings")
                .select("id")
                .eq("product_id", merge["id"])
                .execute()
            )
            == []
        )
        assert (
            _rows(
                admin_db.table("order_process_progress")
                .select("order_id")
                .eq("tenant_id", own["id"])
                .execute()
            )
            == []
        )

    def test_order_conflict_after_preview_rolls_back(
        self, admin_db, real_supabase_client, tenants
    ):
        own = tenants["own"]
        keep, merge = own["keep"], own["merge"]
        _create_order(admin_db, own, keep["id"], "shipped", "2026-11-10")
        merge_order = _create_order(
            admin_db, own, merge["id"], "in_progress", "2026-11-10"
        )
        _schedule(
            admin_db,
            own["id"],
            merge_order,
            [merge["routings"][1], merge["routings"][2]],
        )

        preview = load_merge_preview(
            real_supabase_client, own["id"], keep["id"], [merge["id"]]
        )
        assert [(b.reason, b.order_id) for b in preview.blockers] == [
            ("order_conflict", merge_order)
        ]

        # 事前チェックを経ずに実行しても UNIQUE 違反で全体が失敗する
        with pytest.raises(APIError) as exc_info:
            _merge(real_supabase_client, own)

        assert exc_info.value.code == "23505"
        assert _product_ids(admin_db, own["id"]) == {keep["id"], merge["id"]}
        segments = _rows(
            admin_db.table("production_schedules")
            .select("process_routing_id")
            .eq("order_id", merge_order)
            .execute()
        )
        assert {s["process_routing_id"] for s in segments} == set(
            merge["routings"].values()
        )

    def test_routing_mismatch_rolls_back(self, admin_db, real_supabase_client, tenants):
        own = tenants["own"]
        keep = own["keep"]
        merge = _create_product(admin_db, own["id"], "φ10×L20 SUS100", (1, 3))
        own["merge"] = merge
        merge_order = _create_order(
            admin_db, own, merge["id"], "confirmed", "2026-11-20"
        )
        _schedule(
            admin_db,
            own["id"],
            merge_order,
            [merge["routings"][1], merge["routings"][3]],
        )

        preview = load_merge_preview(
            real_supabase_client, own["id"], keep["id"], [merge["id"]]
        )
        assert [(b.reason, b.sequence_order) for b in preview.blockers] == [
            ("routing_mismatch", 3)
        ]

        with pytest.raises(APIError) as exc_info:
            _merge(real_supabase_client, own)

        assert exc_info.value.code == "23503"
        order = _rows(
            admin_db.table("orders")
            .select("product_id")
            .eq("id", merge_order)
            .execute()
        )
        assert order == [{"product_id": merge["id"]}]

    def test_stale_delete_plan_rolls_back(
        self, admin_db, real_supabase_client, tenants
    ):
        own = tenants["own"]
        keep, merge = own["keep"], own["merge"]
        _create_order(admin_db, own, keep["id"], "confirmed", "2026-11-10")
        # 事前チェック後に出荷済みから戻された受注は削除しない
        reverted = _create_order(admin_db, own, merge["id"], "confirmed", "2026-11-10")

        with pytest.raises(APIError) as exc_info:
            _merge(real_supabase_client, own, [reverted])

        assert exc_info.value.code == "P0001"
        assert _rows(
            admin_db.table("orders").select("id").eq("id", reverted).execute()
        ) == [{"id": reverted}]

    @pytest.mark.parametrize("role", ["order_handler", "iso_officer"])
    def test_requires_president(
        self, admin_db, real_supabase_client, auth_user_id, tenants, role
    ):
        own = tenants["own"]
        _set_role(admin_db, own["id"], auth_user_id, role)

        with pytest.raises(APIError) as exc_info:
            _merge(real_supabase_client, own)

        assert exc_info.value.code == "42501"
        assert _product_ids(admin_db, own["id"]) == {
            own["keep"]["id"],
            own["merge"]["id"],
        }

    def test_other_tenant_products_not_found(self, real_supabase_client, tenants):
        own, other = tenants["own"], tenants["other"]

        with pytest.raises(APIError) as exc_info:
            real_supabase_client.rpc(
                "merge_products",
                {
                    "p_tenant_id": own["id"],
                    "p_keep_product_id": own["keep"]["id"],
                    "p_merge_product_ids": [other["merge"]["id"]],
                },
            ).execute()

        assert exc_info.value.code == "P0002"

    def test_other_tenant_is_forbidden(self, real_supabase_client, tenants):
        with pytest.raises(APIError) as exc_info:
            _merge(real_supabase_client, tenants["other"])

        assert exc_info.value.code == "42501"


@pytest.mark.integration
class TestMergeProductsApi:
    def test_candidates_preview_and_merge_with_user_jwt(
        self, admin_db, auth_token, tenants
    ):
        own = tenants["own"]
        keep, merge = own["keep"], own["merge"]
        # 接頭辞が違う同仕様の製品は候補に出るが統合できない
        prefixed = _create_product(admin_db, own["id"], "A社φ10×20L SUS100", (1,))
        _create_order(admin_db, own, keep["id"], "confirmed", "2026-11-10")
        conflicting = _create_order(admin_db, own, merge["id"], "draft", "2026-11-10")
        client = TestClient(app)
        headers = {"Authorization": f"Bearer {auth_token}", "x-tenant-id": own["id"]}

        res = client.get("/products/merge-groups", headers=headers)
        assert res.status_code == 200
        assert res.json()["groups"] == [
            {
                "diameter": "10",
                "length": "20",
                "material": "SUS100",
                "product_count": 3,
                "mergeable": True,
                "product_names": [KEEP_NAME, MERGE_NAME, "A社φ10×20L SUS100"],
            }
        ]

        res = client.get(
            "/products/merge-candidates",
            params={"diameter": "10.00", "length": "20", "material": "ｓｕｓ-100"},
            headers=headers,
        )
        assert res.status_code == 200
        body = res.json()
        assert {c["id"] for c in body["candidates"]} == {
            keep["id"],
            merge["id"],
            prefixed["id"],
        }
        assert body["default_keep_product_id"] is None
        assert {c["id"]: c["prefix"] for c in body["candidates"]}[
            prefixed["id"]
        ] == "A社"

        payload = {
            "keep_product_id": keep["id"],
            "merge_product_ids": [merge["id"], prefixed["id"]],
        }
        res = client.post("/products/merge", json=payload, headers=headers)
        assert res.status_code == 409
        detail = res.json()["detail"]
        assert detail["error"] == "merge_blocked"
        assert sorted((b["reason"], b.get("order_id")) for b in detail["blockers"]) == [
            ("order_conflict", conflicting),
            ("prefix_mismatch", None),
        ]

        # 衝突を手作業で解消（ここでは納期を変える）すれば統合できる
        admin_db.table("orders").update({"deadline_date": "2026-11-11"}).eq(
            "id", conflicting
        ).execute()
        payload["merge_product_ids"] = [merge["id"]]
        res = client.post("/products/merge/preview", json=payload, headers=headers)
        assert res.status_code == 200
        assert res.json()["blockers"] == []

        res = client.post("/products/merge", json=payload, headers=headers)
        assert res.status_code == 200
        assert res.json()["orders_reassigned"] == 1
        assert _product_ids(admin_db, own["id"]) == {keep["id"], prefixed["id"]}


@pytest.mark.integration
class TestAliasHistoryUpdatePolicy:
    @pytest.fixture()
    def history_id(self, admin_db, auth_user_id, tenants):
        own = tenants["own"]
        return _insert(
            admin_db,
            "product_name_alias_history",
            {
                "tenant_id": own["id"],
                "customer_id": own["customer_id"],
                "customer_name_snapshot": "株式会社サンプル工業",
                "product_id": own["merge"]["id"],
                "product_name_snapshot": MERGE_NAME,
                "raw_text": "表記A",
                "changed_by": auth_user_id,
                "action": "created",
                "source_order_label_snapshot": "製品マスタからの直接修正",
            },
        )[0]["id"]

    def _product_id(self, admin_db, history_id):
        return _rows(
            admin_db.table("product_name_alias_history")
            .select("product_id")
            .eq("id", history_id)
            .execute()
        )[0]["product_id"]

    def test_president_can_update_product_id_only(
        self, admin_db, real_supabase_client, tenants, history_id
    ):
        keep_id = tenants["own"]["keep"]["id"]

        real_supabase_client.table("product_name_alias_history").update(
            {"product_id": keep_id}
        ).eq("id", history_id).execute()
        assert self._product_id(admin_db, history_id) == keep_id

        with pytest.raises(APIError) as exc_info:
            real_supabase_client.table("product_name_alias_history").update(
                {"raw_text": "書き換え"}
            ).eq("id", history_id).execute()
        assert exc_info.value.code == "42501"

    def test_order_handler_cannot_update(
        self, admin_db, real_supabase_client, auth_user_id, tenants, history_id
    ):
        own = tenants["own"]
        _set_role(admin_db, own["id"], auth_user_id, "order_handler")

        real_supabase_client.table("product_name_alias_history").update(
            {"product_id": own["keep"]["id"]}
        ).eq("id", history_id).execute()

        assert self._product_id(admin_db, history_id) == own["merge"]["id"]
