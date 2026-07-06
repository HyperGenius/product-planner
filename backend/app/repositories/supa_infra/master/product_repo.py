# repositories/supa_infra/master/product_repo.py
from typing import Any, TypeVar, cast

from app.repositories.supa_infra.common import BaseRepository, SupabaseTableName

T = TypeVar("T", bound=dict[str, Any])  # 型変数を定義


class ProductRepository(BaseRepository[T]):
    def __init__(self, client):
        super().__init__(client, SupabaseTableName.PRODUCTS.value)

    def get_all(self) -> list[T]:
        """製品を全件取得。process_routings の有無・確定状況を
        has_process / has_unconfirmed_process フラグとして付与する。"""
        res = (
            self.client.table(SupabaseTableName.PRODUCTS.value)
            .select(f"*, {SupabaseTableName.PROCESS_ROUTINGS.value}(id, is_confirmed)")
            .execute()
        )
        result: list[dict[str, Any]] = []
        for item in res.data or []:
            row = cast(dict[str, Any], item)
            routings = row.pop(SupabaseTableName.PROCESS_ROUTINGS.value, None) or []
            row["has_process"] = len(routings) > 0
            row["has_unconfirmed_process"] = any(
                not r.get("is_confirmed", False) for r in routings
            )
            result.append(row)
        return cast(list[T], result)

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
        # insertは配列を返すので、最初の要素を返す
        if res.data and len(res.data) > 0:
            return cast(T, res.data[0])
        raise ValueError("Failed to create routing")

    def update_routing(self, routing_id: int, data: dict[str, Any]) -> T:
        """工程順序を更新"""
        res = (
            self.client.table(SupabaseTableName.PROCESS_ROUTINGS.value)
            .update(data)
            .eq("id", routing_id)
            .execute()
        )
        # updateも配列を返すので、最初の要素を返す
        if res.data and len(res.data) > 0:
            return cast(T, res.data[0])
        raise ValueError(f"Failed to update routing {routing_id}")

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

    def replace_routings_for_product(
        self, product_id: int, tenant_id: str, items: list[dict[str, Any]]
    ) -> list[T]:
        """製品の工程セット全体を一括で置き換える（追加・更新・削除・並べ替えの一括保存用）。

        items に id を含むものは既存工程の更新、id が無いものは新規作成として扱う。
        既存工程のうち items に含まれない id は削除する。
        is_confirmed / confirmed_by / confirmed_at は変更しない（確定操作は別APIで行う）。
        """
        existing = self.get_routings_by_product(product_id)
        existing_ids = {cast(int, r["id"]) for r in existing}
        incoming_ids = {item["id"] for item in items if item.get("id") is not None}

        for routing_id in existing_ids - incoming_ids:
            self.delete_routing(routing_id)

        for item in items:
            data = dict(item)
            routing_id = data.pop("id", None)
            if routing_id is not None:
                if routing_id not in existing_ids:
                    raise ValueError(
                        f"工程ID {routing_id} は製品 {product_id} に属していません"
                    )
                self.update_routing(routing_id, data)
            else:
                data["product_id"] = product_id
                data["tenant_id"] = tenant_id
                self.create_routing(data)

        return self.get_routings_by_product(product_id)

    def get_routings_confirmed_status(self, product_id: int) -> bool:
        """製品の全工程が確定済みかどうかを返す。工程が0件の場合は False。"""
        routings = self.get_routings_by_product(product_id)
        if not routings:
            return False
        return all(r.get("is_confirmed", False) for r in routings)

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

    def get_unconfirmed_routing_counts(self, product_ids: list[int]) -> dict[int, int]:
        """製品IDごとの未確定工程数を返す"""
        from collections import Counter

        if not product_ids:
            return {}
        res = (
            self.client.table(SupabaseTableName.PROCESS_ROUTINGS.value)
            .select("product_id")
            .in_("product_id", product_ids)
            .eq("is_confirmed", False)
            .execute()
        )
        rows = cast(list[dict[str, Any]], res.data or [])
        counts: Counter[int] = Counter(r["product_id"] for r in rows)
        return {pid: counts.get(pid, 0) for pid in product_ids}
