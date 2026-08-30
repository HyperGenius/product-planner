# services/order_status_service.py
"""orders.status の遷移バリデーション (Issue #324)。

draft -> pending_approval -> confirmed -> completed / canceled の順方向のみを
許可する。差し戻し pending_approval -> draft のみ例外的に許可する
（実際の却下APIは別Issueで実装）。

confirmed からは shipped (送品済み) へも遷移できる。shipped は実質的な終端で、
以降の順方向遷移は無い。
"""

ORDER_STATUS_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"pending_approval"},
    "pending_approval": {"draft", "confirmed"},
    "confirmed": {"completed", "canceled", "shipped"},
    "shipped": set(),
    "completed": set(),
    "canceled": set(),
}


class InvalidOrderStatusTransitionError(ValueError):
    """許可されていない orders.status 遷移が要求された場合に送出する"""

    def __init__(self, current_status: str | None, new_status: str):
        self.current_status = current_status
        self.new_status = new_status
        super().__init__(
            f"ステータスを {current_status!r} から {new_status!r} へ変更することはできません"
        )


def validate_order_status_transition(
    current_status: str | None, new_status: str
) -> None:
    """current_status から new_status への遷移が許可されているか検証する。

    Raises:
        InvalidOrderStatusTransitionError: 許可されていない遷移の場合
    """
    allowed = ORDER_STATUS_TRANSITIONS.get(current_status or "", set())
    if new_status not in allowed:
        raise InvalidOrderStatusTransitionError(current_status, new_status)
