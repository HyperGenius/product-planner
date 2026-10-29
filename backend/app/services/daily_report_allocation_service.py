"""日報の実績の割り付けと進捗の DB 入出力 (Issue #490, 親Issue #485)。

計算本体は `daily_report_allocator`（純粋関数）。ここでは明細・受注・工程ルートを読み込み、
明細を名寄せ（`daily_report_name_matching_service.load_matcher()`）で照合してから割り付け、
RPC `replace_daily_report_allocation` でテナント単位に丸ごと置き換える（差分更新しない）。
作り置きの推定（`daily_report_stock_estimator`、Issue #591）も同じ再計算で求め、同じ RPC で置き換える。

cron（`GET /api/cron/compute-daily-report-progress`）から service role の admin client で
全テナント横断に呼ばれる。service role では RLS が効かないため、クエリはすべて
`.eq("tenant_id", tenant_id)` で絞り込む。進捗の参照（`fetch_order_progress()` 等）は
ルーターからユーザー JWT で呼ばれる。
"""

from datetime import UTC, date, datetime
from typing import Any, cast

from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.services.daily_report_allocator import (
    ActualEntry,
    AllocationResult,
    OrderRef,
    RoutingRef,
    allocate_actuals,
)
from app.services.daily_report_coverage import (
    CLOSED_ORDER_STATUSES,
    UnmatchedEntry,
    summarize_coverage,
)
from app.services.daily_report_name_matcher import DailyReportNameMatcher
from app.services.daily_report_name_matching_service import (
    fetch_all_rows,
    load_matcher,
)
from app.services.daily_report_stock_estimator import (
    ShippedOrderRef,
    StockEstimate,
    StockFeedback,
    estimate_stock,
)
from app.utils.calendar import JST
from app.utils.logger import get_logger
from supabase import Client  # type: ignore

logger = get_logger(__name__)

# 割り付けの候補になる受注のステータス（Issue #490）
CANDIDATE_ORDER_STATUSES = ("confirmed", "in_progress")


def _parse_date(value: Any) -> date | None:
    """日付のみの列（`YYYY-MM-DD`）を date にする。読めない値は None。"""
    if not value:
        return None
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        return None


def _to_jst_date(value: Any) -> date | None:
    """timestamptz（`order_date` / `shipped_at`）を JST の暦日にする。naive な値は JST とみなす。"""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        logger.warning(f"daily_report_allocation: invalid timestamp {value!r}")
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=JST)
    return dt.astimezone(JST).date()


def load_actual_entries(
    db: Client, tenant_id: str, matcher: DailyReportNameMatcher
) -> tuple[list[ActualEntry], list[UnmatchedEntry]]:
    """加工数が1以上の明細を照合し、製品と工程が照合できたものを返す。

    良品数が0（すべて不良）の明細も、作り置きの推定（#591）で前の工程の品物を使った数に数えるので含める
    （割り付け・照合状況の集計は良品数が1以上の明細だけを使う）。
    戻り値の2つ目は製品か工程が照合できず割り付けに使えなかった良品数が1以上の明細
    （未照合キュー #489 で解消するもの。未割当には含めず、照合状況の集計 #542 にだけ使う）。
    """
    rows = fetch_all_rows(
        lambda: (
            db.table(SupabaseTableName.DAILY_REPORT_ENTRIES.value)
            .select(
                "id, work_date, customer_raw, product_raw, process_raw, "
                "processed_qty, good_qty"
            )
            .eq("tenant_id", tenant_id)
            # good_qty は processed_qty − defect_qty（0未満は0）なので、良品数が1以上の明細は必ず含まれる
            .gt("processed_qty", 0)
            .order("id")
        )
    )
    entries: list[ActualEntry] = []
    unmatched: list[UnmatchedEntry] = []
    for row in rows:
        good_qty = int(row.get("good_qty") or 0)
        match = matcher.match_entry(row)
        if match.product_id is None or not match.process_names:
            if good_qty > 0:
                unmatched.append(
                    UnmatchedEntry(
                        work_date=_parse_date(row.get("work_date")),
                        good_qty=good_qty,
                    )
                )
            continue
        entries.append(
            ActualEntry(
                entry_id=int(row["id"]),
                work_date=_parse_date(row.get("work_date")),
                product_id=int(match.product_id),
                customer_id=match.customer_id,
                process_names=tuple(match.process_names),
                good_qty=good_qty,
                processed_qty=int(row["processed_qty"]),
            )
        )
    return entries, unmatched


def load_candidate_orders(db: Client, tenant_id: str) -> list[OrderRef]:
    rows = fetch_all_rows(
        lambda: (
            db.table(SupabaseTableName.ORDERS.value)
            .select(
                "id, product_id, customer_id, quantity, deadline_date, "
                "confirmed_deadline, order_date"
            )
            .eq("tenant_id", tenant_id)
            .in_("status", list(CANDIDATE_ORDER_STATUSES))
            .not_.is_("product_id", "null")
            .order("id")
        )
    )
    return [
        OrderRef(
            id=int(row["id"]),
            product_id=int(row["product_id"]),
            customer_id=row.get("customer_id"),
            quantity=int(row.get("quantity") or 0),
            deadline=_parse_date(row.get("deadline_date"))
            or _parse_date(row.get("confirmed_deadline")),
            order_date=_to_jst_date(row.get("order_date")),
        )
        for row in rows
    ]


def load_shipped_orders(db: Client, tenant_id: str) -> list[ShippedOrderRef]:
    """送品済み・完了の受注（作り置きの推定で、日報に出てくる最後の工程の後を減らす。#591）。

    送品日は `shipped_at` の JST 暦日。列を足す前に送品した受注は記録が無いので納期で代用する。
    """
    rows = fetch_all_rows(
        lambda: (
            db.table(SupabaseTableName.ORDERS.value)
            .select(
                "id, product_id, quantity, shipped_at, deadline_date, confirmed_deadline"
            )
            .eq("tenant_id", tenant_id)
            .in_("status", list(CLOSED_ORDER_STATUSES))
            .not_.is_("product_id", "null")
            .order("id")
        )
    )
    return [
        ShippedOrderRef(
            product_id=int(row["product_id"]),
            quantity=int(row.get("quantity") or 0),
            shipped_on=_to_jst_date(row.get("shipped_at"))
            or _parse_date(row.get("deadline_date"))
            or _parse_date(row.get("confirmed_deadline")),
        )
        for row in rows
    ]


def load_stock_feedback(db: Client, tenant_id: str) -> list[StockFeedback]:
    rows = fetch_all_rows(
        lambda: (
            db.table(SupabaseTableName.DAILY_REPORT_STOCK_FEEDBACK.value)
            .select("id, product_id, kind, process_name, baseline_qty, baseline_date")
            .eq("tenant_id", tenant_id)
            .order("id")
        )
    )
    return [
        StockFeedback(
            product_id=int(row["product_id"]),
            kind=row["kind"],
            process_name=row.get("process_name"),
            baseline_qty=row.get("baseline_qty"),
            baseline_date=_parse_date(row.get("baseline_date")),
        )
        for row in rows
    ]


def load_routings(db: Client, tenant_id: str) -> list[RoutingRef]:
    rows = fetch_all_rows(
        lambda: (
            db.table(SupabaseTableName.PROCESS_ROUTINGS.value)
            .select("id, product_id, sequence_order, process_name")
            .eq("tenant_id", tenant_id)
            .not_.is_("product_id", "null")
            .order("id")
        )
    )
    return [
        RoutingRef(
            id=int(row["id"]),
            product_id=int(row["product_id"]),
            sequence_order=int(row["sequence_order"]),
            process_name=row.get("process_name"),
        )
        for row in rows
    ]


def _iso(value: date | None) -> str | None:
    return value.isoformat() if value else None


def _rpc_payload(result: AllocationResult) -> tuple[list[dict], list[dict]]:
    progress = [
        {
            "order_id": p.order_id,
            "process_routing_id": p.process_routing_id,
            "good_qty": p.good_qty,
            "first_actual_date": _iso(p.first_actual_date),
            "last_actual_date": _iso(p.last_actual_date),
            "status": p.status,
            "completed_by": p.completed_by,
        }
        for p in result.progress
    ]
    unallocated = [
        {
            "entry_id": u.entry_id,
            "product_id": u.product_id,
            "customer_id": u.customer_id,
            "process_name": u.process_name,
            "work_date": _iso(u.work_date),
            "qty": u.qty,
            "reason": u.reason,
        }
        for u in result.unallocated
    ]
    return progress, unallocated


def _stock_payload(estimates: list[StockEstimate]) -> list[dict]:
    return [
        {
            "product_id": s.product_id,
            "process_name": s.process_name,
            "next_process_name": s.next_process_name,
            "qty": s.qty,
            "last_movement_date": _iso(s.last_movement_date),
        }
        for s in estimates
    ]


def recompute_tenant_allocation(
    db: Client, tenant_id: str, computed_at: datetime | None = None
) -> dict[str, Any]:
    """テナントの割り付けと進捗を全量再計算して置き換える（冪等）。

    `computed_at` は読み込み開始時刻。RPC はこれより新しい結果が既に載っていれば置き換えない。
    """
    computed_at = computed_at or datetime.now(UTC)
    matcher = load_matcher(db, tenant_id)
    entries, unmatched = load_actual_entries(db, tenant_id, matcher)
    orders = load_candidate_orders(db, tenant_id)
    routings = load_routings(db, tenant_id)

    result = allocate_actuals(entries, orders, routings)
    progress, unallocated = _rpc_payload(result)
    # 照合状況の画面（#542）用に、照合済み・未照合の数量を加工月ごとに残す
    coverage = [m.to_json() for m in summarize_coverage(entries, unmatched)]
    # 作り置きの推定（#591）。期限切れの判定の「今日」は計算時刻の JST 暦日
    stock = estimate_stock(
        entries,
        routings,
        result.allocations,
        load_shipped_orders(db, tenant_id),
        load_stock_feedback(db, tenant_id),
        today=computed_at.astimezone(JST).date(),
    )
    rpc_result = db.rpc(
        "replace_daily_report_allocation",
        {
            "p_tenant_id": tenant_id,
            "p_computed_at": computed_at.isoformat(),
            "p_progress": progress,
            "p_unallocated": unallocated,
            "p_coverage": coverage,
            "p_stock": _stock_payload(stock),
        },
    ).execute()
    return {
        "status": rpc_result.data,
        "entries": len(entries),
        "unmatched_entries": len(unmatched),
        "progress": len(progress),
        "unallocated": len(unallocated),
        "stock_estimates": len(stock),
    }


def list_target_tenants(db: Client) -> list[str]:
    """再計算の対象テナント: 明細のあるテナントと、前回の計算結果が残っているテナント。

    明細が無くなったテナントも、前回の結果を空で置き換えるため対象に含める。
    """
    sheets = fetch_all_rows(
        lambda: (
            db.table(SupabaseTableName.DAILY_REPORT_SHEETS.value)
            .select("tenant_id")
            .order("tenant_id")
            .order("sheet_name")
        )
    )
    runs = fetch_all_rows(
        lambda: (
            db.table(SupabaseTableName.DAILY_REPORT_ALLOCATION_RUNS.value)
            .select("tenant_id")
            .order("tenant_id")
        )
    )
    return sorted({str(row["tenant_id"]) for row in [*sheets, *runs]})


def recompute_all_tenants(db: Client) -> dict[str, int]:
    """全対象テナントを再計算する（cron 用）。1テナントの失敗で他を止めない。"""
    summary = {
        "tenants": 0,
        "replaced": 0,
        "stale": 0,
        "failed": 0,
        "progress": 0,
        "unallocated": 0,
        "unmatched_entries": 0,
        "stock_estimates": 0,
    }
    for tenant_id in list_target_tenants(db):
        summary["tenants"] += 1
        try:
            result = recompute_tenant_allocation(db, tenant_id)
        except Exception:
            logger.error(
                f"daily_report_allocation: tenant {tenant_id} failed", exc_info=True
            )
            summary["failed"] += 1
            continue
        if result["status"] == "replaced":
            summary["replaced"] += 1
        else:
            summary["stale"] += 1
        summary["progress"] += result["progress"]
        summary["unallocated"] += result["unallocated"]
        summary["unmatched_entries"] += result["unmatched_entries"]
        summary["stock_estimates"] += result["stock_estimates"]

    logger.info(f"daily_report_allocation complete: {summary}")
    return summary


# ---------------------------------------------------------------------------
# 参照（ルーターからユーザー JWT で呼ぶ）
# ---------------------------------------------------------------------------

_PROGRESS_COLUMNS = (
    "order_id, process_routing_id, good_qty, first_actual_date, last_actual_date, "
    "status, completed_by, computed_at, "
    "process_routings(sequence_order, process_name), orders(quantity)"
)


def _flatten_progress(row: dict[str, Any]) -> dict[str, Any]:
    routing = row.pop("process_routings", None) or {}
    order = row.pop("orders", None) or {}
    return {
        **row,
        "sequence_order": routing.get("sequence_order"),
        "process_name": routing.get("process_name"),
        # 進捗率（good_qty ÷ 受注数量）の分母。ガントチャートの塗り（Issue #491）
        "order_quantity": order.get("quantity"),
    }


def fetch_order_progress(
    db: Client, tenant_id: str, order_ids: list[int] | None = None
) -> list[dict[str, Any]]:
    """受注×工程の進捗を受注・工程順に返す。`order_ids` が None なら全件。"""

    def build_query():
        query = (
            db.table(SupabaseTableName.ORDER_PROCESS_PROGRESS.value)
            .select(_PROGRESS_COLUMNS)
            .eq("tenant_id", tenant_id)
        )
        if order_ids is not None:
            query = query.in_("order_id", order_ids)
        return query.order("order_id").order("process_routing_id")

    rows = [_flatten_progress(row) for row in fetch_all_rows(build_query)]
    planned_ends = _fetch_planned_ends(db, tenant_id, order_ids)
    for row in rows:
        row["planned_end_datetime"] = planned_ends.get(
            (row["order_id"], row["process_routing_id"])
        )
    rows.sort(key=lambda r: (r["order_id"], r["sequence_order"] or 0))
    return rows


def _fetch_planned_ends(
    db: Client, tenant_id: str, order_ids: list[int] | None
) -> dict[tuple[int, int], datetime]:
    """受注×工程ごとの計画の終了日時（スケジュールのセグメントの `end_datetime` の最大）。

    ガントチャートの遅れの判定（Issue #491）に使う。ガントは表示範囲のセグメントしか
    取得しないので、範囲の外へ続く工程の終了日時はフロントでは求められない。
    """
    if order_ids is not None and not order_ids:
        return {}

    def build_query():
        query = (
            db.table(SupabaseTableName.PRODUCTION_SCHEDULES.value)
            .select("id, order_id, process_routing_id, end_datetime")
            .eq("tenant_id", tenant_id)
        )
        if order_ids is not None:
            query = query.in_("order_id", order_ids)
        return query.order("id")

    ends: dict[tuple[int, int], datetime] = {}
    for row in fetch_all_rows(build_query):
        if row.get("end_datetime") is None or row.get("process_routing_id") is None:
            continue
        end = datetime.fromisoformat(str(row["end_datetime"]).replace("Z", "+00:00"))
        key = (row["order_id"], row["process_routing_id"])
        if key not in ends or end > ends[key]:
            ends[key] = end
    return ends


def fetch_last_computed_at(db: Client, tenant_id: str) -> str | None:
    result = (
        db.table(SupabaseTableName.DAILY_REPORT_ALLOCATION_RUNS.value)
        .select("computed_at")
        .eq("tenant_id", tenant_id)
        .limit(1)
        .execute()
    )
    rows = cast(list[dict[str, Any]], result.data or [])
    return rows[0]["computed_at"] if rows else None


# 未割当の実績に添える明細の列（日報上の表記と位置）
_ENTRY_COLUMNS = ("sheet_name", "row_no", "customer_raw", "product_raw", "process_raw")


def fetch_unallocated_actuals(
    db: Client,
    tenant_id: str,
    *,
    product_id: int | None = None,
    process_name: str | None = None,
    reason: str | None = None,
    since: date | None = None,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    """未割当の実績を加工日の新しい順に返す（明細の日報上の表記を添える）。

    照合状況の画面（#542）で、まとめた1行（製品・工程名・理由）の元の日報の行を出すときは
    絞り込みを指定する。`since` より前の加工日は除く（加工日の無い行は常に含める）。
    """

    def build_query():
        query = (
            db.table(SupabaseTableName.DAILY_REPORT_UNALLOCATED_ACTUALS.value)
            .select(
                "id, entry_id, product_id, customer_id, process_name, work_date, qty, "
                f"reason, computed_at, daily_report_entries({', '.join(_ENTRY_COLUMNS)})"
            )
            .eq("tenant_id", tenant_id)
        )
        if product_id is not None:
            query = query.eq("product_id", product_id)
        if process_name is not None:
            query = query.eq("process_name", process_name)
        if reason is not None:
            query = query.eq("reason", reason)
        if since is not None:
            query = query.or_(f"work_date.gte.{since.isoformat()},work_date.is.null")
        return query.order("id")

    items: list[dict[str, Any]] = []
    for row in fetch_all_rows(build_query):
        entry = row.pop("daily_report_entries", None) or {}
        items.append({**row, **{k: entry.get(k) for k in _ENTRY_COLUMNS}})
    items.sort(key=lambda i: i["work_date"] or "", reverse=True)
    return items[:limit] if limit is not None else items
