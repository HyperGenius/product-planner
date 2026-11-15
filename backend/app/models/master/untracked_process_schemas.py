# models/master/untracked_process_schemas.py
from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class UntrackedProcessNameCreateSchema(BaseModel):
    """日報で追わない工程の登録リクエスト（Issue #681）"""

    process_name: str = Field(
        description="工程名（工程ルートの工程名。前後の空白は除く）"
    )

    @field_validator("process_name")
    @classmethod
    def _strip(cls, value: str) -> str:
        """前後の空白（全角を含む）を除く。空なら 422。"""
        name = value.strip()
        if not name:
            raise ValueError("工程名を入力してください")
        return name


class UntrackedProcessNameResponse(BaseModel):
    """日報で追わない工程"""

    id: int
    process_name: str
    created_at: datetime
