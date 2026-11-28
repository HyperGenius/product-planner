"""製品ごとの工程ルートと日報の工程の突き合わせの DB 入出力 (Issue #708, Epic #701)。

突き合わせ本体は純粋関数 `daily_report_product_processes`。ここでは日報の明細の集計（RPC
`daily_report_product_process_stats`）・名寄せのマスタと別名辞書・工程ルート・日報で追わない工程・
対象外の表記を読み、ハブの② 製品の工程を日報に合わせる の一覧と製品1つの比較を返す。

ルーター（ユーザー JWT）から呼ぶ。クエリはすべて `.eq("tenant_id", tenant_id)` で絞り込む。
"""

from dataclasses import dataclass
from datetime import date
from typing import Any

from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.services.daily_report_name_matcher import DailyReportNameMatcher, ProductRef
from app.services.daily_report_name_matching_service import (
    fetch_all_rows,
    fetch_ignored_keys,
    load_snapshot,
)
from app.services.daily_report_product_processes import (
    ProcessRaw,
    ProcessStat,
    ProductProcessComparison,
    RoutingProcess,
    aggregate_product_raws,
    compare_all_products,
    compare_product_processes,
    count_products_by_unmatched_raw,
    mismatched_products,
    raw_to_dict,
)
from supabase import Client  # type: ignore


def _to_date(value: Any) -> date | None:
    if value is None or isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def fetch_product_process_stats(
    db: Client, tenant_id: str, since: date | None
) -> list[ProcessStat]:
    """(顧客先, 商品名, 工程の表記) ごとの明細の数・最終の加工日（RPC）。"""
    params: dict[str, Any] = {"p_tenant_id": tenant_id}
    if since is not None:
        params["p_since"] = since.isoformat()
    rows = fetch_all_rows(
        lambda: (
            db.rpc("daily_report_product_process_stats", params)
            .order("product_raw")
            .order("customer_raw", nullsfirst=True)
            .order("process_raw")
        )
    )
    return [
        ProcessStat(
            customer_raw=row.get("customer_raw"),
            product_raw=row["product_raw"],
            process_raw=row["process_raw"],
            entry_count=int(row["entry_count"]),
            last_work_date=_to_date(row.get("last_work_date")),
        )
        for row in rows
    ]


def fetch_routing_processes(db: Client, tenant_id: str) -> list[RoutingProcess]:
    rows = fetch_all_rows(
        lambda: (
            db.table(SupabaseTableName.PROCESS_ROUTINGS.value)
            .select("id, product_id, sequence_order, process_name")
            .eq("tenant_id", tenant_id)
            .order("id")
        )
    )
    return [
        RoutingProcess(
            id=int(r["id"]),
            product_id=int(r["product_id"]),
            sequence_order=int(r["sequence_order"]),
            process_name=r.get("process_name"),
        )
        for r in rows
    ]


def fetch_untracked_process_names(db: Client, tenant_id: str) -> list[str]:
    rows = fetch_all_rows(
        lambda: (
            db.table(SupabaseTableName.UNTRACKED_PROCESS_NAMES.value)
            .select("id, process_name")
            .eq("tenant_id", tenant_id)
            .order("id")
        )
    )
    return [r["process_name"] for r in rows]


@dataclass
class _Loaded:
    products: dict[int, ProductRef]
    by_product: dict[int, dict[str, ProcessRaw]]
    routings: list[RoutingProcess]
    untracked: list[str]


def _load(db: Client, tenant_id: str, since: date | None) -> _Loaded:
    snapshot = load_snapshot(db, tenant_id)
    matcher = DailyReportNameMatcher(snapshot)
    ignored_process_raws = frozenset(
        raw for kind, raw, _ in fetch_ignored_keys(db, tenant_id) if kind == "process"
    )
    by_product = aggregate_product_raws(
        fetch_product_process_stats(db, tenant_id, since),
        matcher,
        ignored_process_raws,
    )
    return _Loaded(
        products={p.id: p for p in snapshot.products},
        by_product=by_product,
        routings=fetch_routing_processes(db, tenant_id),
        untracked=fetch_untracked_process_names(db, tenant_id),
    )


def _product_fields(product_id: int, products: dict[int, ProductRef]) -> dict[str, Any]:
    product = products.get(product_id)
    return {
        "product_id": product_id,
        "product_name": product.name if product else None,
        "product_code": product.code if product else None,
    }


def list_mismatched_product_processes(
    db: Client, tenant_id: str, since: date | None
) -> list[dict[str, Any]]:
    """工程ルートと日報の工程が合わない製品（合わない工程の明細の多い順）。"""
    loaded = _load(db, tenant_id, since)
    comparisons = compare_all_products(
        loaded.by_product, loaded.routings, loaded.untracked
    )
    return [
        {
            **_product_fields(c.product_id, loaded.products),
            "has_routings": c.has_routings,
            "mismatch_count": c.mismatch_count,
            "entry_count": c.mismatch_entry_count,
        }
        for c in mismatched_products(comparisons)
    ]


def get_product_process_comparison(
    db: Client, tenant_id: str, product_id: int, since: date | None
) -> dict[str, Any] | None:
    """製品1つの工程ルートと日報の工程の比較。製品がこのテナントに無ければ None。"""
    loaded = _load(db, tenant_id, since)
    if product_id not in loaded.products:
        return None
    comparison = compare_product_processes(
        product_id,
        loaded.by_product.get(product_id, {}),
        loaded.routings,
        loaded.untracked,
        count_products_by_unmatched_raw(loaded.by_product),
    )
    return comparison_to_dict(comparison, loaded.products)


def comparison_to_dict(
    comparison: ProductProcessComparison, products: dict[int, ProductRef]
) -> dict[str, Any]:
    return {
        **_product_fields(comparison.product_id, products),
        "has_routings": comparison.has_routings,
        "mismatch_count": comparison.mismatch_count,
        "routings": [
            {
                "routing_id": row.routing_id,
                "sequence_order": row.sequence_order,
                "process_name": row.process_name,
                "untracked": row.untracked,
                "raws": [raw_to_dict(raw) for raw in row.raws],
            }
            for row in comparison.routings
        ],
        "off_routing": [
            {
                "process_name": row.process_name,
                "untracked": row.untracked,
                "raws": [raw_to_dict(raw) for raw in row.raws],
            }
            for row in comparison.off_routing
        ],
        "unmatched": [
            {**raw_to_dict(item.raw), "other_product_count": item.other_product_count}
            for item in comparison.unmatched
        ],
    }
