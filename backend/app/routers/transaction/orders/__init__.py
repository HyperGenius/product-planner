# routers/transaction/orders/__init__.py
"""orders_router を組み立てるパッケージ（Issue #376）。

肥大化していた単一ファイル orders.py を責務ごとのモジュールへ分割したもの。
挙動（エンドポイントのパス・レスポンス・権限・エラー）は変更しない。
`from app.routers.transaction import orders_router` の公開IFもそのまま維持する。

ルート解決順序に注意: FastAPI/Starlette はパステンプレートを登録順に評価するため、
`/{order_id}` のような単一動的セグメントの静的パスと衝突しうるルート
（`/unconfirmed-routing-queue`, `/approval-logs`, `/approval-logs/export`,
`/email-intake-results`）は、crud（`/{order_id}`）より先に include すること。
"""

from fastapi import APIRouter

from ._shared import get_settings_repo
from .approval_logs import router as approval_logs_router
from .approval_workflow import router as approval_workflow_router
from .attachments import router as attachments_router
from .crud import router as crud_router
from .email_intake import _derive_email_intake_outcome
from .email_intake import router as email_intake_router
from .routing_queue import router as routing_queue_router
from .simulation import router as simulation_router

orders_router = APIRouter(tags=["Transaction (Orders)"])

# include_router() は自身の prefix 引数のみをサブルーターのパスに適用する
# （親 APIRouter コンストラクタの prefix は、親自身に直接登録したルートにしか
# 効かない）。そのため各サブルーターの include 時に明示的に prefix="/orders" を渡す。
orders_router.include_router(routing_queue_router, prefix="/orders")
orders_router.include_router(approval_logs_router, prefix="/orders")
orders_router.include_router(email_intake_router, prefix="/orders")
orders_router.include_router(crud_router, prefix="/orders")
orders_router.include_router(attachments_router, prefix="/orders")
orders_router.include_router(simulation_router, prefix="/orders")
orders_router.include_router(approval_workflow_router, prefix="/orders")

__all__ = [
    "orders_router",
    # 以下はテスト互換のための再エクスポート（Issue #376）
    "get_settings_repo",
    "_derive_email_intake_outcome",
]
