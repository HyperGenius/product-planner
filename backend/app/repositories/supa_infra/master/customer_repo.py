# repositories/supa_infra/master/customer_repo.py
from typing import Any, TypeVar, cast

from app.repositories.supa_infra.common import BaseRepository, SupabaseTableName

T = TypeVar("T", bound=dict[str, Any])  # 型変数を定義


class CustomerRepository(BaseRepository[T]):
    def __init__(self, client):
        super().__init__(client, SupabaseTableName.CUSTOMERS.value)
