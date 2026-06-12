from typing import Any, cast

from app.repositories.supa_infra.common.base_repo import BaseRepository
from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.utils.logger import get_logger
from supabase import Client  # type: ignore

logger = get_logger(__name__)


class SchedulingSettingsRepository(BaseRepository):
    """スケジューリング設定リポジトリ"""

    def __init__(self, client: Client):
        super().__init__(client, SupabaseTableName.SCHEDULING_SETTINGS.value)

    def get(self, tenant_id: str) -> dict[str, Any] | None:
        """テナントのグローバルスケジューリング設定を取得する"""
        logger.info(f"Fetching scheduling settings for tenant {tenant_id}")
        res = (
            self.client.table(self.table_name)
            .select("*")
            .eq("tenant_id", tenant_id)
            .execute()
        )
        if res.data:
            return cast(dict[str, Any], res.data[0])
        return None

    def upsert(self, tenant_id: str, data: dict[str, Any]) -> dict[str, Any]:
        """テナントのグローバルスケジューリング設定を作成または更新する"""
        logger.info(f"Upserting scheduling settings for tenant {tenant_id}")
        payload = {"tenant_id": tenant_id, **data}
        res = (
            self.client.table(self.table_name)
            .upsert(payload, on_conflict="tenant_id")
            .execute()
        )
        if res.data and len(res.data) > 0:
            return cast(dict[str, Any], res.data[0])
        raise ValueError("Failed to upsert scheduling settings")
