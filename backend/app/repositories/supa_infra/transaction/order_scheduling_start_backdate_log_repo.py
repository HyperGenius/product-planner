# repositories/supa_infra/transaction/order_scheduling_start_backdate_log_repo.py
from typing import Any, cast

from postgrest.types import ReturnMethod

from app.repositories.supa_infra.common import BaseRepository, SupabaseTableName


class OrderSchedulingStartBackdateLogRepository(BaseRepository):
    """作業開始日を過去日に設定した操作の監査ログ（Issue #372。追記専用）。"""

    def __init__(self, client):
        super().__init__(
            client, SupabaseTableName.ORDER_SCHEDULING_START_BACKDATE_LOG.value
        )

    def log_backdate(
        self,
        tenant_id: str,
        order_id: int,
        scheduling_start_date: str,
        actor_user_id: str,
        context: str,
    ) -> None:
        """過去日の作業開始日設定を記録する。

        書き込みだけを行うロール（president / platform_admin だが SELECT ポリシーの
        評価を避けたいケース）でも失敗しないよう `returning=minimal` で INSERT する
        （order_approval_log と同じ方針）。

        Args:
            context: "create"（起票時）または "update"（受注編集時）
        """
        self.client.table(self.table_name).insert(
            {
                "tenant_id": tenant_id,
                "order_id": order_id,
                "scheduling_start_date": scheduling_start_date,
                "actor_user_id": actor_user_id,
                "context": context,
            },
            returning=ReturnMethod.minimal,
        ).execute()

    def get_by_order_id(self, order_id: int) -> list[dict]:
        """特定注文の遡り設定ログを新しい順に取得する（監査用）。"""
        res = (
            self.client.table(self.table_name)
            .select("*")
            .eq("order_id", order_id)
            .order("created_at", desc=True)
            .execute()
        )
        return cast(list[dict[str, Any]], res.data or [])
