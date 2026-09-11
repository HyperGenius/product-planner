# routers/transaction/orders/routing_queue.py
"""工程未確定の draft 注文を残バッファ昇順で返す専門家キュー（Issue #376）。"""

from datetime import date, datetime

from fastapi import APIRouter, Depends

from app.dependencies import get_order_repo, get_product_repo
from app.repositories.supa_infra.master.product_repo import ProductRepository
from app.repositories.supa_infra.transaction.order_repo import OrderRepository
from app.utils.calendar import JST
from app.utils.logger import get_logger

router = APIRouter()

logger = get_logger(__name__)


@router.get("/unconfirmed-routing-queue")
def get_unconfirmed_routing_queue(
    repo: OrderRepository = Depends(get_order_repo),
    product_repo: ProductRepository = Depends(get_product_repo),
):
    """工程未確定の draft 注文を残バッファ昇順で返す専門家キュー"""
    logger.info("Fetching unconfirmed routing queue")
    # 実行ホストのTZに関わらず、残バッファはJST基準の暦日で判定する（Issue #376 PRレビュー対応）。
    today = datetime.now(JST).date()

    all_orders = repo.get_all_with_routing_status()
    draft_unconfirmed = [
        o
        for o in all_orders
        if o.get("status") == "draft" and o.get("has_unconfirmed_routings")
    ]

    products = product_repo.get_all()
    product_name_map = {p["id"]: p.get("name", "不明") for p in products}

    product_ids = [o["product_id"] for o in draft_unconfirmed if o.get("product_id")]
    unconfirmed_counts = product_repo.get_unconfirmed_routing_counts(product_ids)

    items = []
    for order in draft_unconfirmed:
        deadline = order.get("deadline_date")
        buffer_days: int | None = (
            (date.fromisoformat(deadline) - today).days if deadline else None
        )
        pid: int | None = order.get("product_id")
        items.append(
            {
                "order_id": order["id"],
                "order_no": order.get("order_number"),
                "product_name": product_name_map.get(pid, "不明")
                if pid is not None
                else "不明",
                "buffer_days": buffer_days,
                "desired_deadline": deadline,
                "unconfirmed_routing_count": unconfirmed_counts.get(pid, 0)
                if pid is not None
                else 0,
            }
        )

    items.sort(key=lambda x: (x["buffer_days"] is None, x["buffer_days"] or 0))
    return {"count": len(items), "items": items}
