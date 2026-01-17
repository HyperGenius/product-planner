# models/common/base_schema.py
from typing import Any

from pydantic import BaseModel


class BaseSchema(BaseModel):
    """共通スキーマ"""

    def with_tenant_id(self, tenant_id: str) -> dict[str, Any]:
        """
        モデルを辞書化し、tenant_id を付与して返すヘルパーメソッド。
        UUID等の型変換(mode='json')もここで行うことで、呼び出し側をシンプルにする。
        """
        data = self.model_dump(mode="json")
        data["tenant_id"] = tenant_id
        return data
