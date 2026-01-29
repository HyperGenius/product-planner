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
    現在時刻から、開始可能な日時を判定する。
    日をまたぐ作業にも対応しており、その日に少しでも開始できる場合は開始時刻を返す。

    注意: 実際のスケジュール分割は split_work_across_days 関数で行います。
    この関数は duration_minutes を使用しませんが、後方互換性のために残しています。

    Args:
        current_dt: 現在の日時
        duration_minutes: 作業の所要時間（分）（使用されないが、後方互換性のため保持）

    Returns:
        datetime: 作業を開始可能な日時
    """
    # 1. まず基本的な稼働時間帯に乗せる
    if not is_workday(current_dt) or current_dt.time() >= time(WORK_END_HOUR, 0):
        # 土日または終業後の場合は、翌営業日の朝
        start_dt = get_next_work_start(current_dt)
    elif current_dt.time() < time(WORK_START_HOUR, 0):
        # 始業前の場合は、その日の9:00
        start_dt = current_dt.replace(
            hour=WORK_START_HOUR, minute=0, second=0, microsecond=0
        )
    else:
        # 稼働時間内の場合は、そのまま
        start_dt = current_dt

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


def calculate_remaining_work_minutes(start_dt: datetime) -> float:
    """
    指定された開始時刻から、その日の稼働終了時刻(17:00)までの残り時間（分）を計算する。

    Args:
        start_dt: 作業開始日時

    Returns:
        float: 残り稼働時間（分）

    Raises:
        ValueError: 開始時刻が稼働時間外の場合
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

    # その日の17:00までの残り時間を計算
    work_end_limit = start_dt.replace(
        hour=WORK_END_HOUR, minute=0, second=0, microsecond=0
    )
    remaining_minutes = (work_end_limit - start_dt).total_seconds() / 60

    return remaining_minutes


def split_work_across_days(
    start_dt: datetime, duration_minutes: float
) -> list[tuple[datetime, datetime]]:
    """
    所要時間が長い場合、複数の営業日に分割してスケジュールを作成する。
    各日は9:00-17:00の稼働時間内で作業を行い、17:00を超える場合は翌営業日に繰り越す。

    Args:
        start_dt: 作業開始日時
        duration_minutes: 作業の所要時間（分）

    Returns:
        list[tuple[datetime, datetime]]: (開始日時, 終了日時) のタプルのリスト

    Raises:
        ValueError: 開始時刻が稼働時間外の場合、または所要時間が0以下の場合
    """
    # 所要時間の検証
    if duration_minutes <= 0:
        raise ValueError(f"所要時間は正の値である必要があります: {duration_minutes}分")

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

    schedules = []
    remaining_duration = duration_minutes
    current_start = start_dt

    # 浮動小数点誤差を考慮した比較のための閾値（0.01分 = 0.6秒）
    epsilon = 0.01

    while remaining_duration > epsilon:
        # その日の残り稼働時間を計算
        remaining_today = calculate_remaining_work_minutes(current_start)

        if remaining_duration <= remaining_today + epsilon:
            # 残りの作業が今日の稼働時間内に収まる場合
            end_dt = current_start + timedelta(minutes=remaining_duration)
            schedules.append((current_start, end_dt))
            remaining_duration = 0
        else:
            # 今日の稼働時間を超える場合、17:00まで作業して翌営業日に繰り越す
            end_of_day = current_start.replace(
                hour=WORK_END_HOUR, minute=0, second=0, microsecond=0
            )
            schedules.append((current_start, end_of_day))
            remaining_duration -= remaining_today

            # 翌営業日の9:00から再開
            current_start = get_next_work_start(end_of_day)

    return schedules
