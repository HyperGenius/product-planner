"""
スケジューリングロジックモジュール

注文に対して、製品の工程順序に基づいて生産スケジュールを作成する。
カレンダーユーティリティを使用して稼働時間（平日 9:00 - 17:00）内でスケジュールを割り当てる。
"""

from datetime import datetime
from typing import Any

from repositories.supa_infra.master.product_repo import ProductRepository
from repositories.supa_infra.transaction.schedule_repo import ScheduleRepository
from utils.calendar import calculate_end_time, get_next_available_start_time


def schedule_order(
    order_id: int,
    product_id: int,
    quantity: int,
    product_repo: ProductRepository,
    schedule_repo: ScheduleRepository,
    tenant_id: str,
    start_time: datetime | None = None,
) -> list[dict[str, Any]]:
    """
    注文に対してスケジュールを作成する。

    Args:
        order_id: 注文ID
        product_id: 製品ID
        quantity: 数量
        product_repo: 製品リポジトリ
        schedule_repo: スケジュールリポジトリ
        tenant_id: テナントID
        start_time: スケジュール開始基準時刻（指定なしの場合は現在時刻）

    Returns:
        作成されたスケジュールのリスト

    Raises:
        ValueError: 工程が取得できない場合、または設備グループにメンバーが存在しない場合
    """
    # 製品の工程順序を取得（sequence_order順にソート済み）
    routings = product_repo.get_routings_by_product(product_id)

    if not routings:
        raise ValueError(f"製品ID {product_id} に対する工程が見つかりません")

    created_schedules = []
    # 最初の工程の開始基準時間（指定がない場合は現在時刻）
    current_process_start = start_time if start_time else datetime.now().astimezone()

    for routing in routings:
        # 工程の情報を取得
        equipment_group_id = routing["equipment_group_id"]
        setup_time_sec = routing.get("setup_time_seconds", 0) or 0
        unit_time_sec = float(routing["unit_time_seconds"])

        # 所要時間を計算（段取り時間 + 単位時間 × 数量）
        total_duration_sec = setup_time_sec + (unit_time_sec * quantity)
        total_duration_min = total_duration_sec / 60

        # 設備グループに属する設備IDを取得
        machine_ids = _get_equipment_ids_by_group(product_repo, equipment_group_id)

        if not machine_ids:
            raise ValueError(
                f"設備グループID {equipment_group_id} に設備が見つかりません"
            )

        # 各設備について、開始可能な時刻を計算
        candidates = []
        for machine_id in machine_ids:
            # 設備の最終終了時刻を取得
            last_end = schedule_repo.get_last_end_time(machine_id)

            # 設備が空く時間（最終終了時刻がない場合は開始基準時刻）
            machine_free_at = last_end if last_end else current_process_start

            # 前工程が終わった時間と設備が空く時間の遅い方を基準とする
            base_start = max(machine_free_at, current_process_start)

            # カレンダーロジックを適用して実際の開始時刻を決定
            actual_start = get_next_available_start_time(base_start, total_duration_min)

            candidates.append(
                {
                    "machine_id": machine_id,
                    "start": actual_start,
                    "duration_sec": total_duration_sec,
                }
            )

        # 最も早く開始できる設備を選定
        best = min(candidates, key=lambda x: x["start"])
        start_time = best["start"]

        # 終了時刻を計算
        end_time = calculate_end_time(start_time, total_duration_min)

        # スケジュールを保存
        schedule_data = {
            "tenant_id": tenant_id,
            "order_id": order_id,
            "process_routing_id": routing["id"],
            "equipment_id": best["machine_id"],
            "start_datetime": start_time.isoformat(),
            "end_datetime": end_time.isoformat(),
        }
        schedule_repo.create(schedule_data)
        created_schedules.append(schedule_data)

        # 次工程の開始基準時間は、今回の終了時刻
        current_process_start = end_time

    return created_schedules


def _get_equipment_ids_by_group(
    product_repo: ProductRepository, group_id: int
) -> list[int]:
    """
    設備グループIDから、所属する設備IDのリストを取得する。

    Args:
        product_repo: 製品リポジトリ（equipment_group_membersテーブルへのアクセスに使用）
        group_id: 設備グループID

    Returns:
        設備IDのリスト
    """
    res = (
        product_repo.client.table("equipment_group_members")
        .select("equipment_id")
        .eq("equipment_group_id", group_id)
        .execute()
    )
    return [row["equipment_id"] for row in res.data] if res.data else []
