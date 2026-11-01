"""
Integration テスト: 重複顧客の統合 RPC merge_customers (Issue #610)

以下は実際の Postgres (RLS込み) でしか検証できないため integration tier に置く。
- ユーザー JWT（SECURITY INVOKER）で注文・添付・別名・別名履歴・顧客別名・抽出指示の履歴・担当者が
  残す顧客へ付け替わり、統合される側の顧客が削除され、統合の履歴が残ること
- 製品の別名の UNIQUE は統合先を優先して統合される側を捨てること
- 事前チェック（load_merge_preview）の後に受注の重複が生じた場合、制約違反で全体が失敗し何も変わらないこと
- president / platform_admin 以外・所属しないテナントの顧客では実行できないこと
- daily_report_unallocated_actuals の付け替えは、日報の取り込み一式（エージェントトークン・ファイル・明細）が
  要るためここでは扱わない（UPDATE の列 GRANT / ポリシーは customer_extraction_prompt_history と同じ形）

実行:
  supabase start
  cd backend && pytest __tests__/integration/test_merge_customers.py -v --run-integration
"""

from typing import Any, cast

import pytest
from app.services.customer_merge_service import load_merge_preview
from postgrest.exceptions import APIError


def _rows(res) -> list[dict[str, Any]]:
    return cast(list[dict[str, Any]], res.data)


def _insert(admin_db, table: str, values: dict[str, Any] | list[dict[str, Any]]):
    return _rows(admin_db.table(table).insert(values).execute())


def _set_role(admin_db, tenant_id: str, user_id: str, role: str) -> None:
    admin_db.table("organization_members").update({"role": role}).eq(
        "tenant_id", tenant_id
    ).eq("user_id", user_id).execute()


def _create_order(
    admin_db, tenant_id: str, customer_id: int, product_id: int, deadline: str
) -> int:
    return _insert(
        admin_db,
        "orders",
        {
            "tenant_id": tenant_id,
            "product_id": product_id,
            "customer_id": customer_id,
            "quantity": 10,
            "status": "draft",
            "deadline_date": deadline,
            "order_date": "2026-10-01T00:00:00+09:00",
        },
    )[0]["id"]


@pytest.fixture()
def tenants(admin_db, auth_user_id):
    """ログインユーザーが president として所属する own と、所属しない other を作る。"""
    ids: dict[str, dict[str, Any]] = {}
    for key in ("own", "other"):
        tenant_id = _insert(
            admin_db, "tenants", {"name": f"integration test merge customers ({key})"}
        )[0]["id"]
        customers = _insert(
            admin_db,
            "customers",
            [
                {
                    "tenant_id": tenant_id,
                    "name": "顧客A社",
                    "email": "keep@example.com",
                },
                {
                    "tenant_id": tenant_id,
                    "name": "顧客A社 担当X",
                    "email": "X@Example.com",
                },
            ],
        )
        product_id = _insert(
            admin_db,
            "products",
            {"tenant_id": tenant_id, "name": "φ10×20L SUS100", "code": None},
        )[0]["id"]
        ids[key] = {
            "id": tenant_id,
            "keep": customers[0]["id"],
            "merge": customers[1]["id"],
            "product_id": product_id,
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
            "customer_merge_log",
            "customer_extraction_prompt_history",
            "customer_name_aliases",
            "product_name_alias_history",
            "product_name_aliases",
            "order_attachments",
            "orders",
            "customer_contacts",
            "products",
            "customers",
        ):
            admin_db.table(table).delete().eq("tenant_id", tid).execute()
    admin_db.table("organization_members").delete().eq("user_id", auth_user_id).eq(
        "tenant_id", ids["own"]["id"]
    ).execute()
    for tenant in ids.values():
        admin_db.table("tenants").delete().eq("id", tenant["id"]).execute()


def _merge(client, tenant: dict[str, Any]):
    return client.rpc(
        "merge_customers",
        {
            "p_tenant_id": tenant["id"],
            "p_keep_customer_id": tenant["keep"],
            "p_merge_customer_ids": [tenant["merge"]],
        },
    ).execute()


def _customer_ids(admin_db, tenant_id: str) -> set[int]:
    return {
        r["id"]
        for r in _rows(
            admin_db.table("customers")
            .select("id")
            .eq("tenant_id", tenant_id)
            .execute()
        )
    }


@pytest.mark.integration
class TestMergeCustomers:
    def test_reassigns_and_deletes(
        self, admin_db, real_supabase_client, auth_user_id, tenants
    ):
        own = tenants["own"]
        keep, merge, tid = own["keep"], own["merge"], own["id"]
        keep_order = _create_order(admin_db, tid, keep, own["product_id"], "2026-11-10")
        merge_order = _create_order(
            admin_db, tid, merge, own["product_id"], "2026-11-20"
        )
        staging_id = _insert(
            admin_db,
            "order_attachments",
            {
                "tenant_id": tid,
                "customer_id": merge,
                "original_filename": "order.pdf",
                "storage_path": f"{tid}/staging/order.pdf",
            },
        )[0]["id"]
        # 同じ表記は統合先を優先して統合される側を捨てる。違う表記は付け替える
        for customer_id, raw in ((keep, "共通"), (merge, "共通"), (merge, "担当X用")):
            _insert(
                admin_db,
                "product_name_aliases",
                {
                    "tenant_id": tid,
                    "customer_id": customer_id,
                    "product_id": own["product_id"],
                    "raw_text": raw,
                    "created_by": auth_user_id,
                },
            )
        history_id = _insert(
            admin_db,
            "product_name_alias_history",
            {
                "tenant_id": tid,
                "customer_id": merge,
                "customer_name_snapshot": "顧客A社 担当X",
                "product_id": own["product_id"],
                "product_name_snapshot": "φ10×20L SUS100",
                "raw_text": "担当X用",
                "changed_by": auth_user_id,
                "action": "created",
                "source_order_label_snapshot": "製品マスタからの直接修正",
            },
        )[0]["id"]
        customer_alias_id = _insert(
            admin_db,
            "customer_name_aliases",
            {
                "tenant_id": tid,
                "customer_id": merge,
                "raw_text": "A社X",
                "created_by": auth_user_id,
            },
        )[0]["id"]
        prompt_history_ids = [
            r["id"]
            for r in _insert(
                admin_db,
                "customer_extraction_prompt_history",
                {"tenant_id": tid, "customer_id": merge, "prompt": "指示"},
            )
        ]
        # customers.email のうち担当者に無いものは担当者として移る
        _insert(
            admin_db,
            "customer_contacts",
            {"tenant_id": tid, "customer_id": keep, "email": "keep@example.com"},
        )

        preview = load_merge_preview(real_supabase_client, tid, keep, [merge])
        assert preview.blockers == []
        assert preview.counts.model_dump() == {
            "orders_reassigned": 1,
            "attachments_reassigned": 1,
            "aliases_reassigned": 1,
            "aliases_dropped": 1,
            "alias_history_reassigned": 1,
            "customer_aliases_reassigned": 1,
            "unallocated_actuals_reassigned": 0,
            "prompt_history_reassigned": 1,
            "contacts_reassigned": 1,
            "customers_deleted": 1,
        }

        result = _merge(real_supabase_client, own)

        assert result.data == preview.counts.model_dump()
        assert _customer_ids(admin_db, tid) == {keep}
        orders = {
            r["id"]: r["customer_id"]
            for r in _rows(
                admin_db.table("orders")
                .select("id, customer_id")
                .eq("tenant_id", tid)
                .execute()
            )
        }
        assert orders == {keep_order: keep, merge_order: keep}
        assert _rows(
            admin_db.table("order_attachments")
            .select("customer_id")
            .eq("id", staging_id)
            .execute()
        ) == [{"customer_id": keep}]
        aliases = _rows(
            admin_db.table("product_name_aliases")
            .select("customer_id, raw_text")
            .eq("tenant_id", tid)
            .order("raw_text")
            .execute()
        )
        assert aliases == [
            {"customer_id": keep, "raw_text": "共通"},
            {"customer_id": keep, "raw_text": "担当X用"},
        ]
        for table, row_id in (
            ("product_name_alias_history", history_id),
            ("customer_name_aliases", customer_alias_id),
            ("customer_extraction_prompt_history", prompt_history_ids[0]),
        ):
            assert _rows(
                admin_db.table(table).select("customer_id").eq("id", row_id).execute()
            ) == [{"customer_id": keep}], table
        contacts = {
            r["email"]: r["customer_id"]
            for r in _rows(
                admin_db.table("customer_contacts")
                .select("email, customer_id")
                .eq("tenant_id", tid)
                .execute()
            )
        }
        assert contacts == {"keep@example.com": keep, "x@example.com": keep}

        log = _rows(
            admin_db.table("customer_merge_log")
            .select(
                "keep_customer_id, keep_customer_name, merged_customers, counts, merged_by"
            )
            .eq("tenant_id", tid)
            .execute()
        )
        assert len(log) == 1
        assert log[0]["keep_customer_id"] == keep
        assert log[0]["keep_customer_name"] == "顧客A社"
        assert log[0]["merged_customers"][0]["id"] == merge
        assert log[0]["merged_customers"][0]["name"] == "顧客A社 担当X"
        assert log[0]["counts"] == result.data
        assert log[0]["merged_by"] == auth_user_id

    def test_order_conflict_after_preview_rolls_back(
        self, admin_db, real_supabase_client, tenants
    ):
        own = tenants["own"]
        tid = own["id"]
        _create_order(admin_db, tid, own["keep"], own["product_id"], "2026-11-10")
        # プレビューの後に同じ製品・納期の受注が入った状況を再現する
        preview = load_merge_preview(
            real_supabase_client, tid, own["keep"], [own["merge"]]
        )
        assert preview.blockers == []
        merge_order = _create_order(
            admin_db, tid, own["merge"], own["product_id"], "2026-11-10"
        )

        with pytest.raises(APIError) as exc_info:
            _merge(real_supabase_client, own)

        assert exc_info.value.code == "23505"
        assert _customer_ids(admin_db, tid) == {own["keep"], own["merge"]}
        assert _rows(
            admin_db.table("orders")
            .select("customer_id")
            .eq("id", merge_order)
            .execute()
        ) == [{"customer_id": own["merge"]}]
        assert (
            _rows(
                admin_db.table("customer_merge_log")
                .select("id")
                .eq("tenant_id", tid)
                .execute()
            )
            == []
        )

    def test_preview_reports_order_conflict(
        self, admin_db, real_supabase_client, tenants
    ):
        own = tenants["own"]
        tid = own["id"]
        keep_order = _create_order(
            admin_db, tid, own["keep"], own["product_id"], "2026-11-10"
        )
        merge_order = _create_order(
            admin_db, tid, own["merge"], own["product_id"], "2026-11-10"
        )

        preview = load_merge_preview(
            real_supabase_client, tid, own["keep"], [own["merge"]]
        )

        assert [(b.order_id, b.conflicting_order_id) for b in preview.blockers] == [
            (merge_order, keep_order)
        ]

    @pytest.mark.parametrize("role", ["order_handler", "iso_officer"])
    def test_other_roles_cannot_merge(
        self, admin_db, real_supabase_client, auth_user_id, tenants, role
    ):
        own = tenants["own"]
        _set_role(admin_db, own["id"], auth_user_id, role)

        with pytest.raises(APIError) as exc_info:
            _merge(real_supabase_client, own)

        assert exc_info.value.code == "42501"
        assert _customer_ids(admin_db, own["id"]) == {own["keep"], own["merge"]}

    def test_platform_admin_can_merge(
        self, admin_db, real_supabase_client, auth_user_id, tenants
    ):
        own = tenants["own"]
        _set_role(admin_db, own["id"], auth_user_id, "platform_admin")

        _merge(real_supabase_client, own)

        assert _customer_ids(admin_db, own["id"]) == {own["keep"]}

    def test_other_tenant_cannot_merge(self, admin_db, real_supabase_client, tenants):
        other = tenants["other"]

        with pytest.raises(APIError) as exc_info:
            _merge(real_supabase_client, other)

        assert exc_info.value.code == "42501"
        assert _customer_ids(admin_db, other["id"]) == {other["keep"], other["merge"]}
