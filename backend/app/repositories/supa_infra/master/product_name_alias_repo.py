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


class ProductNameAliasRepository(BaseRepository[T]):
    """製品名の表記ゆれ辞書 (product_name_aliases) のリポジトリ（Issue #351）。

    製品マスタ画面からの別名の直接付け替え / 削除に使う。UPSERT を伴う注文経由の
    蓄積は services/product_alias_service.py 側が直接クライアントを叩く。
    """

    def __init__(self, client):
        super().__init__(client, SupabaseTableName.PRODUCT_NAME_ALIASES.value)

    def get_alias_by_id(self, alias_id: str) -> T | None:
        res = (
            self.client.table(self.table_name).select("*").eq("id", alias_id).execute()
        )
        rows = cast(list[T], res.data or [])
        return rows[0] if rows else None

    def update_product_id(self, alias_id: str, product_id: int) -> T | None:
        """向き先製品を付け替える。担当者による明示的な確認とみなし
        source も manual_correction へ更新する（Issue #351）。"""
        res = (
            self.client.table(self.table_name)
            .update({"product_id": product_id, "source": "manual_correction"})
            .eq("id", alias_id)
            .execute()
        )
        rows = cast(list[T], res.data or [])
        return rows[0] if rows else None

    def delete_by_id(self, alias_id: str) -> bool:
        res = self.client.table(self.table_name).delete().eq("id", alias_id).execute()
        return bool(res.data)
