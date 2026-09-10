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
    # 作業開始日（工場が着手する日、YYYY-MM-DD）。受注起票日とは別物（Issue #372）。
    # 過去日は president / platform_admin のみ設定可。
    scheduling_start_date: str | None = None


class OrderSimulateRequest(BaseSchema):
    """注文シミュレーションのリクエストスキーマ"""

    model_config = ConfigDict(populate_by_name=True)

    product_id: int
    quantity: int
    deadline_date: str | None = Field(None, alias="desired_deadline")
    standalone: bool = False
    # 作業開始日（YYYY-MM-DD）。未指定なら実行日時から着手（従来挙動）。Issue #372。
    scheduling_start_date: str | None = None


class OrderSimulateByIdRequest(BaseSchema):
    """既存受注の再シミュレーション時に作業開始日を上書き指定するためのリクエスト（Issue #372）。

    本文なしでも呼べる（その場合は受注に保存済みの scheduling_start_date を使う）。
    """

    model_config = ConfigDict(populate_by_name=True)

    scheduling_start_date: str | None = None


class OrderUpdate(BaseSchema):
    """注文を更新するためのスキーマ"""

    model_config = ConfigDict(populate_by_name=True)

    order_number: str | None = Field(None, alias="order_no")
    product_id: int | None = None
    quantity: int | None = None
    deadline_date: str | None = Field(None, alias="desired_deadline")
    customer_id: int | None = None
    # 作業開始日（YYYY-MM-DD）。過去日は president / platform_admin のみ（Issue #372）。
    scheduling_start_date: str | None = None


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
    # 顧客側の注文番号／注文No.（Issue #366。観察用・dedupe には未使用）
    customer_order_no: str | None = None


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


class ShipOverdueDraftsResponse(BaseModel):
    """納期超過の下書き受注を一括で送品済みにした結果のレスポンススキーマ（Issue #367）"""

    shipped_count: int
    order_ids: list[int]


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


EmailIntakeOutcome = Literal["created", "skipped", "failed"]
"""受信受注メール1件の処理結果を固定した3値の観点（Issue #422）。

- ``created``: 1件以上の注文が新規起票された（通常フロー。レビューして確定する）
- ``skipped``: 正常に処理されたが意図的に起票しなかった（重複・対象外等。基本対応不要）
- ``failed``: 抽出・処理が完了できず起票に至らなかった（手動起票・再送など対応必須）

``parse_status`` / ``created_order_count`` / ``parse_log_reasons`` の組み合わせから
サーバー側で導出する。フロントでの再計算は行わない。
"""


class EmailIntakeResultResponse(BaseModel):
    """受信受注メール（order_attachments のステージング行）ごとの処理結果サマリ

    「パースは成功したが起票0件」（全明細が重複スキップ等）のケースを運用側が
    メーラーを開かずに追跡できるようにするための一覧用スキーマ（Issue #357）。

    ``outcome`` は運用者が取るべきアクションを1つの軸に固定したもの（Issue #422）。
    ``parse_status`` 等の生フィールドは詳細（展開表示）用に残す。
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
    # 以下は parse_status / created_order_count / parse_log_reasons からの導出値（Issue #422）
    outcome: EmailIntakeOutcome
    # outcome='created' だが要確認（品番未照合・複数受注の疑い等）
    needs_attention: bool
    # 読み取り不能PDF等で中身が空の下書きだけが起票された（outcome='failed'）
    empty_draft: bool
