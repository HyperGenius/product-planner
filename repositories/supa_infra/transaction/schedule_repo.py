# repositories/supabase_repo.py
from datetime import datetime
from typing import Any

from supabase import Client  # type: ignore


class ScheduleRepository:
    """スケジュールを管理するリポジトリクラス。"""

    def __init__(self, client: Client):
        self.client = client

    def get_last_end_time(self, equipment_id: int) -> datetime | None:
        """指定された設備IDに関連する最後のスケジュールの終了日時を取得する。

        Args:
            equipment_id (int): 設備の一意の識別子。

        Returns:
            Optional[datetime]: 最後のスケジュールの終了日時。存在しない場合はNone。
        """
        res = (
            self.client.table("production_schedules")
            .select("end_datetime")
            .eq("equipment_id", equipment_id)
            .order("end_datetime", desc=True)
            .limit(1)
            .execute()
        )

        if res.data:
            # ISO文字列をdatetimeオブジェクトに変換して返す
            return datetime.fromisoformat(
                res.data[0]["end_datetime"].replace("Z", "+00:00")
            )
        return None

    def create(self, schedule_data: dict[str, Any]) -> None:
        """指定されたスケジュールデータをデータベースに挿入する。

        Args:
            schedule_data (Dict[str, Any]): 挿入するスケジュールデータ。
        """
        self.client.table("production_schedules").insert(schedule_data).execute()
