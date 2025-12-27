"""
稼働カレンダーユーティリティモジュール

工場の稼働時間（平日 9:00 - 17:00）に基づき、作業の開始・終了時刻を計算する。
"""

from datetime import datetime, time, timedelta

# 定数定義
WORK_START_HOUR = 9
WORK_END_HOUR = 17
MAX_DAILY_WORK_HOURS = WORK_END_HOUR - WORK_START_HOUR  # 8時間


def is_workday(dt: datetime) -> bool:
    """
    指定された日時が平日（月曜日～金曜日）かどうかを判定する。

    Args:
        dt: 判定対象の日時

    Returns:
        bool: 平日の場合True、土日の場合False
    """
    return dt.weekday() < 5


def get_next_work_start(dt: datetime) -> datetime:
    """
    指定日時以降の、次の稼働開始日時(9:00)を返す。

    Args:
        dt: 基準となる日時

    Returns:
        datetime: 次の稼働開始日時（9:00）
    """
    # 既に今日の始業前なら、今日の9:00
    if is_workday(dt) and dt.time() < time(WORK_START_HOUR, 0):
        return dt.replace(hour=WORK_START_HOUR, minute=0, second=0, microsecond=0)

    # それ以外は翌日以降の平日9:00を探す
    next_dt = dt + timedelta(days=1)
    next_dt = next_dt.replace(hour=WORK_START_HOUR, minute=0, second=0, microsecond=0)
    while not is_workday(next_dt):
        next_dt += timedelta(days=1)
    return next_dt


def get_next_available_start_time(
    current_dt: datetime, duration_minutes: float
) -> datetime:
    """
    現在時刻と所要時間から、開始可能な日時を判定する。
    17:00をはみ出す場合は翌営業日の9:00を返す。

    Args:
        current_dt: 現在の日時
        duration_minutes: 作業の所要時間（分）

    Returns:
        datetime: 作業を開始可能な日時

    Raises:
        ValueError: 所要時間が1日の稼働時間（8時間）を超える場合
    """
    # MVPでは日をまたぐ作業（所要時間 > 8時間）は考慮しない
    if duration_minutes > MAX_DAILY_WORK_HOURS * 60:
        raise ValueError(
            f"所要時間が1日の稼働時間（{MAX_DAILY_WORK_HOURS}時間）を超えています: "
            f"{duration_minutes}分"
        )

    # 1. まず基本的な稼働時間帯に乗せる
    if not is_workday(current_dt) or current_dt.time() >= time(WORK_END_HOUR, 0):
        start_dt = get_next_work_start(current_dt)
    elif current_dt.time() < time(WORK_START_HOUR, 0):
        start_dt = current_dt.replace(
            hour=WORK_START_HOUR, minute=0, second=0, microsecond=0
        )
    else:
        start_dt = current_dt

    # 2. 終了時刻を仮計算
    end_dt = start_dt + timedelta(minutes=duration_minutes)

    # 3. 17:00 を超えるかチェック
    work_end_limit = start_dt.replace(
        hour=WORK_END_HOUR, minute=0, second=0, microsecond=0
    )

    if end_dt > work_end_limit:
        # はみ出すので翌営業日の朝にする
        return get_next_work_start(start_dt)

    return start_dt


def calculate_end_time(start_dt: datetime, duration_minutes: float) -> datetime:
    """
    開始日時と所要時間から終了日時を算出する。

    Args:
        start_dt: 作業開始日時
        duration_minutes: 作業の所要時間（分）

    Returns:
        datetime: 作業終了日時

    Raises:
        ValueError: 開始時刻が稼働時間外の場合、または終了時刻が17:00を超える場合
    """
    # 開始時刻が稼働日かつ稼働時間内であることを確認
    if not is_workday(start_dt):
        raise ValueError(f"開始日時が平日ではありません: {start_dt}")

    if start_dt.time() < time(WORK_START_HOUR, 0) or start_dt.time() >= time(
        WORK_END_HOUR, 0
    ):
        raise ValueError(
            f"開始時刻が稼働時間（{WORK_START_HOUR}:00 - {WORK_END_HOUR}:00）外です: "
            f"{start_dt.time()}"
        )

    # 終了時刻を計算
    end_dt = start_dt + timedelta(minutes=duration_minutes)

    # 17:00を超えないことを確認
    work_end_limit = start_dt.replace(
        hour=WORK_END_HOUR, minute=0, second=0, microsecond=0
    )

    if end_dt > work_end_limit:
        raise ValueError(
            f"作業が稼働時間を超えます。開始: {start_dt}, 所要時間: {duration_minutes}分, "
            f"終了予定: {end_dt}, 稼働終了: {work_end_limit}"
        )

    return end_dt
