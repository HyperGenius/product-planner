from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import get_supabase_admin_client
from app.models.agent import AgentHeartbeatRequest, AgentHeartbeatResponse
from app.routers.agent._auth import AgentContext, get_agent_context
from app.utils.logger import get_logger
from supabase import Client  # type: ignore

heartbeat_router = APIRouter(prefix="/api/agent", tags=["Agent"])
logger = get_logger(__name__)


@heartbeat_router.post("/heartbeat", response_model=AgentHeartbeatResponse)
def post_heartbeat(
    body: AgentHeartbeatRequest,
    ctx: AgentContext = Depends(get_agent_context),
    admin_client: Client = Depends(get_supabase_admin_client),
):
    """エージェントの実行サマリを `agent_heartbeats` に1行記録する（Issue #470）。

    `tenant_id` / `agent_token_id` はトークンから解決した値だけを使う。
    ボディに `tenant_id` 等が含まれていても無視する。
    """
    row: dict[str, Any] = {
        "tenant_id": ctx.tenant_id,
        "agent_token_id": ctx.agent_token_id,
        "scanned_count": body.scanned_count,
        "sent_count": body.sent_count,
        "duplicate_count": body.duplicate_count,
        "error_count": body.error_count,
        "agent_version": body.agent_version,
        "payload": body.extra_payload(),
    }
    try:
        admin_client.table("agent_heartbeats").insert(row).execute()
    except Exception as exc:
        # 例外の詳細はログにのみ残し、レスポンスは固定文言にする（内部情報の露出防止）。
        logger.error(f"agent heartbeat insert failed: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to record heartbeat.",
        ) from exc
    return AgentHeartbeatResponse()
