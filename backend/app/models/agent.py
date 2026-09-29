# backend/app/models/agent.py
"""日報取り込みエージェント向け API のスキーマ (Issue #470)。"""

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
