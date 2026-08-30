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


class ManualEmailIntakeLineItem(BaseSchema):
    """手動メール起票（分納対応）における1明細を表すスキーマ"""

    model_config = ConfigDict(populate_by_name=True)

    product_id: int | None = None
    quantity: int = Field(gt=0)
    deadline_date: str | None = Field(None, alias="desired_deadline")
    extracted_product_name: str | None = None


class ManualEmailIntakeRequest(BaseSchema):
    """
    自動パースできない受注メールを、本文・添付付きで手動起票するリクエスト。
    1メール = 顧客・本文・添付を共有する N 明細（分納）としてまとめて起票する。
    multipart のフォームフィールド `payload` に JSON 文字列で渡す。
    """

    model_config = ConfigDict(populate_by_name=True)

    order_number: str | None = Field(None, alias="order_no")
    customer_id: int | None = None
    customer_certainty: (
        Literal["confirmed", "forecast", "forecast_tentative"] | None
    ) = None
    source_raw: str | None = None
    line_items: list[ManualEmailIntakeLineItem] = Field(min_length=1)


class OrderRejectRequest(BaseSchema):
    """注文の承認却下リクエストスキーマ（却下理由は任意入力）"""

    model_config = ConfigDict(populate_by_name=True)

    reason: str | None = None


class OrderBulkApproveRequest(BaseSchema):
    """複数の承認待ち注文を一括承認するためのリクエストスキーマ"""

    model_config = ConfigDict(populate_by_name=True)

    order_ids: list[int] = Field(min_length=1)


class OrderApprovalLogResponse(BaseModel):
    """受注承認監査ログのレスポンススキーマ（表示用に注文番号・操作者名を付与）"""

    id: str
    order_id: int
    order_number: str | None
    action: Literal["request_approval", "approve", "reject", "withdraw"]
    actor_user_id: str
    actor_full_name: str | None
    actor_email: str | None
    reason: str | None
    created_at: str


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


class EmailIntakeResultResponse(BaseModel):
    """受信受注メール（order_attachments のステージング行）ごとの処理結果サマリ

    「パースは成功したが起票0件」（全明細が重複スキップ等）のケースを運用側が
    メーラーを開かずに追跡できるようにするための一覧用スキーマ（Issue #357）。
    """

    id: str
    received_at: str
    customer_id: int | None
    customer_name: str | None
    original_filename: str | None
    has_attachment: bool
    content_type: str | None
    parse_status: str
    gmail_message_id: str | None
    gmail_url: str | None
    signed_url: str | None
    created_order_count: int
    created_order_ids: list[int]
    parse_log_reasons: list[str]
