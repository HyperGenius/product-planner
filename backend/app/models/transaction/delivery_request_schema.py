"""顧客からの督促・分割納入の依頼（order_delivery_requests、Issue #619）のスキーマ。"""

from typing import Literal

from pydantic import BaseModel

DeliveryRequestKind = Literal["delivery_chase", "split_delivery"]


class OrderDeliveryRequestResponse(BaseModel):
    id: str
    order_id: int | None
    kind: DeliveryRequestKind
    extracted_product_name: str | None = None
    quantity: int | None = None
    requested_date: str | None = None
    body_snippet: str | None = None
    resolved_at: str | None = None
    created_at: str


class OpenDeliveryRequestCount(BaseModel):
    """受注ごとの未対応の依頼件数（一覧の印用）。"""

    order_id: int
    count: int


class DeliveryRequestResolveRequest(BaseModel):
    resolved: bool
