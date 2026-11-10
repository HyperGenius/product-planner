# backend/app/models/agent.py
"""日報取り込みエージェント向け API のスキーマ (Issue #470, #471)。"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# エージェントが送ってきても payload に残さないキー。
# tenant_id / agent_token_id は必ずトークンから解決するため、リクエスト由来の値は捨てる。
_IGNORED_PAYLOAD_KEYS = frozenset({"tenant_id", "agent_token_id"})


class AgentHeartbeatRequest(BaseModel):
    """エージェントの実行ごとのサマリ。

    集計値と `agent_version` は `agent_heartbeats` の列に、それ以外の未知の
    フィールドは `payload`（jsonb）にそのまま保存する。
    """

    model_config = ConfigDict(extra="allow")

    scanned_count: int = Field(default=0, ge=0, description="走査したファイル数")
    sent_count: int = Field(default=0, ge=0, description="送信したファイル数")
    duplicate_count: int = Field(
        default=0, ge=0, description="重複（送信済み）と判定されたファイル数"
    )
    error_count: int = Field(default=0, ge=0, description="送信に失敗したファイル数")
    agent_version: str | None = Field(
        default=None, max_length=100, description="エージェントのバージョン"
    )

    def extra_payload(self) -> dict[str, Any]:
        """スキーマに無いフィールドを `payload` 保存用に取り出す。"""
        return {
            k: v
            for k, v in (self.model_extra or {}).items()
            if k not in _IGNORED_PAYLOAD_KEYS
        }


class AgentHeartbeatResponse(BaseModel):
    """heartbeat 記録結果のレスポンス"""

    status: Literal["ok"] = "ok"


class DailyReportUploadResponse(BaseModel):
    """日報ファイル受信結果のレスポンス (Issue #471)"""

    status: Literal["stored", "duplicate"] = Field(
        description="stored: 新規保存 / duplicate: 同一内容（同一 sha256）を受信済み"
    )
    sha256: str = Field(description="受信したファイルの SHA-256（小文字の hex）")


class ShipmentFileUploadResponse(BaseModel):
    """送品ファイル（弥生販売の売上伝票 CSV）のアップロード結果 (Issue #662)。"""

    status: Literal["stored", "duplicate"] = Field(
        description="stored: 新規保存 / duplicate: 同一内容を受信済み"
    )
    sha256: str = Field(description="受信したファイルの SHA-256（小文字 hex）")


class ShipmentFileItem(BaseModel):
    """取り込み済みの送品ファイル1件（一覧表示用。パスなど経路の詳細は返さない）。"""

    id: str
    file_name: str
    source: Literal["agent", "web"]
    size_bytes: int
    received_at: str


class ShipmentFileListResponse(BaseModel):
    """最終取り込み日時と直近の送品ファイル (Issue #662)。"""

    last_received_at: str | None = Field(
        default=None, description="最後にファイルを受信した日時（無ければ null）"
    )
    files: list[ShipmentFileItem] = Field(default_factory=list)
