from datetime import datetime

from pydantic import BaseModel, Field

from app.models.tenant.pin_schemas import PIN_PATTERN


class DeviceRegisterResponse(BaseModel):
    """端末信頼登録レスポンスのスキーマ"""

    device_id: str = Field(
        description="発行された端末識別子（クライアント側で保存する）"
    )
    expires_at: datetime = Field(description="端末信頼の有効期限")


class DeviceMemberOption(BaseModel):
    """PINログイン画面に表示するメンバー選択肢"""

    user_id: str = Field(description="ユーザーID")
    full_name: str | None = Field(default=None, description="氏名")


class DeviceStatusResponse(BaseModel):
    """端末信頼状態レスポンスのスキーマ"""

    trusted: bool = Field(description="この端末が信頼済みかどうか")
    tenant_id: str | None = Field(default=None, description="信頼済みテナントID")
    members: list[DeviceMemberOption] = Field(
        default_factory=list, description="PIN設定済みメンバーの一覧"
    )


class DeviceTrustResponse(BaseModel):
    """端末信頼レコードのレスポンススキーマ（端末管理一覧用）"""

    device_id: str = Field(description="端末識別子")
    registered_by: str = Field(description="登録者のユーザーID")
    created_at: datetime = Field(description="登録日時")
    expires_at: datetime = Field(description="有効期限")
    revoked_at: datetime | None = Field(default=None, description="失効日時")


class PinLoginRequest(BaseModel):
    """PINログインリクエストのスキーマ"""

    device_id: str = Field(description="端末識別子")
    user_id: str = Field(description="ログインするユーザーID")
    pin: str = Field(pattern=PIN_PATTERN, description="4桁の数字PIN")


class PinLoginResponse(BaseModel):
    """PINログイン成功レスポンスのスキーマ"""

    access_token: str
    refresh_token: str
