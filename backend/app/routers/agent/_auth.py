"""日報取り込みエージェントのトークン認証 (Issue #470)。

エージェントはユーザー JWT を持たないため、テナント単位のエージェントトークン
（`Authorization: Bearer <token>`）で認証し、service role でトークンを照合する。
`tenant_id` は必ずトークンから解決し、リクエストのボディ・ヘッダ・クエリの値は
一切使わない。service role は RLS をバイパスするので、呼び出し側は以降の
クエリをすべて `.eq("tenant_id", ctx.tenant_id)` で明示的に絞り込むこと。
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, cast

from fastapi import Depends, HTTPException, Request, status

from app.dependencies import get_supabase_admin_client
from app.services.agent_token_service import hash_agent_token
from app.utils.logger import get_logger
from supabase import Client  # type: ignore

logger = get_logger(__name__)

# ヘッダ無し・形式不正・該当なし・失効済みを区別せず同じ文言で返す
# （トークンの存在や失効状態を外部に漏らさないため）。
_UNAUTHORIZED_DETAIL = "Invalid agent token."


@dataclass(frozen=True)
class AgentContext:
    """認証済みエージェントのコンテキスト（トークンから解決した値のみを持つ）。"""

    tenant_id: str
    agent_token_id: str


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=_UNAUTHORIZED_DETAIL,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _extract_bearer_token(request: Request) -> str | None:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header.removeprefix("Bearer ").strip()
    return token or None


def get_agent_context(
    request: Request,
    admin_client: Client = Depends(get_supabase_admin_client),
) -> AgentContext:
    """Bearer トークンを照合し、エージェントのコンテキストを返す。

    認証に成功したら `agent_tokens.last_used_at` を更新する。
    """
    token = _extract_bearer_token(request)
    if token is None:
        raise _unauthorized()

    try:
        res = (
            admin_client.table("agent_tokens")
            .select("id, tenant_id, revoked_at")
            .eq("token_hash", hash_agent_token(token))
            .maybe_single()
            .execute()
        )
    except Exception as exc:
        logger.error(f"agent token lookup failed: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Agent authentication failed.",
        ) from exc

    if not res or not res.data:
        raise _unauthorized()
    row = cast(dict[str, Any], res.data)
    if row.get("revoked_at"):
        raise _unauthorized()

    ctx = AgentContext(tenant_id=row["tenant_id"], agent_token_id=row["id"])

    # last_used_at は稼働状況の目安にすぎないため、更新失敗で本処理は止めない。
    try:
        (
            admin_client.table("agent_tokens")
            .update({"last_used_at": datetime.now(UTC).isoformat()})
            .eq("id", ctx.agent_token_id)
            .eq("tenant_id", ctx.tenant_id)
            .execute()
        )
    except Exception as exc:
        logger.warning(
            f"failed to update agent_tokens.last_used_at: {exc}", exc_info=True
        )

    return ctx
