# repositories/supabase/transaction/order_repo.py
from repositories.supabase.common import BaseRepository, SupabaseTableName


class OrderRepository(BaseRepository):
    def __init__(self, client):
        super().__init__(client, SupabaseTableName.ORDERS.value)

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
