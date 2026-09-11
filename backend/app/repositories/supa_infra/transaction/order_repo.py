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

        product_ids = list(
            {o["product_id"] for o in orders if o.get("product_id") is not None}
        )
        routings: list[dict[str, Any]] = []
        if product_ids:
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

    def get_status_transition_candidates(self, statuses: list[str]) -> list[dict]:
        """着手日ベースの自動遷移（Issue #400）の候補受注を取得する。

        指定ステータス（`confirmed` / `in_progress`）かつ superseded でない受注の
        `id` / `status` / `scheduling_start_date` のみを返す。cron から admin
        クライアントで呼ばれ、全テナント横断で取得する。
        """
        if not statuses:
            return []
        res = (
            self.client.table(self.table_name)
            .select("id, status, scheduling_start_date")
            .in_("status", statuses)
            .is_("superseded_at", "null")
            .execute()
        )
        return cast(list[dict[str, Any]], res.data or [])

    def bulk_update_status(self, order_ids: list[int], status: str) -> list[dict]:
        """複数注文のステータスを1リクエストでまとめて更新し、更新後の行を返す。

        1件ずつ update するとAPI呼び出しがN回になるため、`in_("id", ...)` で
        一括更新する（Issue #367）。空リストの場合はクエリを投げず空を返す。
        """
        if not order_ids:
            return []
        res = (
            self.client.table(self.table_name)
            .update({"status": status})
            .in_("id", order_ids)
            .execute()
        )
        return cast(list[dict[str, Any]], res.data or [])

    def find_dedupe_conflict(
        self,
        tenant_id: str,
        customer_id: int | None,
        product_id: int | None,
        deadline_date: str | None,
        extracted_product_name: str | None,
        exclude_order_id: int | None = None,
    ) -> dict | None:
        """dedupe 用 UNIQUE 制約に該当する既存行を1件返す（Issue #415 PR2）。

        23505 捕捉後、衝突先レコードをモーダルに表示するために呼ぶ想定。
        `orders_dedupe_key = (tenant_id, customer_id, product_id, deadline_date)`
        と、`product_id IS NULL` 用の部分 UNIQUE
        `orders_dedupe_key_unmatched_product = (tenant_id, customer_id, deadline_date,
        extracted_product_name)` のいずれの制約に該当するかを `product_id` の有無で
        判定する。どちらの制約も `deadline_date IS NOT NULL` の行にしか効かないため、
        `deadline_date` が None の場合は衝突しようがなく None を返す。
        """
        if customer_id is None or deadline_date is None:
            return None

        query = (
            self.client.table(self.table_name)
            .select("*")
            .eq("tenant_id", tenant_id)
            .eq("customer_id", customer_id)
            .eq("deadline_date", deadline_date)
        )
        if product_id is not None:
            query = query.eq("product_id", product_id)
        else:
            if extracted_product_name is None:
                return None
            query = query.is_("product_id", "null").eq(
                "extracted_product_name", extracted_product_name
            )
        if exclude_order_id is not None:
            query = query.neq("id", exclude_order_id)

        res = query.limit(1).execute()
        rows = cast(list[dict[str, Any]], res.data or [])
        return rows[0] if rows else None

    def mark_as_scheduled(
        self, order_id: int, simulated_deadline: str | None = None
    ) -> None:
        """
        注文をスケジュール済み（is_scheduled=True）としてマークする。

        Args:
            order_id (int): スケジュール済みとしてマークする注文の一意の識別子。
            simulated_deadline (str | None): シミュレーションが算出した完成見込み日
                （YYYY-MM-DD）。指定時は同一 UPDATE で simulated_deadline も保存する
                （Issue #394-A）。None のときは is_scheduled のみ更新する。

        Raises:
            APIError: Supabase APIリクエストが失敗した場合。
        """
        payload: dict[str, Any] = {"is_scheduled": True}
        if simulated_deadline is not None:
            payload["simulated_deadline"] = simulated_deadline
        self.client.table(self.table_name).update(payload).eq("id", order_id).execute()
