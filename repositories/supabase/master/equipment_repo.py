# repositories/supabase/master/equipment_repo.py
from typing import List, Dict, Any, Optional
from repositories.supabase.common import BaseRepository, SupabaseTableName


class EquipmentRepository(BaseRepository):
    def __init__(self, client):
        super().__init__(client, SupabaseTableName.EQUIPMENTS.value)

    # --- Equipment Groups (別テーブル操作) ---

    def get_all_groups(self) -> List[Dict[str, Any]]:
        """設備グループのリストを取得する。"""
        res = (
            self.client.table(SupabaseTableName.EQUIPMENT_GROUPS.value)
            .select("*")
            .execute()
        )
        return res.data or []

    def create_group(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """設備グループを新規作成"""
        res = (
            self.client.table(SupabaseTableName.EQUIPMENT_GROUPS.value)
            .insert(data)
            .select()
            .single()
            .execute()
        )
        return res.data

    def get_group_by_id(self, group_id: int) -> Optional[Dict[str, Any]]:
        """設備グループID検索"""
        res = (
            self.client.table(SupabaseTableName.EQUIPMENT_GROUPS.value)
            .select("*")
            .eq("id", group_id)
            .single()
            .execute()
        )
        return res.data

    def update_group(self, group_id: int, data: Dict[str, Any]) -> Dict[str, Any]:
        """設備グループ更新"""
        res = (
            self.client.table(SupabaseTableName.EQUIPMENT_GROUPS.value)
            .update(data)
            .eq("id", group_id)
            .select()
            .single()
            .execute()
        )
        return res.data

    def delete_group(self, group_id: int) -> bool:
        """設備グループ削除"""
        res = (
            self.client.table(SupabaseTableName.EQUIPMENT_GROUPS.value)
            .delete(count="exact")
            .eq("id", group_id)
            .execute()
        )
        return res.count is not None and res.count > 0

    # --- Group Members (交差テーブル操作) ---

    def add_machine_to_group(self, group_id: int, equipment_id: int):
        """グループに機械を追加"""
        return (
            self.client.table(SupabaseTableName.EQUIPMENT_GROUP_MEMBERS.value)
            .insert({"equipment_group_id": group_id, "equipment_id": equipment_id})
            .execute()
        )

    def remove_machine_from_group(self, group_id: int, equipment_id: int):
        """グループから機械を削除"""
        return (
            self.client.table(SupabaseTableName.EQUIPMENT_GROUP_MEMBERS.value)
            .delete()
            .eq("equipment_group_id", group_id)
            .eq("equipment_id", equipment_id)
            .execute()
        )
