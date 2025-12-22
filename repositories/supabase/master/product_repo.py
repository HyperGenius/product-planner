# repositories/supabase/master/product_repo.py
from typing import List, Dict, Any, Optional
from repositories.supabase.common import BaseRepository, SupabaseTableName


class ProductRepository(BaseRepository):
    def __init__(self, client):
        super().__init__(client, SupabaseTableName.PRODUCTS.value)

    def get_routings_by_product(self, product_id: int) -> List[Dict[str, Any]]:
        """製品IDに紐づく工程順序を取得"""
        res = (
            self.client.table(SupabaseTableName.PROCESS_ROUTINGS.value)
            .select("*")
            .eq("product_id", product_id)
            .order("sequence_order")
            .execute()
        )
        return res.data or []

    def get_routing_by_id(self, routing_id: int) -> Optional[Dict[str, Any]]:
        """工程順序ID検索"""
        res = (
            self.client.table(SupabaseTableName.PROCESS_ROUTINGS.value)
            .select("*")
            .eq("id", routing_id)
            .single()
            .execute()
        )
        return res.data

    def create_routing(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """工程順序を新規作成"""
        res = (
            self.client.table(SupabaseTableName.PROCESS_ROUTINGS.value)
            .insert(data)
            .select()
            .single()
            .execute()
        )
        return res.data

    def update_routing(self, routing_id: int, data: Dict[str, Any]) -> Dict[str, Any]:
        """工程順序を更新"""
        res = (
            self.client.table(SupabaseTableName.PROCESS_ROUTINGS.value)
            .update(data)
            .eq("id", routing_id)
            .select()
            .single()
            .execute()
        )
        return res.data

    def delete_routing(self, routing_id: int) -> bool:
        """工程順序を削除"""
        res = (
            self.client.table(SupabaseTableName.PROCESS_ROUTINGS.value)
            .delete(count="exact")
            .eq("id", routing_id)
            .execute()
        )
        return res.count is not None and res.count > 0
