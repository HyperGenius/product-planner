# repositories/supa_infra/master/equipment_repo.py
from typing import Any, TypeVar, cast

from postgrest.exceptions import APIError

from app.repositories.supa_infra.common import BaseRepository, SupabaseTableName

T = TypeVar("T", bound=dict[str, Any])  # 型変数を定義


class EquipmentRepository(BaseRepository[T]):
    def __init__(self, client):
        super().__init__(client, SupabaseTableName.EQUIPMENTS.value)

    # --- Equipment Groups (別テーブル操作) ---

    def get_all_groups(self) -> list[T]:
        """設備グループのリストを取得する。"""
        res = (
            self.client.table(SupabaseTableName.EQUIPMENT_GROUPS.value)
            .select("*")
            .execute()
        )
        return cast(list[T], res.data)

    def create_group(self, data: dict[str, Any]) -> T:
        """設備グループを新規作成"""
        res = (
            self.client.table(SupabaseTableName.EQUIPMENT_GROUPS.value)
            .insert(data)
            .execute()
        )
        return cast(T, res.data)

    def get_group_by_id(self, group_id: int) -> T | None:
        """設備グループID検索"""
        res = (
            self.client.table(SupabaseTableName.EQUIPMENT_GROUPS.value)
            .select("*")
            .eq("id", group_id)
            .single()
            .execute()
        )
        return cast(T, res.data)

    def update_group(self, group_id: int, data: dict[str, Any]) -> T:
        """設備グループ更新"""
        res = (
            self.client.table(SupabaseTableName.EQUIPMENT_GROUPS.value)
            .update(data)
            .eq("id", group_id)
            .execute()
        )
        return cast(T, res.data)

    def delete_group(self, group_id: int) -> bool:
        """設備グループ削除"""
        res = (
            self.client.table(SupabaseTableName.EQUIPMENT_GROUPS.value)
            # postgrest-pyの型定義ではCountMethod enumが要求されるが、文字列でも動作するためignoreする
            .delete(count="exact")  # type: ignore
            .eq("id", group_id)
            .execute()
        )
        return res.count is not None and res.count > 0

    # --- Group Members (交差テーブル操作) ---

    def add_machine_to_group(self, group_id: int, equipment_id: int, tenant_id: str):
        """グループに機械を追加"""
        try:
            response = (
                self.client.table(SupabaseTableName.EQUIPMENT_GROUP_MEMBERS.value)
                .insert(
                    {
                        "tenant_id": tenant_id,
                        "equipment_group_id": group_id,
                        "equipment_id": equipment_id,
                    }
                )
                .execute()
            )
            return response.data

        except APIError as e:
            # Postgresの重複エラーコードは "23505"
            if e.code == "23505" or "duplicate key" in e.message:  # type: ignore
                # 重複エラーの場合、Noneを返してルーター側で409を返す
                return None

            # 想定外のエラーはそのまま上に投げる
            raise e

    def remove_machine_from_group(self, group_id: int, equipment_id: int):
        """グループから機械を削除"""
        return (
            self.client.table(SupabaseTableName.EQUIPMENT_GROUP_MEMBERS.value)
            # postgrest-pyの型定義ではCountMethod enumが要求されるが、文字列でも動作するためignoreする
            .delete(count="exact")  # type: ignore
            .eq("equipment_group_id", group_id)
            .eq("equipment_id", equipment_id)
            .execute()
        )

    def get_members_by_group_id(self, group_id: int) -> list[T]:
        """設備グループに所属する設備一覧を取得"""
        res = (
            self.client.table(SupabaseTableName.EQUIPMENT_GROUP_MEMBERS.value)
            .select("equipments(*)")
            .eq("equipment_group_id", group_id)
            .execute()
        )

        # ネストされたequipmentsを展開して返す
        # RLSなどで参照できない場合はNoneになる可能性があるためチェックする
        data = cast(list[dict[str, Any]], res.data)
        equipments = [item["equipments"] for item in data if item.get("equipments")]
        return cast(list[T], equipments)
