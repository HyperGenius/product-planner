# backend/app/repositories/supa_infra/transaction/schedule_repo.py
from datetime import datetime
from typing import Any, cast

from app.repositories.supa_infra.common import BaseRepository, SupabaseTableName
from app.repositories.supa_infra.master.equipment_repo import (
    EQUIPMENT_DISPLAY_COLUMNS,
    equipment_display_name,
)
from app.services.daily_report_name_matching_service import fetch_all_rows
from supabase import Client  # type: ignore


def _parse_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class _Extent:
    """開始の最小〜終了の最大。比較は datetime で行い、返すのは DB の文字列のまま"""

    def __init__(self, start: str, end: str):
        self.start = start
        self.end = end

    def union(self, other: "_Extent | None") -> "_Extent":
        if other is None:
            return self
        start = min(self.start, other.start, key=_parse_datetime)
        end = max(self.end, other.end, key=_parse_datetime)
        return _Extent(start, end)


class ScheduleRepository(BaseRepository):
    """スケジュールを管理するリポジトリクラス。"""

    def __init__(self, client: Client):
        super().__init__(client, SupabaseTableName.PRODUCTION_SCHEDULES.value)
        self.client = client

    def get_schedules_by_equipment(
        self, equipment_id: int, start: datetime, end: datetime
    ) -> list[dict[str, Any]]:
        """ギャップ計算用: 指定期間の設備スケジュールを start_datetime 昇順で取得する。

        Args:
            equipment_id: 設備ID
            start: 取得範囲の開始日時
            end: 取得範囲の終了日時

        Returns:
            {"id", "start_datetime", "end_datetime"} のリスト（昇順ソート済み）
        """
        res = (
            self.client.table(self.table_name)
            .select("id, start_datetime, end_datetime")
            .eq("equipment_id", equipment_id)
            .lt("start_datetime", end.isoformat())
            .gt("end_datetime", start.isoformat())
            .order("start_datetime", desc=False)
            .execute()
        )
        if not res.data:
            return []
        return cast(list[dict[str, Any]], res.data)

    def get_start_datetimes_by_order_ids(
        self, order_ids: list[int]
    ) -> list[dict[str, Any]]:
        """指定注文群に紐づく工程スケジュールの (order_id, start_datetime) を返す。

        着手日ベースの自動遷移（Issue #400）で、注文ごとの最早 start_datetime を
        求めるために使う。最小値の算出は呼び出し側で行う。
        """
        if not order_ids:
            return []
        res = (
            self.client.table(self.table_name)
            .select("order_id, start_datetime")
            .in_("order_id", order_ids)
            .execute()
        )
        return cast(list[dict[str, Any]], res.data or [])

    def get_last_end_time(self, equipment_id: int) -> datetime | None:
        """指定された設備IDに関連する最後のスケジュールの終了日時を取得する。

        Args:
            equipment_id (int): 設備の一意の識別子。

        Returns:
            Optional[datetime]: 最後のスケジュールの終了日時。存在しない場合はNone。
        """
        res = (
            self.client.table(self.table_name)
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
        self.client.table(self.table_name).insert(schedule_data).execute()

    def get_by_period(
        self, start_date: str, end_date: str, equipment_group_id: int | None = None
    ) -> list[dict[str, Any]]:
        """指定された期間内の生産スケジュールを関連データと共に取得する。

        Args:
            start_date: 取得開始日 (ISO8601 / YYYY-MM-DD)
            end_date: 取得終了日 (ISO8601 / YYYY-MM-DD)
            equipment_group_id: (Optional) 特定の設備グループで絞り込む場合に使用

        Returns:
            `ProductionScheduleItem` の形の dict のリスト。受注（顧客・製品・数量・納期）・工程・設備を結合し、
            表示期間の外へ続くかの判定用に工程・受注全体の開始〜終了（期間外のセグメントを含む）を付ける
        """
        # スケジュールが期間と重複するものを取得: schedule.start <= end_date AND schedule.end >= start_date
        start_datetime_str = f"{start_date}T00:00:00+00:00"
        end_datetime_str = f"{end_date}T23:59:59.999999+00:00"

        query = (
            self.client.table(self.table_name)
            .select(
                "*, orders(order_number, customer_order_no, status, quantity, deadline_date,"
                " confirmed_deadline, products(name), customers(name, alias)),"
                " process_routings(process_name, sequence_order, equipment_group_id),"
                f" equipments({EQUIPMENT_DISPLAY_COLUMNS})"
            )
            .lte("start_datetime", end_datetime_str)
            .gte("end_datetime", start_datetime_str)
        )

        if equipment_group_id is not None:
            # 設備グループに所属する設備IDのリストで絞り込む
            equipment_res = (
                self.client.table("equipment_group_members")
                .select("equipment_id")
                .eq("equipment_group_id", equipment_group_id)
                .execute()
            )
            if not equipment_res.data:
                # 設備グループにメンバーがいない場合は空のリストを返す
                return []
            equipment_data = cast(list[dict[str, Any]], equipment_res.data)
            query = query.in_(
                "equipment_id", [item["equipment_id"] for item in equipment_data]
            )

        res = query.execute()
        if not res.data:
            return []
        schedule_data = cast(list[dict[str, Any]], res.data)

        group_names = self._get_group_display_names(
            {
                group_id
                for item in schedule_data
                if (routing := item.get("process_routings"))
                and (group_id := routing.get("equipment_group_id")) is not None
            }
        )
        process_extents, order_extents = self._get_extents(
            sorted({item["order_id"] for item in schedule_data})
        )

        return [
            _format_schedule(item, group_names, process_extents, order_extents)
            for item in schedule_data
        ]

    def _get_group_display_names(self, group_ids: set[int]) -> dict[int, str]:
        """設備グループID → 表示名。1台グループはメンバーの設備の表示名にする。

        1台グループの名前は設備名・呼称の変更に追従しないため（Issue #512）。
        Frontend の `groupDisplayName()` と揃える
        """
        if not group_ids:
            return {}
        res = (
            self.client.table(SupabaseTableName.EQUIPMENT_GROUPS.value)
            .select(
                "id, name, equipment_group_members(equipments("
                f"{EQUIPMENT_DISPLAY_COLUMNS}))"
            )
            .in_("id", sorted(group_ids))
            .execute()
        )
        names: dict[int, str] = {}
        for group in cast(list[dict[str, Any]], res.data or []):
            members = [
                m["equipments"]
                for m in group.get("equipment_group_members") or []
                if m.get("equipments")
            ]
            if len(members) == 1:
                names[group["id"]] = cast(str, equipment_display_name(members[0]))
            else:
                names[group["id"]] = group["name"]
        return names

    def _get_extents(
        self, order_ids: list[int]
    ) -> tuple[dict[tuple[int, int], _Extent], dict[int, _Extent]]:
        """受注の全セグメント（表示期間外を含む）から、工程・受注ごとの開始の最小〜終了の最大を求める。

        API は表示期間と重なるセグメントしか返さないので、ガントで期間の外へ続く工程・受注に
        「続き」の印を出すのに使う（Issue #579）
        """
        if not order_ids:
            return {}, {}
        rows = fetch_all_rows(
            lambda: (
                self.client.table(self.table_name)
                .select(
                    "id, order_id, process_routing_id, start_datetime, end_datetime"
                )
                .in_("order_id", order_ids)
                .order("id")
            )
        )
        process_extents: dict[tuple[int, int], _Extent] = {}
        order_extents: dict[int, _Extent] = {}
        for row in rows:
            segment = _Extent(row["start_datetime"], row["end_datetime"])
            key = (row["order_id"], row["process_routing_id"])
            process_extents[key] = segment.union(process_extents.get(key))
            order_extents[row["order_id"]] = segment.union(
                order_extents.get(row["order_id"])
            )
        return process_extents, order_extents


def _format_schedule(
    item: dict[str, Any],
    group_names: dict[int, str],
    process_extents: dict[tuple[int, int], _Extent],
    order_extents: dict[int, _Extent],
) -> dict[str, Any]:
    """埋め込みを解いて `ProductionScheduleItem` の形のフラットな dict にする"""
    order = cast(dict[str, Any], item.get("orders") or {})
    product = cast(dict[str, Any], order.get("products") or {})
    customer = cast(dict[str, Any], order.get("customers") or {})
    routing = cast(dict[str, Any], item.get("process_routings") or {})
    equipment = cast(dict[str, Any] | None, item.get("equipments"))
    group_id = routing.get("equipment_group_id")
    process_extent = process_extents.get((item["order_id"], item["process_routing_id"]))
    order_extent = order_extents.get(item["order_id"])
    return {
        "id": item.get("id"),
        "order_id": item.get("order_id"),
        "process_routing_id": item.get("process_routing_id"),
        "equipment_id": item.get("equipment_id"),
        "start_datetime": item.get("start_datetime"),
        "end_datetime": item.get("end_datetime"),
        "order_number": order.get("order_number"),
        "customer_order_no": order.get("customer_order_no"),
        "order_status": order.get("status"),
        "quantity": order.get("quantity"),
        # 希望納期の DB 列は deadline_date（受注 API と同じく desired_deadline で返す）
        "desired_deadline": order.get("deadline_date"),
        "confirmed_deadline": order.get("confirmed_deadline"),
        "product_name": product.get("name"),
        # 顧客不明（customer_id が NULL、#521）は null のまま。表示側で「顧客不明」と出す
        "customer_name": customer.get("name"),
        "customer_alias": customer.get("alias"),
        "process_name": routing.get("process_name"),
        "sequence_order": routing.get("sequence_order"),
        "equipment_name": equipment_display_name(equipment),
        "equipment_group_id": group_id,
        "equipment_group_name": group_names.get(group_id)
        if group_id is not None
        else None,
        "process_start_datetime": process_extent.start if process_extent else None,
        "process_end_datetime": process_extent.end if process_extent else None,
        "order_start_datetime": order_extent.start if order_extent else None,
        "order_end_datetime": order_extent.end if order_extent else None,
    }
