"""
Integration テスト: 設備の作成時に1台グループを作るトリガー (Issue #512)

工程ルーティングは設備グループしか参照できないので、設備を1台だけ指定するには
その設備だけをメンバーに持つ1台グループが要る。設備の INSERT と同じトランザクションで
1台グループを作るトリガー（ensure_solo_equipment_group / trg_create_solo_equipment_group、
supabase/migrations/20261009000000_create_solo_equipment_groups.sql）を追加した。
実際の INSERT が発火させるトリガーと RLS 込みの挙動なので integration tier で検証する。

実行:
  supabase start
  cd backend && pytest __tests__/integration/test_create_solo_equipment_group_trigger.py -v --run-integration
"""

from typing import Any, cast

import pytest


@pytest.fixture()
def tenant_id_for_solo_groups(admin_db, auth_user_id):
    """このテスト専用のテナントを作り、ログインユーザーをメンバーにする。"""
    res = (
        admin_db.table("tenants")
        .insert({"name": "integration test tenant (solo equipment groups)"})
        .execute()
    )
    tenant_id = cast(list[dict[str, Any]], res.data)[0]["id"]
    admin_db.table("organization_members").insert(
        {"user_id": auth_user_id, "tenant_id": tenant_id}
    ).execute()

    yield tenant_id

    # equipment_group_members は equipments / equipment_groups の ON DELETE CASCADE で消える
    admin_db.table("equipments").delete().eq("tenant_id", tenant_id).execute()
    admin_db.table("equipment_groups").delete().eq("tenant_id", tenant_id).execute()
    admin_db.table("organization_members").delete().eq("user_id", auth_user_id).eq(
        "tenant_id", tenant_id
    ).execute()
    admin_db.table("tenants").delete().eq("id", tenant_id).execute()


def _insert_equipment(client, tenant_id: str, **fields: Any) -> int:
    res = (
        client.table("equipments").insert({"tenant_id": tenant_id, **fields}).execute()
    )
    return cast(list[dict[str, Any]], res.data)[0]["id"]


def _insert_group(admin_db, tenant_id: str, name: str) -> int:
    res = (
        admin_db.table("equipment_groups")
        .insert({"tenant_id": tenant_id, "name": name})
        .execute()
    )
    return cast(list[dict[str, Any]], res.data)[0]["id"]


def _groups_of(admin_db, equipment_id: int) -> list[str]:
    """設備が所属するグループ名の一覧"""
    rows = (
        admin_db.table("equipment_group_members")
        .select("equipment_groups(name)")
        .eq("equipment_id", equipment_id)
        .execute()
        .data
    )
    return sorted(r["equipment_groups"]["name"] for r in rows)


@pytest.mark.integration
class TestCreateSoloEquipmentGroupTrigger:
    def test_user_jwt_insert_creates_group_named_by_display_name(
        self, real_supabase_client, admin_db, tenant_id_for_solo_groups
    ):
        """画面（ユーザー JWT）から作った設備にも、表示名（呼称優先）の1台グループができる"""
        equipment_id = _insert_equipment(
            real_supabase_client,
            tenant_id_for_solo_groups,
            name="25Tシングルクランクプレス",
            short_name="プレス25t",
        )

        assert _groups_of(admin_db, equipment_id) == ["プレス25t"]

    def test_service_role_insert_creates_group(
        self, admin_db, tenant_id_for_solo_groups
    ):
        """台帳反映スクリプト（service role）から作った設備にも1台グループができる"""
        equipment_id = _insert_equipment(
            admin_db, tenant_id_for_solo_groups, name="ボール盤"
        )

        assert _groups_of(admin_db, equipment_id) == ["ボール盤"]

    def test_shared_group_with_same_name_gets_suffixed_solo_group(
        self, admin_db, tenant_id_for_solo_groups
    ):
        """表示名と同名の共有グループがあるときは「（単独）」を付けた1台グループを作る"""
        tenant_id = tenant_id_for_solo_groups
        other_id = _insert_equipment(admin_db, tenant_id, name="プレスA")
        shared_id = _insert_group(admin_db, tenant_id, "プレス")
        admin_db.table("equipment_group_members").insert(
            {
                "tenant_id": tenant_id,
                "equipment_group_id": shared_id,
                "equipment_id": other_id,
            }
        ).execute()

        equipment_id = _insert_equipment(admin_db, tenant_id, name="プレス")

        assert _groups_of(admin_db, equipment_id) == ["プレス（単独）"]

    def test_empty_group_with_same_name_is_reused(
        self, admin_db, tenant_id_for_solo_groups
    ):
        """メンバー0台の同名グループ（削除した設備の残骸）は作り直さずに引き取る"""
        tenant_id = tenant_id_for_solo_groups
        group_id = _insert_group(admin_db, tenant_id, "成型研削機")

        equipment_id = _insert_equipment(admin_db, tenant_id, name="成型研削機")

        members = (
            admin_db.table("equipment_group_members")
            .select("equipment_group_id")
            .eq("equipment_id", equipment_id)
            .execute()
            .data
        )
        assert members == [{"equipment_group_id": group_id}]

    def test_ensure_is_idempotent(self, admin_db, tenant_id_for_solo_groups):
        """ensure_solo_equipment_group は何度呼んでもグループを増やさない"""
        equipment_id = _insert_equipment(
            admin_db, tenant_id_for_solo_groups, name="コンプレッサー"
        )
        first = admin_db.rpc(
            "ensure_solo_equipment_group", {"p_equipment_id": equipment_id}
        ).execute()
        second = admin_db.rpc(
            "ensure_solo_equipment_group", {"p_equipment_id": equipment_id}
        ).execute()

        assert first.data == second.data
        assert _groups_of(admin_db, equipment_id) == ["コンプレッサー"]
