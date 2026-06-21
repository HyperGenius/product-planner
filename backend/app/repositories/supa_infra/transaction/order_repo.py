# repositories/supa_infra/transaction/order_repo.py
from typing import Any, cast

from app.repositories.supa_infra.common import BaseRepository, SupabaseTableName


class OrderRepository(BaseRepository):
    def __init__(self, client):
        super().__init__(client, SupabaseTableName.ORDERS.value)

    def get_all_with_routing_status(self) -> list[dict]:
        """全注文を has_unconfirmed_routings フラグ付きで取得（2クエリ、N+1なし）"""
        orders = self.get_all()
        if not orders:
            return []

        product_ids = list({o["product_id"] for o in orders if o.get("product_id")})
        res = (
            self.client.table(SupabaseTableName.PROCESS_ROUTINGS.value)
            .select("product_id, is_confirmed")
            .in_("product_id", product_ids)
            .execute()
        )
        routings = cast(list[dict[str, Any]], res.data or [])
        products_with_routings = {r["product_id"] for r in routings}
        products_with_unconfirmed = {
            r["product_id"] for r in routings if not r["is_confirmed"]
        }

        result = []
        for order in orders:
            pid = order.get("product_id")
            has_unconfirmed = (
                pid is None
                or pid not in products_with_routings
                or pid in products_with_unconfirmed
            )
            result.append({**order, "has_unconfirmed_routings": has_unconfirmed})
        return result

    def mark_as_scheduled(self, order_id: int) -> None:
        """
        注文をスケジュール済みとしてマークする。

        Args:
            order_id (int): スケジュール済みとしてマークする注文の一意の識別子。

        Raises:
            APIError: Supabase APIリクエストが失敗した場合。
        """
        self.client.table(self.table_name).update({"is_scheduled": True}).eq(
            "id", order_id
        ).execute()
