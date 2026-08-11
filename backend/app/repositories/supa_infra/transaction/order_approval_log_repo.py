# repositories/supa_infra/transaction/order_approval_log_repo.py
from typing import Any, cast

from app.repositories.supa_infra.common import BaseRepository, SupabaseTableName


class OrderApprovalLogRepository(BaseRepository):
    def __init__(self, client):
        super().__init__(client, SupabaseTableName.ORDER_APPROVAL_LOG.value)

    def log_action(
        self,
        tenant_id: str,
        order_id: int,
        action: str,
        actor_user_id: str,
        reason: str | None = None,
    ) -> dict:
        """承認ワークフローの操作（依頼送信・承認・却下）を監査ログに記録する。"""
        return self.create(
            {
                "tenant_id": tenant_id,
                "order_id": order_id,
                "action": action,
                "actor_user_id": actor_user_id,
                "reason": reason,
            }
        )

    def get_all(self) -> list[dict]:
        """テナント内の承認監査ログを新しい順に全件取得する（RLSでテナント境界を強制）。"""
        res = (
            self.client.table(self.table_name)
            .select("*")
            .order("created_at", desc=True)
            .execute()
        )
        return cast(list[dict[str, Any]], res.data or [])

    def get_by_order_id(self, order_id: int) -> list[dict]:
        """特定注文の承認監査ログを新しい順に取得する。"""
        res = (
            self.client.table(self.table_name)
            .select("*")
            .eq("order_id", order_id)
            .order("created_at", desc=True)
            .execute()
        )
        return cast(list[dict[str, Any]], res.data or [])
