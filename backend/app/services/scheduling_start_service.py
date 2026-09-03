"""作業開始日（scheduling_start_date）の解決とバリデーション（Issue #372）。

受注の「作業開始日（工場が着手する日）」を、受注起票日とは別に指定できるようにする
ための共通ロジック。

- 文字列 / date を、その日の稼働開始時刻（JST 09:00）を表す tz-aware datetime に変換する
  （`scheduler_logic.schedule_order(start_time=...)` へ渡すため）。
- 過去日（本日より前）の指定は president / platform_admin のみに許可する
  （起票前に着手してしまったケースの救済措置）。
"""

from datetime import date, datetime, time

from app.utils.calendar import JST, WORK_START_HOUR

# 作業開始日を過去日に設定できるロール（起票前着手の救済措置）。
# 承認操作系は president 限定だが、本用途は救済目的のため platform_admin にも開放する。
BACKDATE_ALLOWED_ROLES: tuple[str, ...] = ("president", "platform_admin")


class PastSchedulingStartDateError(ValueError):
    """権限のないユーザーが作業開始日を過去日へ設定しようとした場合に送出する。"""

    def __init__(self) -> None:
        super().__init__(
            "作業開始日を過去日に設定できるのは president / platform_admin のみです"
        )


def parse_scheduling_start_date(value: str | date | None) -> date | None:
    """ISO 形式の日付文字列（または date / datetime）を date へ正規化する。

    None はそのまま None を返す。パースできない場合は ValueError。
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(value[:10])
    except (ValueError, TypeError) as e:
        raise ValueError(f"作業開始日の形式が不正です: {value!r}") from e


def to_scheduling_start_time(value: str | date | None) -> datetime | None:
    """作業開始日を、その日の稼働開始時刻（JST 09:00）の tz-aware datetime に変換する。

    None の場合は None を返し、呼び出し側（scheduler_logic）が現在時刻へフォールバックする。
    稼働日でない日を渡しても、スケジューラのカレンダーロジックが次の稼働日へ繰り上げる。
    """
    d = parse_scheduling_start_date(value)
    if d is None:
        return None
    return datetime.combine(d, time(WORK_START_HOUR, 0), tzinfo=JST)


def is_backdated(
    value: str | date | None,
    *,
    today: date | None = None,
) -> bool:
    """作業開始日が過去日（本日 JST より前）かどうかを返す。

    None / 当日 / 未来日は False。形式が不正な場合は ValueError。
    ロール問い合わせ前に「そもそも権限チェックが要るか」を判定する用途。
    """
    d = parse_scheduling_start_date(value)
    if d is None:
        return False
    ref = today if today is not None else datetime.now(JST).date()
    return d < ref


def validate_scheduling_start_date(
    value: str | date | None,
    role: str | None,
    *,
    today: date | None = None,
) -> date | None:
    """作業開始日を検証し、正規化した date を返す。

    過去日（本日 JST より前）で、かつ role が BACKDATE_ALLOWED_ROLES に
    含まれない場合は PastSchedulingStartDateError を送出する。
    """
    d = parse_scheduling_start_date(value)
    if d is None:
        return None
    ref = today if today is not None else datetime.now(JST).date()
    if d < ref and role not in BACKDATE_ALLOWED_ROLES:
        raise PastSchedulingStartDateError()
    return d
