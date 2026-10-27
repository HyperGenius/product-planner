"""
Integration テスト: order_simulation_results（受注のシミュ結果のスナップショット）の RLS

手動シミュ（POST /orders/{id}/simulate）はユーザー JWT で upsert するため、
INSERT ... ON CONFLICT DO UPDATE が自テナントの受注にだけ通り、他テナントの受注には
書けない・見えないことを実際の Postgres で確かめる。

実行:
  supabase start
  cd backend && pytest __tests__/integration/test_order_simulation_results_rls.py -v --run-integration
"""

from typing import Any, cast

import pytest
from app.repositories.supa_infra.transaction.order_repo import OrderRepository
from postgrest.exceptions import APIError


def _result(process_name: str) -> dict[str, Any]:
    return {
        "calculated_deadline": "2099-09-20T17:00:00+09:00",
        "is_feasible": True,
        "process_schedules": [
            {
                "process_name": process_name,
                "start_time": "2099-09-18T09:00:00+09:00",
                "end_time": "2099-09-20T17:00:00+09:00",
                "equipment_name": None,
            }
        ],
    }


@pytest.fixture()
def sim_tenants(admin_db, auth_user_id):
    """ログインユーザーが所属する own テナントと所属しない other テナントに受注を1件ずつ作る。"""
    tenant_ids: dict[str, str] = {}
    order_ids: dict[str, int] = {}
    for key in ("own", "other"):
        tenant = (
            admin_db.table("tenants")
            .insert({"name": f"integration test simulation results ({key})"})
            .execute()
        )
        tenant_ids[key] = cast(list[dict[str, Any]], tenant.data)[0]["id"]
        order = (
            admin_db.table("orders")
            .insert({"tenant_id": tenant_ids[key], "quantity": 1})
            .execute()
        )
        order_ids[key] = cast(list[dict[str, Any]], order.data)[0]["id"]
    admin_db.table("organization_members").insert(
        {"user_id": auth_user_id, "tenant_id": tenant_ids["own"]}
    ).execute()

    yield {"tenant_ids": tenant_ids, "order_ids": order_ids}

    # order_simulation_results は orders の ON DELETE CASCADE で消える
    for key in ("own", "other"):
        admin_db.table("orders").delete().eq("tenant_id", tenant_ids[key]).execute()
    admin_db.table("organization_members").delete().eq("user_id", auth_user_id).eq(
        "tenant_id", tenant_ids["own"]
    ).execute()
    for key in ("own", "other"):
        admin_db.table("tenants").delete().eq("id", tenant_ids[key]).execute()


@pytest.mark.integration
class TestOrderSimulationResultsRls:
    def test_user_can_upsert_and_read_own_tenant_result(
        self, real_supabase_client, auth_session, sim_tenants
    ):
        """自テナントの受注には保存でき、再シミュで上書きされる。"""
        repo = OrderRepository(real_supabase_client)
        order_id = sim_tenants["order_ids"]["own"]
        tenant_id = sim_tenants["tenant_ids"]["own"]

        repo.save_simulation_result(order_id, tenant_id, _result("1回目"))
        repo.save_simulation_result(order_id, tenant_id, _result("2回目"))

        stored = repo.get_simulation_result(order_id)
        assert stored is not None
        assert stored["process_schedules"][0]["process_name"] == "2回目"

    def test_user_cannot_write_other_tenant_order(
        self, real_supabase_client, auth_session, sim_tenants
    ):
        """他テナントの受注には、tenant_id を自テナントに偽っても書けない。"""
        repo = OrderRepository(real_supabase_client)
        other_order_id = sim_tenants["order_ids"]["other"]

        for tenant_id in (
            sim_tenants["tenant_ids"]["other"],
            sim_tenants["tenant_ids"]["own"],
        ):
            with pytest.raises(APIError):
                repo.save_simulation_result(other_order_id, tenant_id, _result("偽装"))

    def test_user_cannot_read_other_tenant_result(
        self, admin_db, real_supabase_client, auth_session, sim_tenants
    ):
        """他テナントの受注のシミュ結果は見えない。"""
        other_order_id = sim_tenants["order_ids"]["other"]
        OrderRepository(admin_db).save_simulation_result(
            other_order_id, sim_tenants["tenant_ids"]["other"], _result("他社")
        )

        assert (
            OrderRepository(real_supabase_client).get_simulation_result(other_order_id)
            is None
        )
