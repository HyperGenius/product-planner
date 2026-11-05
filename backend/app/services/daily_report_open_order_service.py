"""日報の名寄せ（製品）で見せる、顧客の受注の状況 (Issue #646)。

製品を別名辞書に対応付けても、その顧客に割り付けの候補（`confirmed` / `in_progress`）の受注が
無ければ実績は未割当に残る。登録前に気づけるよう、候補ごとの受注の有無と、顧客の未出荷受注の
一覧を返す。表示専用で、照合・割り付けには影響させない（類似度で自動確定しない。Issue #488）。
"""

from datetime import date
from typing import Any

from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.services.daily_report_allocation_service import CANDIDATE_ORDER_STATUSES
from app.services.daily_report_name_matching_service import fetch_all_rows
from supabase import Client  # type: ignore

# 「未出荷」= 出荷・完了・取消しのいずれでもない受注。一覧では状態を併記する
OPEN_ORDER_STATUSES = (
    "draft",
    "pending_approval",
    "confirmed",
    "in_progress",
)


def _desired_deadline(row: dict[str, Any]) -> str | None:
    """希望納期（DB 列は deadline_date）。無ければ確定納期。"""
    return row.get("deadline_date") or row.get("confirmed_deadline")


def summarize_candidate_orders(
    db: Client, tenant_id: str, customer_id: int, product_ids: list[int]
) -> dict[int, dict[str, Any]]:
    """製品ごとの割り付け対象の受注件数と最寄りの希望納期を返す（受注の無い製品は含めない）。

    数える受注は割り付けの候補と同じ条件（`confirmed` / `in_progress`）。
    最寄りの納期は、該当する受注の希望納期（無ければ確定納期）の最小値。
    """
    if not product_ids:
        return {}
    rows = fetch_all_rows(
        lambda: (
            db.table(SupabaseTableName.ORDERS.value)
            .select("id, product_id, deadline_date, confirmed_deadline")
            .eq("tenant_id", tenant_id)
            .eq("customer_id", customer_id)
            .in_("status", list(CANDIDATE_ORDER_STATUSES))
            .in_("product_id", product_ids)
            .order("id")
        )
    )
    summary: dict[int, dict[str, Any]] = {}
    for row in rows:
        entry = summary.setdefault(
            int(row["product_id"]), {"open_order_count": 0, "nearest_deadline": None}
        )
        entry["open_order_count"] += 1
        deadline = _desired_deadline(row)
        current = entry["nearest_deadline"]
        if deadline and (current is None or deadline < current):
            entry["nearest_deadline"] = deadline
    return summary


def list_customer_open_orders(
    db: Client, tenant_id: str, customer_id: int
) -> list[dict[str, Any]]:
    """顧客の未出荷の受注（製品あり）を、希望納期の近い順（無いものは最後）に返す。

    `allocatable` は割り付けの候補（`confirmed` / `in_progress`）かどうか。
    """
    rows = fetch_all_rows(
        lambda: (
            db.table(SupabaseTableName.ORDERS.value)
            .select(
                "id, order_number, customer_order_no, product_id, quantity, status, "
                "deadline_date, confirmed_deadline"
            )
            .eq("tenant_id", tenant_id)
            .eq("customer_id", customer_id)
            .in_("status", list(OPEN_ORDER_STATUSES))
            .not_.is_("product_id", "null")
            .order("id")
        )
    )
    product_ids = sorted({int(r["product_id"]) for r in rows})
    names: dict[int, str] = {}
    if product_ids:
        products = fetch_all_rows(
            lambda: (
                db.table(SupabaseTableName.PRODUCTS.value)
                .select("id, name")
                .eq("tenant_id", tenant_id)
                .in_("id", product_ids)
                .order("id")
            )
        )
        names = {int(p["id"]): str(p["name"]) for p in products}

    orders = [
        {
            "order_id": int(r["id"]),
            "order_number": r.get("order_number"),
            "customer_order_no": r.get("customer_order_no"),
            "product_id": int(r["product_id"]),
            "product_name": names.get(int(r["product_id"]), ""),
            "quantity": r.get("quantity"),
            "desired_deadline": _desired_deadline(r),
            "status": r["status"],
            "allocatable": r["status"] in CANDIDATE_ORDER_STATUSES,
        }
        for r in rows
    ]
    far = date.max.isoformat()
    orders.sort(key=lambda o: (o["desired_deadline"] or far, o["order_id"]))
    return orders
