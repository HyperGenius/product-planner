"""
稼働カレンダーユーティリティモジュール

工場の稼働時間（平日 9:00 - 17:00）に基づき、作業の開始・終了時刻を計算する。
休憩時間（12:00 - 13:00）は稼働時間から除外される。
稼働カレンダー（work_calendars）テーブルからの休日情報をサポート。
"""

from datetime import date, datetime, time, timedelta

# 定数定義
WORK_START_HOUR = 9
WORK_END_HOUR = 17
# 休憩時間の定義
BREAK_START_HOUR = 12
BREAK_START_MINUTE = 0
BREAK_END_HOUR = 13
BREAK_END_MINUTE = 0
BREAK_DURATION_MINUTES = 60  # 1時間
# 実際の稼働時間（休憩時間を除く）
MAX_DAILY_WORK_HOURS = (WORK_END_HOUR - WORK_START_HOUR) - (BREAK_DURATION_MINUTES / 60)  # 7時間


class CalendarConfig:
    """
    稼働カレンダーの設定を保持するクラス。

    デフォルトでは平日（月〜金）を稼働日、土日を休日とするが、
    データベースから取得した休日情報と稼働日情報で上書き可能。
    """

    def __init__(
        self, holidays: set[date] | None = None, workdays: set[date] | None = None
    ):
        """
        Args:
            holidays: 休日の日付セット（DBから取得した is_holiday=True の日付）
                     Noneの場合、空のセットを使用
            workdays: 稼働日の日付セット（DBから取得した is_holiday=False の日付、
                     土日を稼働日にする場合などに使用）
                     Noneの場合、空のセットを使用
        """
        self.holidays = holidays if holidays is not None else set()
        self.workdays = workdays if workdays is not None else set()

    def is_holiday(self, dt: datetime) -> bool:
        """
        指定された日時が休日かどうかを判定する。

        Args:
            dt: 判定対象の日時

        Returns:
            bool: 休日の場合True、稼働日の場合False
        """
        target_date = dt.date()

        # 明示的に稼働日として設定されている場合（土日出勤など）
        if target_date in self.workdays:
            return False

        # 明示的に休日として設定されている場合
        if target_date in self.holidays:
            return True

        # DBに情報がない場合、デフォルトでは土日を休日とする
        return dt.weekday() >= 5  # 5: 土曜日, 6: 日曜日


# デフォルトのカレンダー設定（後方互換性のため）
_default_config = CalendarConfig()


def is_during_break(dt: datetime) -> bool:
    """
    指定された日時が休憩時間中かどうかを判定する。

    Args:
        dt: 判定対象の日時

    Returns:
        bool: 休憩時間中の場合True、それ以外の場合False
    """
    break_start = time(BREAK_START_HOUR, BREAK_START_MINUTE)
    break_end = time(BREAK_END_HOUR, BREAK_END_MINUTE)
    return break_start <= dt.time() < break_end


def adjust_start_time_for_break(dt: datetime) -> datetime:
    """
    開始時刻が休憩時間中の場合、休憩明けの時刻に調整する。

    Args:
        dt: 調整対象の日時

    Returns:
        datetime: 調整後の日時（休憩時間中でない場合はそのまま返す）
    """
    if is_during_break(dt):
        return dt.replace(
            hour=BREAK_END_HOUR, minute=BREAK_END_MINUTE, second=0, microsecond=0
        )
    return dt


def is_workday(dt: datetime, calendar_config: CalendarConfig | None = None) -> bool:
    """
    指定された日時が稼働日かどうかを判定する。

    Args:
        dt: 判定対象の日時
        calendar_config: カレンダー設定（Noneの場合はデフォルト設定を使用）

    Returns:
        bool: 稼働日の場合True、休日の場合False
    """
    config = calendar_config if calendar_config is not None else _default_config
    return not config.is_holiday(dt)


def get_next_work_start(
    dt: datetime, calendar_config: CalendarConfig | None = None
) -> datetime:
    """
    指定日時以降の、次の稼働開始日時(9:00)を返す。

    Args:
        dt: 基準となる日時
        calendar_config: カレンダー設定（Noneの場合はデフォルト設定を使用）

    Returns:
        datetime: 次の稼働開始日時（9:00）
    """
    # 既に今日の始業前なら、今日の9:00
    if is_workday(dt, calendar_config) and dt.time() < time(WORK_START_HOUR, 0):
        return dt.replace(hour=WORK_START_HOUR, minute=0, second=0, microsecond=0)

    # それ以外は翌日以降の平日9:00を探す
    next_dt = dt + timedelta(days=1)
    next_dt = next_dt.replace(hour=WORK_START_HOUR, minute=0, second=0, microsecond=0)
    while not is_workday(next_dt, calendar_config):
        next_dt += timedelta(days=1)
    return next_dt


def get_next_available_start_time(
    current_dt: datetime,
    duration_minutes: float,
    calendar_config: CalendarConfig | None = None,
) -> datetime:
    """
    現在時刻から、開始可能な日時を判定する。
    日をまたぐ作業にも対応しており、その日に少しでも開始できる場合は開始時刻を返す。
    休憩時間中の開始時刻は、休憩明け（13:00）に調整される。

    注意: 実際のスケジュール分割は split_work_across_days 関数で行います。
    この関数は duration_minutes を使用しませんが、後方互換性のために残しています。

    Args:
        current_dt: 現在の日時
        duration_minutes: 作業の所要時間（分）（使用されないが、後方互換性のため保持）
        calendar_config: カレンダー設定（Noneの場合はデフォルト設定を使用）

    Returns:
        datetime: 作業を開始可能な日時
    """
    # 1. まず基本的な稼働時間帯に乗せる
    if not is_workday(current_dt, calendar_config) or current_dt.time() >= time(
        WORK_END_HOUR, 0
    ):
        # 土日または終業後の場合は、翌営業日の朝
        start_dt = get_next_work_start(current_dt, calendar_config)
    elif current_dt.time() < time(WORK_START_HOUR, 0):
        # 始業前の場合は、その日の9:00
        start_dt = current_dt.replace(
            hour=WORK_START_HOUR, minute=0, second=0, microsecond=0
        )
    else:
        # 稼働時間内の場合は、そのまま
        start_dt = current_dt

    # 2. 休憩時間中の場合は、休憩明けに調整
    start_dt = adjust_start_time_for_break(start_dt)

    return start_dt


def calculate_end_time(
    start_dt: datetime,
    duration_minutes: float,
    calendar_config: CalendarConfig | None = None,
) -> datetime:
    """
    開始日時と所要時間から終了日時を算出する。
    作業が休憩時間をまたぐ場合、終了時刻に休憩時間分（1時間）を加算する。

    Args:
        start_dt: 作業開始日時
        duration_minutes: 作業の所要時間（分）
        calendar_config: カレンダー設定（Noneの場合はデフォルト設定を使用）

    Returns:
        datetime: 作業終了日時

    Raises:
        ValueError: 開始時刻が稼働時間外の場合、または終了時刻が17:00を超える場合
    """
    # 開始時刻が稼働日かつ稼働時間内であることを確認
    if not is_workday(start_dt, calendar_config):
        raise ValueError(f"開始日時が稼働日ではありません: {start_dt}")

    if start_dt.time() < time(WORK_START_HOUR, 0) or start_dt.time() >= time(
        WORK_END_HOUR, 0
    ):
        raise ValueError(
            f"開始時刻が稼働時間（{WORK_START_HOUR}:00 - {WORK_END_HOUR}:00）外です: "
            f"{start_dt.time()}"
        )

    # 終了時刻を計算（まず休憩時間を考慮せずに計算）
    end_dt = start_dt + timedelta(minutes=duration_minutes)

    # 休憩時間をまたぐかチェック
    break_start = start_dt.replace(
        hour=BREAK_START_HOUR, minute=BREAK_START_MINUTE, second=0, microsecond=0
    )
    break_end = start_dt.replace(
        hour=BREAK_END_HOUR, minute=BREAK_END_MINUTE, second=0, microsecond=0
    )

    # 作業が休憩時間をまたぐ場合、終了時刻に休憩時間分を加算
    if start_dt < break_start and end_dt > break_start:
        end_dt = end_dt + timedelta(minutes=BREAK_DURATION_MINUTES)

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


def calculate_remaining_work_minutes(
    start_dt: datetime, calendar_config: CalendarConfig | None = None
) -> float:
    """
    指定された開始時刻から、その日の稼働終了時刻(17:00)までの残り時間（分）を計算する。
    休憩時間が含まれる場合は、その分を差し引く。

    Args:
        start_dt: 作業開始日時
        calendar_config: カレンダー設定（Noneの場合はデフォルト設定を使用）

    Returns:
        float: 残り稼働時間（分）

    Raises:
        ValueError: 開始時刻が稼働時間外の場合
    """
    # 開始時刻が稼働日かつ稼働時間内であることを確認
    if not is_workday(start_dt, calendar_config):
        raise ValueError(f"開始日時が稼働日ではありません: {start_dt}")

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

    # 休憩時間が残り時間に含まれているかチェック
    break_start = start_dt.replace(
        hour=BREAK_START_HOUR, minute=BREAK_START_MINUTE, second=0, microsecond=0
    )
    break_end = start_dt.replace(
        hour=BREAK_END_HOUR, minute=BREAK_END_MINUTE, second=0, microsecond=0
    )

    # 開始時刻が休憩開始前で、休憩時間が含まれる場合、休憩時間分を差し引く
    if start_dt < break_start:
        remaining_minutes -= BREAK_DURATION_MINUTES

    return remaining_minutes


def split_work_across_days(
    start_dt: datetime,
    duration_minutes: float,
    calendar_config: CalendarConfig | None = None,
) -> list[tuple[datetime, datetime]]:
    """
    所要時間が長い場合、複数の営業日に分割してスケジュールを作成する。
    各日は9:00-17:00の稼働時間内で作業を行い、17:00を超える場合は翌営業日に繰り越す。

    Args:
        start_dt: 作業開始日時
        duration_minutes: 作業の所要時間（分）
        calendar_config: カレンダー設定（Noneの場合はデフォルト設定を使用）

    Returns:
        list[tuple[datetime, datetime]]: (開始日時, 終了日時) のタプルのリスト

    Raises:
        ValueError: 開始時刻が稼働時間外の場合、または所要時間が0以下の場合
    """
    # 所要時間の検証
    if duration_minutes <= 0:
        raise ValueError(f"所要時間は正の値である必要があります: {duration_minutes}分")

    # 開始時刻が稼働日かつ稼働時間内であることを確認
    if not is_workday(start_dt, calendar_config):
        raise ValueError(f"開始日時が稼働日ではありません: {start_dt}")

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
        remaining_today = calculate_remaining_work_minutes(
            current_start, calendar_config
        )

        if remaining_duration <= remaining_today + epsilon:
            # 残りの作業が今日の稼働時間内に収まる場合
            # 休憩時間を考慮した終了時刻を計算
            end_dt = current_start + timedelta(minutes=remaining_duration)
            
            # 休憩時間をまたぐかチェック
            break_start = current_start.replace(
                hour=BREAK_START_HOUR, minute=BREAK_START_MINUTE, second=0, microsecond=0
            )
            
            # 作業が休憩時間をまたぐ場合、終了時刻に休憩時間分を加算
            if current_start < break_start and end_dt > break_start:
                end_dt = end_dt + timedelta(minutes=BREAK_DURATION_MINUTES)
            
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
            current_start = get_next_work_start(end_of_day, calendar_config)

    return schedules
