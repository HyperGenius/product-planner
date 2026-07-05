# repositories/supa_infra/transaction/order_repo.py
from typing import Any, cast

from app.repositories.supa_infra.common import BaseRepository, SupabaseTableName


class OrderRepository(BaseRepository):
    def __init__(self, client):
        super().__init__(client, SupabaseTableName.ORDERS.value)

    def get_all(self) -> list[dict]:
        """全件取得（superseded_at がセットされた注文は一覧から除外する）"""
        res = (
            self.client.table(self.table_name)
            .select("*")
            .is_("superseded_at", "null")
            .execute()
        )
        return cast(list[dict[str, Any]], res.data or [])

    def get_all_with_routing_status(self) -> list[dict]:
        """全注文を has_no_routings / has_unconfirmed_routings フラグ付きで取得（2クエリ、N+1なし）"""
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
            has_no_routings = pid is None or pid not in products_with_routings
            has_unconfirmed = has_no_routings or pid in products_with_unconfirmed
            result.append(
                {
                    **order,
                    "has_no_routings": has_no_routings,
                    "has_unconfirmed_routings": has_unconfirmed,
                }
            )
        return result

    def get_by_id_with_routing_status(self, order_id: int) -> dict | None:
        """注文を1件取得し has_no_routings / has_unconfirmed_routings フラグを付与"""
        order = self.get_by_id(order_id)
        if not order:
            return None
        pid = order.get("product_id")
        if pid is None:
            return {**order, "has_no_routings": True, "has_unconfirmed_routings": True}
        res = (
            self.client.table(SupabaseTableName.PROCESS_ROUTINGS.value)
            .select("product_id, is_confirmed")
            .eq("product_id", pid)
            .execute()
        )
        routings = cast(list[dict[str, Any]], res.data or [])
        has_no_routings = not routings
        has_unconfirmed = has_no_routings or any(
            not r["is_confirmed"] for r in routings
        )
        return {
            **order,
            "has_no_routings": has_no_routings,
            "has_unconfirmed_routings": has_unconfirmed,
        }

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
