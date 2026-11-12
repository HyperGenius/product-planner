# backend/app/services/shipment_matching_service.py
"""弥生の売上明細の名寄せ・突合の DB 入出力 (Issue #667)。

照合・突合のロジック本体は `shipment_matcher`（純粋関数）。ここではマスタ・受注・辞書と明細を
読み込み、送品の消し込み（受注ごとの弥生の送品数量）と名寄せの画面（得意先・商品の一覧）の形にする。

ルーター（ユーザー JWT）から呼ばれる。RLS に加えて、クエリはすべて `.eq("tenant_id", tenant_id)` で絞る。
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.services.daily_report_name_matching_service import fetch_all_rows
from app.services.shipment_matcher import (
    CustomerInfo,
    EntryMatch,
    OrderInfo,
    ProductInfo,
    ShipmentMatcher,
    ShipmentSnapshot,
    normalize_code,
    summarize_by_order,
)
from app.utils.calendar import JST
from supabase import Client  # type: ignore

_ENTRY_COLUMNS = (
    "id, sales_date, slip_no, customer_code, customer_name, product_code, "
    "product_name, quantity, unit, note"
)


def _select_all(
    db: Client,
    table: SupabaseTableName,
    columns: str,
    tenant_id: str,
    extra: Callable[[Any], Any] = lambda q: q,
) -> list[dict[str, Any]]:
    return fetch_all_rows(
        lambda: extra(
            db.table(table.value).select(columns).eq("tenant_id", tenant_id)
        ).order("id")
    )


def _to_date(value: Any) -> date | None:
    if not value:
        return None
    return date.fromisoformat(str(value)[:10])


def _order_date_jst(value: Any) -> date | None:
    """`orders.order_date`（timestamptz）の JST の暦日。"""
    if not value:
        return None
    text = str(value)
    try:
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return _to_date(text)
    if moment.tzinfo is None:
        return moment.date()
    return moment.astimezone(JST).date()


def load_snapshot(db: Client, tenant_id: str) -> ShipmentSnapshot:
    customers = _select_all(
        db, SupabaseTableName.CUSTOMERS, "id, name, alias, status", tenant_id
    )
    products = _select_all(db, SupabaseTableName.PRODUCTS, "id, name, code", tenant_id)
    aliases = _select_all(
        db,
        SupabaseTableName.PRODUCT_NAME_ALIASES,
        "id, raw_text, product_id",
        tenant_id,
    )
    orders = _select_all(
        db,
        SupabaseTableName.ORDERS,
        "id, customer_id, product_id, quantity, status, deadline_date, order_date, "
        "customer_order_no",
        tenant_id,
        lambda q: q.eq("order_type", "production").not_.is_("product_id", "null"),
    )
    customer_links = _select_all(
        db,
        SupabaseTableName.SHIPMENT_CUSTOMER_LINKS,
        "id, customer_code, customer_id",
        tenant_id,
    )
    product_links = _select_all(
        db,
        SupabaseTableName.SHIPMENT_PRODUCT_LINKS,
        "id, customer_code, product_code, product_id",
        tenant_id,
    )
    ignored = _select_all(
        db,
        SupabaseTableName.SHIPMENT_IGNORED_CODES,
        "id, kind, customer_code, product_code",
        tenant_id,
    )

    aliases_by_product: dict[int, list[str]] = {}
    for alias in aliases:
        aliases_by_product.setdefault(int(alias["product_id"]), []).append(
            alias["raw_text"]
        )

    snapshot = ShipmentSnapshot(
        customers=[
            CustomerInfo(
                id=int(c["id"]),
                name=c["name"],
                alias=c.get("alias"),
                status=c.get("status"),
            )
            for c in customers
        ],
        products=[
            ProductInfo(
                id=int(p["id"]),
                name=p["name"],
                code=p.get("code"),
                aliases=tuple(aliases_by_product.get(int(p["id"]), [])),
            )
            for p in products
        ],
        orders=[
            OrderInfo(
                id=int(o["id"]),
                customer_id=o.get("customer_id"),
                product_id=o.get("product_id"),
                quantity=o.get("quantity"),
                status=o["status"],
                deadline_date=_to_date(o.get("deadline_date")),
                order_date=_order_date_jst(o.get("order_date")),
                customer_order_no=o.get("customer_order_no"),
            )
            for o in orders
        ],
    )
    for link in customer_links:
        snapshot.customer_links.setdefault(link["customer_code"], set()).add(
            int(link["customer_id"])
        )
    for link in product_links:
        snapshot.product_links[(link["customer_code"], link["product_code"])] = int(
            link["product_id"]
        )
    for row in ignored:
        if row["kind"] == "customer":
            snapshot.ignored_customers.add(row["customer_code"])
        else:
            snapshot.ignored_products.add((row["customer_code"], row["product_code"]))
    return snapshot


def fetch_entries(db: Client, tenant_id: str) -> list[dict[str, Any]]:
    return _select_all(
        db, SupabaseTableName.SHIPMENT_ENTRIES, _ENTRY_COLUMNS, tenant_id
    )


# ---------------------------------------------------------------------------
# 送品の消し込み: 受注ごとの弥生の送品
# ---------------------------------------------------------------------------


def _entry_ref(match: EntryMatch) -> dict[str, Any]:
    entry = match.entry
    return {
        "id": entry["id"],
        "sales_date": str(entry["sales_date"])[:10],
        "slip_no": entry.get("slip_no"),
        "quantity": entry.get("quantity"),
        "note": entry.get("note"),
        "product_name": entry.get("product_name"),
        "method": match.method,
        "candidate_order_ids": list(match.candidate_order_ids),
    }


def get_order_shipments(
    db: Client, tenant_id: str, order_ids: list[int] | None
) -> dict[str, Any]:
    """受注ごとの弥生の送品（分納を合算）。`order_ids` が None なら当たった受注すべて。

    突合は候補が他の受注と重なるか（複数の受注に当たるか）を見るため、明細・受注は全件で行い、
    返すときだけ絞る。
    """
    snapshot = load_snapshot(db, tenant_id)
    matcher = ShipmentMatcher(snapshot)
    entries = fetch_entries(db, tenant_id)
    shipments = summarize_by_order(matcher.match_entry(e) for e in entries)
    quantities = {o.id: o.quantity for o in snapshot.orders}

    wanted = set(order_ids) if order_ids is not None else None
    items = []
    for order_id, shipment in sorted(shipments.items()):
        if wanted is not None and order_id not in wanted:
            continue
        order_quantity = quantities.get(order_id)
        items.append(
            {
                "order_id": order_id,
                "shipped_qty": shipment.shipped_qty,
                "order_quantity": order_quantity,
                "is_fully_shipped": (
                    bool(shipment.entries)
                    and order_quantity is not None
                    and shipment.shipped_qty >= order_quantity
                ),
                "last_sales_date": (
                    shipment.last_sales_date.isoformat()
                    if shipment.last_sales_date
                    else None
                ),
                "entries": [_entry_ref(m) for m in shipment.entries],
                "ambiguous_entries": [
                    _entry_ref(m) for m in shipment.ambiguous_entries
                ],
            }
        )
    latest = max((str(e["sales_date"])[:10] for e in entries), default=None)
    return {"latest_sales_date": latest, "items": items}


# ---------------------------------------------------------------------------
# 名寄せの画面: 得意先・商品の一覧
# ---------------------------------------------------------------------------


@dataclass
class _Group:
    """同じキーの明細のまとめ。表示する弥生の表記は売上日が最も新しい行の値を採る。"""

    latest: dict[str, Any]
    entry_count: int = 0
    entries: list[dict[str, Any]] = field(default_factory=list)

    def add(self, entry: dict[str, Any]) -> None:
        self.entry_count += 1
        self.entries.append(entry)
        if str(entry["sales_date"]) >= str(self.latest["sales_date"]):
            self.latest = entry


def _group_by(
    entries: list[dict[str, Any]], key: Callable[[dict[str, Any]], Any]
) -> dict[Any, _Group]:
    groups: dict[Any, _Group] = {}
    for entry in entries:
        k = key(entry)
        if k not in groups:
            groups[k] = _Group(latest=entry)
        groups[k].add(entry)
    return groups


def _ids_by_key(
    rows: list[dict[str, Any]], key: Callable[[dict[str, Any]], Any]
) -> dict[Any, str]:
    return {key(r): r["id"] for r in rows}


def list_customer_items(db: Client, tenant_id: str) -> list[dict[str, Any]]:
    """得意先ごとの照合状況と候補（名寄せの画面）。"""
    snapshot = load_snapshot(db, tenant_id)
    matcher = ShipmentMatcher(snapshot)
    entries = fetch_entries(db, tenant_id)
    links = _select_all(
        db,
        SupabaseTableName.SHIPMENT_CUSTOMER_LINKS,
        "id, customer_code, customer_id",
        tenant_id,
    )
    ignored = _ids_by_key(
        _select_all(
            db,
            SupabaseTableName.SHIPMENT_IGNORED_CODES,
            "id, kind, customer_code, product_code",
            tenant_id,
            lambda q: q.eq("kind", "customer"),
        ),
        lambda r: r["customer_code"],
    )

    items = []
    for code_key, group in _group_by(
        entries, lambda e: normalize_code(e["customer_code"])
    ).items():
        latest = group.latest
        resolution = matcher.resolve_customer(
            latest["customer_code"], latest.get("customer_name")
        )
        # 商流の推定: 製品が決まらない行の品名が、別の顧客の受注の製品に当たるか
        flow_counts: dict[int, int] = {}
        unmatched_products = 0
        for entry in group.entries:
            match = matcher.match_entry(entry)
            if match.status not in ("unmatched_product", "unmatched_customer"):
                continue
            unmatched_products += 1
            for candidate in matcher.cross_customer_candidates(
                entry.get("product_name"), resolution.customer_ids
            ):
                for customer_id in candidate.customer_ids:
                    flow_counts[customer_id] = flow_counts.get(customer_id, 0) + 1
        items.append(
            {
                "customer_code": latest["customer_code"],
                "code_key": code_key,
                "customer_name": latest.get("customer_name"),
                "entry_count": group.entry_count,
                "last_sales_date": str(latest["sales_date"])[:10],
                "links": [
                    {"id": r["id"], "customer_id": int(r["customer_id"])}
                    for r in links
                    if r["customer_code"] == code_key
                ],
                "auto_customer_id": (
                    next(iter(resolution.customer_ids))
                    if resolution.method == "name"
                    else None
                ),
                "ignored_id": ignored.get(code_key),
                "name_candidate_ids": matcher.suggest_customers_by_name(
                    latest.get("customer_name")
                ),
                "flow_candidates": [
                    {"customer_id": customer_id, "entry_count": count}
                    for customer_id, count in sorted(
                        flow_counts.items(), key=lambda kv: (-kv[1], kv[0])
                    )
                ],
                "unmatched_entry_count": unmatched_products,
            }
        )
    items.sort(key=lambda i: i["last_sales_date"], reverse=True)
    items.sort(key=lambda i: i["entry_count"], reverse=True)
    return items


def list_product_items(db: Client, tenant_id: str) -> list[dict[str, Any]]:
    """(得意先, 商品コード) ごとの照合状況と候補（名寄せの画面）。"""
    snapshot = load_snapshot(db, tenant_id)
    matcher = ShipmentMatcher(snapshot)
    entries = fetch_entries(db, tenant_id)
    links = _select_all(
        db,
        SupabaseTableName.SHIPMENT_PRODUCT_LINKS,
        "id, customer_code, product_code, product_id",
        tenant_id,
    )
    link_by_key = {(r["customer_code"], r["product_code"]): r for r in links}
    ignored_rows = _select_all(
        db,
        SupabaseTableName.SHIPMENT_IGNORED_CODES,
        "id, kind, customer_code, product_code",
        tenant_id,
    )
    ignored_products = _ids_by_key(
        [r for r in ignored_rows if r["kind"] == "product"],
        lambda r: (r["customer_code"], r["product_code"]),
    )
    ignored_customers = {
        r["customer_code"] for r in ignored_rows if r["kind"] == "customer"
    }

    items = []
    for key, group in _group_by(
        entries,
        lambda e: (
            normalize_code(e["customer_code"]),
            normalize_code(e["product_code"]),
        ),
    ).items():
        customer_key, product_key = key
        latest = group.latest
        customer = matcher.resolve_customer(
            latest["customer_code"], latest.get("customer_name")
        )
        resolution = matcher.resolve_product(
            latest["customer_code"],
            latest["product_code"],
            latest.get("product_name"),
            customer.customer_ids,
        )
        link = link_by_key.get(key)
        cross = (
            matcher.cross_customer_candidates(
                latest.get("product_name"), customer.customer_ids
            )
            if resolution.product_id is None
            else []
        )
        items.append(
            {
                "customer_code": latest["customer_code"],
                "customer_code_key": customer_key,
                "customer_name": latest.get("customer_name"),
                "product_code": latest["product_code"],
                "product_code_key": product_key,
                "product_name": latest.get("product_name"),
                "entry_count": group.entry_count,
                "last_sales_date": str(latest["sales_date"])[:10],
                "customer_ids": sorted(customer.customer_ids),
                "link": (
                    {"id": link["id"], "product_id": int(link["product_id"])}
                    if link
                    else None
                ),
                "auto_product_id": (
                    resolution.product_id if resolution.method != "link" else None
                ),
                "auto_method": (
                    resolution.method if resolution.method != "link" else None
                ),
                "ignored_id": ignored_products.get(key),
                "customer_ignored": customer_key in ignored_customers,
                "candidate_product_ids": list(resolution.candidate_ids),
                "cross_customer_candidates": [
                    {"product_id": c.product_id, "customer_ids": list(c.customer_ids)}
                    for c in cross
                ],
            }
        )
    items.sort(key=lambda i: i["last_sales_date"], reverse=True)
    items.sort(key=lambda i: i["entry_count"], reverse=True)
    return items
