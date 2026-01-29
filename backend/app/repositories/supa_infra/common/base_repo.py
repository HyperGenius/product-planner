# repositories/supa_infra/common/base_repo.py
from typing import Any, Generic, TypeVar, cast

from postgrest.exceptions import APIError

from app.utils.logger import get_logger
from supabase import Client  # type: ignore

logger = get_logger(__name__)

T = TypeVar("T", bound=dict[str, Any])  # 型変数を定義


class BaseRepository(Generic[T]):
    """基本的なCRUD操作を共通化するための抽象クラス。"""

    def __init__(self, client: Client, table_name: str):
        """初期化"""
        self.client = client
        self.table_name = table_name

    def get_all(self) -> list[T]:
        """全件取得"""
        logger.info(f"Fetching all records from {self.table_name}")
        res = self.client.table(self.table_name).select("*").execute()

        if not res.data:
            return []

        return cast(list[T], res.data)

    def get_by_id(self, id: int) -> T | None:
        """ID指定で1件取得"""
        logger.info(f"Fetching record {id} from {self.table_name}")
        res = (
            self.client.table(self.table_name)
            .select("*")
            .eq("id", id)
            .single()
            .execute()
        )
        return cast(T, res.data)

    def create(self, data: dict[str, Any]) -> T:
        """新規作成 (Create)"""
        logger.info(f"Creating record in {self.table_name}")
        try:
            # select()を付けることで、生成されたIDを含むデータを返す
            res = self.client.table(self.table_name).insert(data).execute()
            # insertは配列を返すので、最初の要素を返す
            if res.data and len(res.data) > 0:
                return cast(T, res.data[0])
            raise ValueError("Failed to create record")
        except APIError as e:
            # 一意制約違反の場合は分かりやすいエラーメッセージを投げる
            if e.code == "23505":  # unique_violation
                # エラーメッセージから制約名を抽出
                error_msg = e.message or ""
                if "order_number" in error_msg:
                    raise ValueError("この注文番号は既に使用されています") from e
                raise ValueError(f"重複データ: {error_msg}") from e
            # その他のAPIエラーはそのまま再送出
            raise

    def update(self, id: int, data: dict[str, Any]) -> T:
        """更新 (Update / Patch) - 指定したフィールドのみ更新される"""
        logger.info(f"Updating record {id} in {self.table_name}")

        # .eq("id", id) だけだと、RLSによって「他社のID」を指定された場合に
        # エラーにならず「更新件数0」になることがあります。
        # 厳密にはここでも戻り値チェックが必要ですが、まずは今のままで十分動きます。

        res = self.client.table(self.table_name).update(data).eq("id", id).execute()
        # updateも配列を返すので、最初の要素を返す
        if res.data and len(res.data) > 0:
            return cast(T, res.data[0])
        raise ValueError(f"Failed to update record {id}")

    def delete(self, id: int) -> bool:
        """削除 (Delete)"""
        logger.info(f"Deleting record {id} from {self.table_name}")
        # count="exact" で削除された行数を確認できる
        # postgrest-pyの型定義ではCountMethod enumが要求されるが、文字列でも動作するためignoreする
        res = (
            self.client.table(self.table_name)
            .delete(count="exact")  # type: ignore
            .eq("id", id)
            .execute()
        )
        # countが1以上なら削除成功とみなす
        return res.count is not None and res.count > 0
