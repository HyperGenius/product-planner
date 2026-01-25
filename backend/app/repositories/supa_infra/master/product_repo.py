# repositories/supa_infra/master/product_repo.py
from typing import Any, TypeVar, cast

from app.repositories.supa_infra.common import BaseRepository, SupabaseTableName

T = TypeVar("T", bound=dict[str, Any])  # 型変数を定義


class ProductRepository(BaseRepository[T]):
    def __init__(self, client):
        super().__init__(client, SupabaseTableName.PRODUCTS.value)

    def get_routings_by_product(self, product_id: int) -> list[T]:
        """製品IDに紐づく工程順序を取得"""
        res = (
            self.client.table(SupabaseTableName.PROCESS_ROUTINGS.value)
            .select("*")
            .eq("product_id", product_id)
            .order("sequence_order")
            .execute()
        )
        return cast(list[T], res.data)

    def get_routing_by_id(self, routing_id: int) -> T | None:
        """工程順序ID検索"""
        res = (
            self.client.table(SupabaseTableName.PROCESS_ROUTINGS.value)
            .select("*")
            .eq("id", routing_id)
            .single()
            .execute()
        )
        return cast(T, res.data)

    def create_routing(self, data: dict[str, Any]) -> T:
        """工程順序を新規作成"""
        res = (
            self.client.table(SupabaseTableName.PROCESS_ROUTINGS.value)
            .insert(data)
            .execute()
        )
        return cast(T, res.data)

    def update_routing(self, routing_id: int, data: dict[str, Any]) -> T:
        """工程順序を更新"""
        res = (
            self.client.table(SupabaseTableName.PROCESS_ROUTINGS.value)
            .update(data)
            .eq("id", routing_id)
            .execute()
        )
        return cast(T, res.data)

    def delete_routing(self, routing_id: int) -> bool:
        """工程順序を削除"""
        res = (
            self.client.table(SupabaseTableName.PROCESS_ROUTINGS.value)
            # postgrest-pyの型定義ではCountMethod enumが要求されるが、文字列でも動作するためignoreする
            .delete(count="exact")  # type: ignore
            .eq("id", routing_id)
            .execute()
        )
        return res.count is not None and res.count > 0

    def get_process_name(self, routing_id: int) -> str:
        """Routing IDから工程名を取得"""
        try:
            res = (
                self.client.table(SupabaseTableName.PROCESS_ROUTINGS.value)
                .select("process_name")
                .eq("id", routing_id)
                .single()
                .execute()
            )
            if res.data and isinstance(res.data, dict):
                return str(res.data.get("process_name", "不明"))
            return "不明"
        except Exception:
            return "不明"
