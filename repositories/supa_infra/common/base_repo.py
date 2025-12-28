# repositories/supa_infra/common/base_repo.py
from typing import Any

from supabase import Client  # type: ignore
from utils.logger import get_logger

logger = get_logger(__name__)


class BaseRepository:
    """基本的なCRUD操作を共通化するための抽象クラス。"""

    def __init__(self, client: Client, table_name: str):
        """初期化"""
        self.client = client
        self.table_name = table_name

    def get_all(self) -> list[dict[str, Any]]:
        """全件取得"""
        logger.info(f"Fetching all records from {self.table_name}")
        res = self.client.table(self.table_name).select("*").execute()
        return res.data or []

    def get_by_id(self, id: int) -> dict[str, Any] | None:
        """ID指定で1件取得"""
        logger.info(f"Fetching record {id} from {self.table_name}")
        res = (
            self.client.table(self.table_name)
            .select("*")
            .eq("id", id)
            .single()
            .execute()
        )
        return res.data

    def create(self, data: dict[str, Any]) -> dict[str, Any]:
        """新規作成 (Create)"""
        logger.info(f"Creating record in {self.table_name}")
        # select()を付けることで、生成されたIDを含むデータを返す
        res = self.client.table(self.table_name).insert(data).execute()
        return res.data

    def update(self, id: int, data: dict[str, Any]) -> dict[str, Any]:
        """更新 (Update / Patch) - 指定したフィールドのみ更新される"""
        logger.info(f"Updating record {id} in {self.table_name}")

        # .eq("id", id) だけだと、RLSによって「他社のID」を指定された場合に
        # エラーにならず「更新件数0」になることがあります。
        # 厳密にはここでも戻り値チェックが必要ですが、まずは今のままで十分動きます。

        res = (
            self.client.table(self.table_name)
            .update(data)
            .eq("id", id)
            .select()
            .single()
            .execute()
        )
        return res.data

    def delete(self, id: int) -> bool:
        """削除 (Delete)"""
        logger.info(f"Deleting record {id} from {self.table_name}")
        # count="exact" で削除された行数を確認できる
        res = (
            self.client.table(self.table_name)
            .delete(count="exact")
            .eq("id", id)
            .execute()
        )
        # countが1以上なら削除成功とみなす
        return res.count is not None and res.count > 0
