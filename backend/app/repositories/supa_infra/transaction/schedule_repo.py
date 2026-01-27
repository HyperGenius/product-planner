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
                res.data[0]["end_datetime"].replace("Z", "+00:00")  # type: ignore
            )
        return None

    def create(self, schedule_data: dict[str, Any]) -> None:
        """指定されたスケジュールデータをデータベースに挿入する。

        Args:
            schedule_data (Dict[str, Any]): 挿入するスケジュールデータ。
        """
        self.client.table("production_schedules").insert(schedule_data).execute()

    def get_by_period(
        self, start_date: str, end_date: str, equipment_group_id: int | None = None
    ) -> list[dict[str, Any]]:
        """指定された期間内の生産スケジュールを関連データと共に取得する。

        Args:
            start_date: 取得開始日 (ISO8601 / YYYY-MM-DD)
            end_date: 取得終了日 (ISO8601 / YYYY-MM-DD)
            equipment_group_id: (Optional) 特定の設備グループで絞り込む場合に使用

        Returns:
            スケジュールオブジェクトのリスト。
            各オブジェクトには order_number, product_name, process_name, equipment_name を含む。
        """
        # Supabaseのリレーション解決を使用して関連データを取得
        # orders -> products のネストされた関係も取得する
        # スケジュールが期間と重複するものを取得: schedule.start <= end_date AND schedule.end >= start_date
        query = (
            self.client.table("production_schedules")
            .select(
                "*, orders(order_number, products(name)), process_routings(process_name), equipments(name)"
            )
            .lte("start_datetime", end_date)
            .gte("end_datetime", start_date)
        )

        # equipment_group_id が指定されている場合、設備グループでフィルタリング
        if equipment_group_id is not None:
            # 設備グループに所属する設備IDのリストを取得
            equipment_res = (
                self.client.table("equipment_group_members")
                .select("equipment_id")
                .eq("equipment_group_id", equipment_group_id)
                .execute()
            )

            if equipment_res.data:
                equipment_ids = [item["equipment_id"] for item in equipment_res.data]
                # equipment_id が設備IDリストに含まれるものでフィルタリング
                query = query.in_("equipment_id", equipment_ids)
            else:
                # 設備グループにメンバーがいない場合は空のリストを返す
                return []

        res = query.execute()

        if not res.data:
            return []

        # レスポンスを整形してフラットな構造にする
        schedules = []
        for item in res.data:
            order = item.get("orders") or {}
            product = order.get("products") if isinstance(order, dict) else None
            process_routing = item.get("process_routings") or {}
            equipment = item.get("equipments") or {}

            schedule = {
                "id": item.get("id"),
                "order_id": item.get("order_id"),
                "process_routing_id": item.get("process_routing_id"),
                "equipment_id": item.get("equipment_id"),
                "start_datetime": item.get("start_datetime"),
                "end_datetime": item.get("end_datetime"),
                "order_number": order.get("order_number"),
                "product_name": product.get("name") if product else None,
                "process_name": process_routing.get("process_name"),
                "equipment_name": equipment.get("name"),
            }
            schedules.append(schedule)

        return schedules
