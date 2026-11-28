"""日報の名寄せ（製品）で見せる、顧客の受注の状況 (Issue #646)。

製品を別名辞書に対応付けても、その顧客に割り付けの候補（`confirmed` / `in_progress`）の受注が
無ければ実績は未割当に残る。登録前に気づけるよう、候補ごとの受注の有無と、顧客の未出荷受注の
一覧を返す。表示専用で、照合・割り付けには影響させない（類似度で自動確定しない。Issue #488）。

あわせて、顧客の受注のうち日報の実績がまだ1つも割り付いていない受注の製品を返す（Issue #704）。
名寄せの行で「この日報の製品は、受注済みの製品のどれか」を最初に選べるようにするため。
"""

from collections.abc import Iterable
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


# ---------------------------------------------------------------------------
# 受注済みで日報の実績が結び付いていない製品 (Issue #704)
# ---------------------------------------------------------------------------


def _has_no_actuals(progress: list[dict[str, Any]]) -> bool:
    """受注の進捗の行がすべて未着手（良品数0）か。

    進捗の行が無い受注（日報で追う工程が1つも無い製品・まだ再計算されていない受注）は
    実績が付くことが無い／分からないので対象にしない（False）。
    """
    return bool(progress) and all(
        int(p.get("good_qty") or 0) == 0 and p.get("status") == "not_started"
        for p in progress
    )


def group_unstarted_ordered_products(
    orders: Iterable[dict[str, Any]],
    progress: Iterable[dict[str, Any]],
    products: Iterable[dict[str, Any]],
) -> list[dict[str, Any]]:
    """実績が1つも割り付いていない受注を製品ごとにまとめる（DB から切り離した純粋関数）。

    - `orders`: 顧客の割り付けの候補（confirmed / in_progress）の受注
    - `progress`: その受注の `order_process_progress` の行
    - `products`: 受注の製品（`id` / `name` / `code`）

    製品ごとに受注の件数・最寄りの希望納期と、代表の受注（希望納期の近い受注）の注文番号・
    受注数量を返す。並びは最寄りの希望納期の近い順（納期の無いものは最後）。日報の品名に
    近い順の並べ替えは呼び出し側（行ごとに品名が違う）で行う。
    """
    progress_by_order: dict[int, list[dict[str, Any]]] = {}
    for row in progress:
        progress_by_order.setdefault(int(row["order_id"]), []).append(row)
    product_by_id = {int(p["id"]): p for p in products}

    far = date.max.isoformat()
    grouped: dict[int, list[dict[str, Any]]] = {}
    for order in orders:
        if order.get("product_id") is None:
            continue
        product_id = int(order["product_id"])
        if product_id not in product_by_id:
            continue
        if not _has_no_actuals(progress_by_order.get(int(order["id"]), [])):
            continue
        grouped.setdefault(product_id, []).append(order)

    result: list[dict[str, Any]] = []
    for product_id, product_orders in grouped.items():
        product_orders.sort(key=lambda o: (_desired_deadline(o) or far, int(o["id"])))
        nearest = product_orders[0]
        product = product_by_id[product_id]
        result.append(
            {
                "product_id": product_id,
                "name": str(product.get("name") or ""),
                "code": product.get("code"),
                "order_count": len(product_orders),
                "nearest_deadline": _desired_deadline(nearest),
                "order_number": nearest.get("order_number"),
                "customer_order_no": nearest.get("customer_order_no"),
                "quantity": nearest.get("quantity"),
            }
        )
    result.sort(key=lambda r: (r["nearest_deadline"] or far, r["product_id"]))
    return result


def list_unstarted_ordered_products(
    db: Client, tenant_id: str, customer_id: int
) -> list[dict[str, Any]]:
    """顧客の受注のうち、日報の実績が1つも割り付いていない受注の製品を返す (Issue #704)。

    対象は割り付けの候補（confirmed / in_progress）の受注だけ。承認前の受注の製品に結び付けても
    実績は未割当（承認前の受注のみ）に残るので含めない。
    """
    orders = fetch_all_rows(
        lambda: (
            db.table(SupabaseTableName.ORDERS.value)
            .select(
                "id, order_number, customer_order_no, product_id, quantity, "
                "deadline_date, confirmed_deadline"
            )
            .eq("tenant_id", tenant_id)
            .eq("customer_id", customer_id)
            .in_("status", list(CANDIDATE_ORDER_STATUSES))
            .not_.is_("product_id", "null")
            .order("id")
        )
    )
    if not orders:
        return []
    order_ids = sorted({int(o["id"]) for o in orders})
    # 主キーは (order_id, process_routing_id) で `id` 列が無いので主キーで並べる（#683）
    progress = fetch_all_rows(
        lambda: (
            db.table(SupabaseTableName.ORDER_PROCESS_PROGRESS.value)
            .select("order_id, good_qty, status")
            .eq("tenant_id", tenant_id)
            .in_("order_id", order_ids)
            .order("order_id")
            .order("process_routing_id")
        )
    )
    product_ids = sorted({int(o["product_id"]) for o in orders})
    products = fetch_all_rows(
        lambda: (
            db.table(SupabaseTableName.PRODUCTS.value)
            .select("id, name, code")
            .eq("tenant_id", tenant_id)
            .in_("id", product_ids)
            .order("id")
        )
    )
    return group_unstarted_ordered_products(orders, progress, products)
