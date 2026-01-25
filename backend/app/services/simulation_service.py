"""
シミュレーションサービスモジュール

スケジュールシミュレーション結果の整形と検証を行うサービス層。
"""

from datetime import datetime

from app.repositories.supa_infra.master.equipment_repo import EquipmentRepository
from app.repositories.supa_infra.master.product_repo import ProductRepository


def build_simulate_response(
    schedules: list[dict],
    desired_deadline: str | None,
    product_repo: ProductRepository,
    equipment_repo: EquipmentRepository,
) -> dict:
    """
    スケジュール情報をフロントエンドが期待する形式に変換する。

    Args:
        schedules: スケジュール情報のリスト
        desired_deadline: 希望納期（ISO形式の文字列またはNone）
        product_repo: 製品リポジトリ
        equipment_repo: 設備リポジトリ

    Returns:
        整形されたシミュレーション結果

    Raises:
        ValueError: スケジュール情報が空の場合
    """
    if not schedules:
        raise ValueError("スケジュール情報が空です")

    # 最後のスケジュールの終了時刻を回答納期とする
    last_schedule = schedules[-1]
    calculated_deadline = last_schedule["end_datetime"]

    # 希望納期との比較
    is_feasible = is_schedule_feasible(desired_deadline, calculated_deadline)

    # process_schedulesを構築（process_nameと equipment_nameを含める）
    process_schedules = build_process_schedules(
        schedules, product_repo, equipment_repo
    )

    return {
        "calculated_deadline": calculated_deadline,
        "is_feasible": is_feasible,
        "process_schedules": process_schedules,
    }


def is_schedule_feasible(
    desired_deadline: str | None, calculated_deadline: str
) -> bool:
    """
    スケジュールが希望納期に間に合うか判定する。

    Args:
        desired_deadline: 希望納期（ISO形式の文字列またはNone）
        calculated_deadline: 計算された納期（ISO形式の文字列）

    Returns:
        True: 間に合う、False: 間に合わない
    """
    if not desired_deadline:
        return True

    try:
        deadline_dt = datetime.fromisoformat(desired_deadline)
        calc_dt = datetime.fromisoformat(calculated_deadline)
        return calc_dt <= deadline_dt
    except ValueError:
        return True


def build_process_schedules(
    schedules: list[dict],
    product_repo: ProductRepository,
    equipment_repo: EquipmentRepository,
) -> list[dict]:
    """
    スケジュール情報からプロセススケジュールを構築する。

    Args:
        schedules: スケジュール情報のリスト
        product_repo: 製品リポジトリ
        equipment_repo: 設備リポジトリ

    Returns:
        プロセススケジュールのリスト
    """
    process_schedules = []
    for schedule in schedules:
        routing_id = schedule.get("process_routing_id")
        equipment_id = schedule.get("equipment_id")

        # 工程名を取得
        process_name = "不明"
        if routing_id:
            process_name = product_repo.get_process_name(routing_id)

        # 設備名を取得
        equipment_name = None
        if equipment_id:
            equipment_name = equipment_repo.get_equipment_name(equipment_id)

        process_schedules.append(
            {
                "process_name": process_name,
                "start_time": schedule["start_datetime"],
                "end_time": schedule["end_datetime"],
                "equipment_name": equipment_name,
            }
        )

    return process_schedules
