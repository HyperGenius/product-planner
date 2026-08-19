from pydantic import BaseModel, Field

PIN_PATTERN = r"^\d{4}$"


class PinSetSchema(BaseModel):
    """PIN設定/変更リクエストのスキーマ"""

    pin: str = Field(pattern=PIN_PATTERN, description="4桁の数字PIN")
