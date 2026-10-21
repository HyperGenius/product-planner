"""日報の照合状況と未割当の実績の参照 (Issue #542, 親Issue #485)。

集計は `daily_report_coverage`（純粋関数）。ここではルーターからユーザー JWT（RLS）で呼ばれ、
cron が保存した割り付けの結果（`daily_report_allocation_runs.coverage` と
`daily_report_unallocated_actuals`）を読んで、照合状況のサマリと未割当のまとめを返す。
再計算はしない（割り付けは cron がテナント単位で全量を置き換える。Issue #490）。
"""

from datetime import date, datetime
from typing import Any, cast

from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.services.daily_report_coverage import (
    CLOSED_ORDER_STATUSES,
    UNAPPROVED_ORDER_STATUSES,
    MonthlyCoverage,
    UnallocatedRow,
    build_summary,
    group_unallocated,
    in_period,
    period_start,
)
from app.services.daily_report_name_matching_service import fetch_all_rows
from app.utils.calendar import JST
from supabase import Client  # type: ignore


def _fetch_run(db: Client, tenant_id: str) -> tuple[str | None, list[MonthlyCoverage]]:
    result = (
        db.table(SupabaseTableName.DAILY_REPORT_ALLOCATION_RUNS.value)
        .select("computed_at, coverage")
        .eq("tenant_id", tenant_id)
        .limit(1)
        .execute()
    )
    rows = cast(list[dict[str, Any]], result.data or [])
    if not rows:
        return None, []
    coverage = rows[0].get("coverage") or []
    return rows[0]["computed_at"], [MonthlyCoverage.from_json(m) for m in coverage]


def _fetch_unallocated_rows(
    db: Client, tenant_id: str, since: date | None
) -> list[UnallocatedRow]:
    def build_query():
        query = (
            db.table(SupabaseTableName.DAILY_REPORT_UNALLOCATED_ACTUALS.value)
            .select("id, product_id, customer_id, process_name, work_date, qty, reason")
            .eq("tenant_id", tenant_id)
        )
        if since is not None:
            query = query.or_(f"work_date.gte.{since.isoformat()},work_date.is.null")
        return query.order("id")

    return [
        UnallocatedRow(
            product_id=int(row["product_id"]),
            customer_id=row.get("customer_id"),
            process_name=row["process_name"],
            work_date=date.fromisoformat(row["work_date"])
            if row.get("work_date")
            else None,
            qty=int(row["qty"]),
            reason=row["reason"],
        )
        for row in fetch_all_rows(build_query)
    ]


def _fetch_other_order_statuses(db: Client, tenant_id: str) -> dict[int, set[str]]:
    """製品ごとの、割り付けの候補にならない受注（下書き〜承認待ち・出荷済み・完了）のステータス。"""
    rows = fetch_all_rows(
        lambda: (
            db.table(SupabaseTableName.ORDERS.value)
            .select("id, product_id, status")
            .eq("tenant_id", tenant_id)
            .in_("status", [*UNAPPROVED_ORDER_STATUSES, *CLOSED_ORDER_STATUSES])
            .not_.is_("product_id", "null")
            .order("id")
        )
    )
    statuses: dict[int, set[str]] = {}
    for row in rows:
        statuses.setdefault(int(row["product_id"]), set()).add(row["status"])
    return statuses


def _fetch_by_id(db: Client, table: str, columns: str, tenant_id: str) -> list[dict]:
    return fetch_all_rows(
        lambda: db.table(table).select(columns).eq("tenant_id", tenant_id).order("id")
    )


def _fetch_routed_product_ids(db: Client, tenant_id: str) -> set[int]:
    rows = _fetch_by_id(
        db, SupabaseTableName.PROCESS_ROUTINGS.value, "id, product_id", tenant_id
    )
    return {int(r["product_id"]) for r in rows if r.get("product_id") is not None}


def _iso(value: date | None) -> str | None:
    return value.isoformat() if value else None


def get_coverage(
    db: Client,
    tenant_id: str,
    months: int | None,
    today: date | None = None,
) -> dict[str, Any]:
    """照合状況のサマリと、未割当の (製品, 工程名, 理由) ごとのまとめ（数量の多い順）。

    `months` は直近何か月（今月を含む、JST）の加工日で絞り込むか。None ならすべての期間。
    """
    since = period_start(today or datetime.now(JST).date(), months)
    computed_at, coverage = _fetch_run(db, tenant_id)
    rows = _fetch_unallocated_rows(db, tenant_id, since)
    groups = group_unallocated(rows, _fetch_other_order_statuses(db, tenant_id))
    summary = build_summary(
        [m for m in coverage if in_period(m.work_month, since)], groups
    )

    products = {
        int(p["id"]): p
        for p in _fetch_by_id(
            db, SupabaseTableName.PRODUCTS.value, "id, name, code", tenant_id
        )
    }
    customers = {
        int(c["id"]): c["name"]
        for c in _fetch_by_id(
            db, SupabaseTableName.CUSTOMERS.value, "id, name", tenant_id
        )
    }
    routed = _fetch_routed_product_ids(db, tenant_id)

    return {
        "computed_at": computed_at,
        "since": since,
        "summary": {
            "total_qty": summary.total_qty,
            "allocated_qty": summary.allocated_qty,
            "unallocated_qty": summary.unallocated_qty,
            "unmatched_rows": summary.unmatched_rows,
            "unmatched_qty": summary.unmatched_qty,
            "unallocated": [
                {"category": t.category, "row_count": t.row_count, "qty": t.qty}
                for t in summary.unallocated
            ],
        },
        "groups": [
            {
                "product_id": g.product_id,
                "product_name": (products.get(g.product_id) or {}).get("name"),
                "product_code": (products.get(g.product_id) or {}).get("code"),
                "product_has_routings": g.product_id in routed,
                "process_name": g.process_name,
                "reason": g.reason,
                "category": g.category,
                "row_count": g.row_count,
                "qty": g.qty,
                "first_work_date": _iso(g.first_work_date),
                "last_work_date": _iso(g.last_work_date),
                "customer_names": [
                    customers[c] for c in g.customer_ids if c in customers
                ],
            }
            for g in groups
        ],
    }
