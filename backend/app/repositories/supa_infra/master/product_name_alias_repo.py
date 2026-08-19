# repositories/supa_infra/master/product_name_alias_repo.py
from typing import Any, TypeVar, cast

from app.repositories.supa_infra.common import BaseRepository, SupabaseTableName

T = TypeVar("T", bound=dict[str, Any])


class ProductNameAliasHistoryRepository(BaseRepository[T]):
    """製品名の表記ゆれ修正履歴 (product_name_alias_history) のリポジトリ（Issue #347）。

    追記のみのテーブルのため create/get 系のみを提供する。
    """

    def __init__(self, client):
        super().__init__(client, SupabaseTableName.PRODUCT_NAME_ALIAS_HISTORY.value)

    def get_by_product_id(self, product_id: int) -> list[T]:
        """製品IDに紐づく修正履歴を新しい順に取得"""
        res = (
            self.client.table(self.table_name)
            .select("*")
            .eq("product_id", product_id)
            .order("changed_at", desc=True)
            .execute()
        )
        return cast(list[T], res.data or [])
