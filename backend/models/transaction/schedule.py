# models/transaction/schedule.py
from pydantic import BaseModel


class ScheduleRequest(BaseModel):
    """
    注文を入力してスケジュールを生成するリクエスト
    """

    order_id: int
