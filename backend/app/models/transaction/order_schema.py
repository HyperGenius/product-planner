# models/transaction/order_schema.py

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.common.base_schema import BaseSchema


class OrderCreate(BaseSchema):
    """注文を作成するためのスキーマ"""

    model_config = ConfigDict(populate_by_name=True)

    order_number: str | None = Field(None, alias="order_no")
    product_id: int | None = None
    quantity: int | None = None
    deadline_date: str | None = Field(None, alias="desired_deadline")
    customer_id: int | None = None
    source_type: str = Field("manual")
    source_raw: str | None = None
    extracted_product_name: str | None = None
    product_candidates: list[dict] | None = None


class OrderSimulateRequest(BaseSchema):
    """注文シミュレーションのリクエストスキーマ"""

    model_config = ConfigDict(populate_by_name=True)

    product_id: int
    quantity: int
    deadline_date: str | None = Field(None, alias="desired_deadline")
    standalone: bool = False


class OrderUpdate(BaseSchema):
    """注文を更新するためのスキーマ"""

    model_config = ConfigDict(populate_by_name=True)

    order_number: str | None = Field(None, alias="order_no")
    product_id: int | None = None
    quantity: int | None = None
    deadline_date: str | None = Field(None, alias="desired_deadline")
    customer_id: int | None = None


class OrderSplitLineItem(BaseSchema):
    """分割後の1受注を表すスキーマ"""

    model_config = ConfigDict(populate_by_name=True)

    product_id: int
    quantity: int
    deadline_date: str = Field(alias="desired_deadline")
    customer_id: int | None = None
    customer_certainty: (
        Literal["confirmed", "forecast", "forecast_tentative"] | None
    ) = None
    extracted_product_name: str | None = None


class OrderSplitRequest(BaseSchema):
    """1件の下書き注文をN件に手動分割するためのリクエストスキーマ"""

    model_config = ConfigDict(populate_by_name=True)

    line_items: list[OrderSplitLineItem] = Field(min_length=2)


class OrderRejectRequest(BaseSchema):
    """注文の承認却下リクエストスキーマ（却下理由は任意入力）"""

    model_config = ConfigDict(populate_by_name=True)

    reason: str | None = None


class OrderBulkApproveRequest(BaseSchema):
    """複数の承認待ち注文を一括承認するためのリクエストスキーマ"""

    model_config = ConfigDict(populate_by_name=True)

    order_ids: list[int] = Field(min_length=1)


class OrderAttachmentResponse(BaseModel):
    """注文添付ファイルのレスポンススキーマ"""

    id: str
    order_id: int
    storage_path: str
    original_filename: str
    content_type: str | None
    size_bytes: int | None
    parse_status: str
    signed_url: str
    created_at: str
