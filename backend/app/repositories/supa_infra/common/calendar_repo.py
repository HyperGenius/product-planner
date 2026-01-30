# repositories/supa_infra/common/calendar_repo.py
from datetime import date
from typing import Any, TypeVar, cast

from app.repositories.supa_infra.common.base_repo import BaseRepository
from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.utils.logger import get_logger

logger = get_logger(__name__)

T = TypeVar("T", bound=dict[str, Any])


class CalendarRepository(BaseRepository[T]):
    """稼働カレンダーリポジトリ"""

    def __init__(self, client):
        super().__init__(client, SupabaseTableName.WORK_CALENDARS.value)

    def get_holidays_in_range(
        self, start_date: date, end_date: date
    ) -> list[dict[str, Any]]:
        """
        指定期間内の休日情報を取得する。

        Args:
            start_date: 開始日
            end_date: 終了日

        Returns:
            休日情報のリスト（date, is_holiday, note を含む）
        """
        logger.info(
            f"Fetching holidays from {start_date} to {end_date} from {self.table_name}"
        )

        res = (
            self.client.table(self.table_name)
            .select("date, is_holiday, note")
            .gte("date", start_date.isoformat())
            .lte("date", end_date.isoformat())
            .execute()
        )

        return cast(list[dict[str, Any]], res.data if res.data else [])

    def get_holiday_by_date(self, target_date: date) -> dict[str, Any] | None:
        """
        指定日の休日情報を取得する。

        Args:
            target_date: 対象日

        Returns:
            休日情報（存在しない場合はNone）
        """
        logger.info(f"Fetching holiday for {target_date} from {self.table_name}")

        res = (
            self.client.table(self.table_name)
            .select("*")
            .eq("date", target_date.isoformat())
            .execute()
        )

        if res.data and len(res.data) > 0:
            return cast(dict[str, Any], res.data[0])
        return None

    def create_or_update_holiday(
        self,
        tenant_id: str,
        target_date: date,
        is_holiday: bool,
        note: str | None = None,
    ) -> dict[str, Any]:
        """
        指定日の休日情報を作成または更新する。

        Args:
            tenant_id: テナントID
            target_date: 対象日
            is_holiday: 休日フラグ
            note: 備考

        Returns:
            作成または更新された休日情報
        """
        logger.info(f"Upserting holiday for {target_date} in {self.table_name}")

        data: dict[str, Any] = {
            "tenant_id": tenant_id,
            "date": target_date.isoformat(),
            "is_holiday": is_holiday,
            "note": note,
        }

        # Supabaseのupsert機能を使用（conflict時は更新）
        res = (
            self.client.table(self.table_name)
            .upsert(data, on_conflict="tenant_id,date")
            .execute()
        )

        if res.data and len(res.data) > 0:
            return cast(dict[str, Any], res.data[0])
        raise ValueError(f"Failed to upsert holiday for {target_date}")
