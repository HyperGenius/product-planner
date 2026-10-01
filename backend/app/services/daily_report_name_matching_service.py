"""日報の名寄せの DB 入出力 (Issue #488, 親Issue #485)。

照合ロジック本体は `daily_report_name_matcher`（純粋関数）。ここではマスタと別名辞書を
読み込んでスナップショットを作り、照合できなかった表記の一覧を返す。

ルーター（ユーザー JWT）からも、割り付けの cron（#490、service role）からも呼ばれる想定。
service role では RLS が効かないため、クエリはすべて `.eq("tenant_id", tenant_id)` で絞り込む。
"""

from collections.abc import Callable
from typing import Any, cast

from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.services.daily_report_name_matcher import (
    CustomerRef,
    DailyReportNameMatcher,
    EquipmentRef,
    NameKind,
    NameMatchingSnapshot,
    ProductRef,
)
from supabase import Client  # type: ignore

# PostgREST の max_rows（supabase/config.toml）以下にする
_PAGE_SIZE = 1000


def fetch_all_rows(build_query: Callable[[], Any]) -> list[dict[str, Any]]:
    """PostgREST の max_rows で切られないよう `.range()` でページングして全件読む。

    `build_query` は呼ぶたびに新しいクエリ（順序が一意に決まる `.order()` 付き）を返すこと。
    """
    rows: list[dict[str, Any]] = []
    start = 0
    while True:
        result = build_query().range(start, start + _PAGE_SIZE - 1).execute()
        page = cast(list[dict[str, Any]], result.data or [])
        rows.extend(page)
        if len(page) < _PAGE_SIZE:
            return rows
        start += _PAGE_SIZE


def _select_all(
    db: Client, table: str, columns: str, tenant_id: str
) -> list[dict[str, Any]]:
    return fetch_all_rows(
        lambda: db.table(table).select(columns).eq("tenant_id", tenant_id).order("id")
    )


def _distinct_process_names(routings: list[dict[str, Any]]) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for routing in routings:
        name = (routing.get("process_name") or "").strip()
        if name and name not in seen:
            seen.add(name)
            names.append(name)
    return names


def list_master_process_names(db: Client, tenant_id: str) -> list[str]:
    """マスタの工程名（`process_routings.process_name`）の重複を除いた一覧（名前順）。

    工程の別名は工程名のレベルで対応付けるので、製品をまたいで同じ名前は1つにまとめる。
    """
    routings = _select_all(
        db, SupabaseTableName.PROCESS_ROUTINGS.value, "id, process_name", tenant_id
    )
    return sorted(_distinct_process_names(routings))


def load_snapshot(db: Client, tenant_id: str) -> NameMatchingSnapshot:
    """照合に使うマスタと別名辞書を1テナント分読み込む。"""
    equipments = _select_all(
        db,
        SupabaseTableName.EQUIPMENTS.value,
        "id, name, short_name, ledger_no",
        tenant_id,
    )
    customers = _select_all(
        db, SupabaseTableName.CUSTOMERS.value, "id, name, alias, status", tenant_id
    )
    products = _select_all(
        db, SupabaseTableName.PRODUCTS.value, "id, name, code, is_active", tenant_id
    )
    routings = _select_all(
        db, SupabaseTableName.PROCESS_ROUTINGS.value, "id, process_name", tenant_id
    )
    equipment_aliases = _select_all(
        db,
        SupabaseTableName.EQUIPMENT_NAME_ALIASES.value,
        "id, raw_text, equipment_id",
        tenant_id,
    )
    process_aliases = _select_all(
        db,
        SupabaseTableName.PROCESS_NAME_ALIASES.value,
        "id, raw_text, process_names",
        tenant_id,
    )
    customer_aliases = _select_all(
        db,
        SupabaseTableName.CUSTOMER_NAME_ALIASES.value,
        "id, raw_text, customer_id",
        tenant_id,
    )
    product_aliases = _select_all(
        db,
        SupabaseTableName.PRODUCT_NAME_ALIASES.value,
        "id, customer_id, raw_text, product_id",
        tenant_id,
    )

    return NameMatchingSnapshot(
        equipments=[
            EquipmentRef(
                id=int(r["id"]),
                name=r["name"],
                short_name=r.get("short_name"),
                ledger_no=r.get("ledger_no"),
            )
            for r in equipments
        ],
        customers=[
            CustomerRef(
                id=int(r["id"]),
                name=r["name"],
                alias=r.get("alias"),
                status=r.get("status"),
            )
            for r in customers
        ],
        products=[
            ProductRef(
                id=int(r["id"]),
                name=r["name"],
                code=r.get("code"),
                is_active=r.get("is_active", True) is not False,
            )
            for r in products
        ],
        process_names=_distinct_process_names(routings),
        equipment_aliases={
            r["raw_text"].strip(): int(r["equipment_id"]) for r in equipment_aliases
        },
        process_aliases={
            r["raw_text"].strip(): list(r["process_names"]) for r in process_aliases
        },
        customer_aliases={
            r["raw_text"].strip(): int(r["customer_id"]) for r in customer_aliases
        },
        product_aliases={
            (int(r["customer_id"]), r["raw_text"].strip()): int(r["product_id"])
            for r in product_aliases
        },
    )


def load_matcher(db: Client, tenant_id: str) -> DailyReportNameMatcher:
    return DailyReportNameMatcher(load_snapshot(db, tenant_id))


def fetch_name_stats(db: Client, tenant_id: str) -> list[dict[str, Any]]:
    """明細の表記ごとの出現件数・最終出現日（RPC `daily_report_name_stats`）。"""
    return fetch_all_rows(
        lambda: (
            db.rpc("daily_report_name_stats", {"p_tenant_id": tenant_id})
            .order("kind")
            .order("raw_text")
            .order("customer_raw", nullsfirst=True)
        )
    )


IgnoredKey = tuple[str, str, str | None]


def ignored_key(kind: str, raw_text: str, customer_raw: str | None) -> IgnoredKey:
    """対象外の表記のキー。製品だけ顧客先を含める（未照合キューの1行と同じ単位）。"""
    return (kind, raw_text, customer_raw if kind == "product" else None)


def fetch_ignored_keys(db: Client, tenant_id: str) -> set[IgnoredKey]:
    """「対象外」にした表記（#489）のキーの集合。"""
    rows = _select_all(
        db,
        SupabaseTableName.DAILY_REPORT_IGNORED_NAMES.value,
        "id, kind, raw_text, customer_raw",
        tenant_id,
    )
    return {ignored_key(r["kind"], r["raw_text"], r.get("customer_raw")) for r in rows}


def list_unmatched_names(
    db: Client, tenant_id: str, kind: NameKind | None = None
) -> list[dict[str, Any]]:
    """照合できなかった表記の一覧を出現件数の多い順に返す（未照合キュー #489 用）。

    製品は (顧客先, 商品名) の組ごとに返す。製品の別名は顧客単位なので、別名を登録するには
    顧客が照合できている必要がある（`customer_id` が None なら先に顧客の対応付けが要る）。
    「対象外」にした表記（`daily_report_ignored_names`、#489）は返さない。
    """
    matcher = load_matcher(db, tenant_id)
    ignored = fetch_ignored_keys(db, tenant_id)
    unmatched: list[dict[str, Any]] = []
    for stat in fetch_name_stats(db, tenant_id):
        stat_kind = stat["kind"]
        if kind is not None and stat_kind != kind:
            continue
        raw_text = stat["raw_text"]
        customer_raw = stat.get("customer_raw")
        if ignored_key(stat_kind, raw_text, customer_raw) in ignored:
            continue
        if matcher.is_matched(stat_kind, raw_text, customer_raw):
            continue
        item: dict[str, Any] = {
            "kind": stat_kind,
            "raw_text": raw_text,
            "customer_raw": None,
            "customer_id": None,
            "entry_count": int(stat["entry_count"]),
            "last_work_date": stat.get("last_work_date"),
        }
        if stat_kind == "product":
            customer = matcher.match_customer(customer_raw)
            item["customer_raw"] = customer_raw
            item["customer_id"] = customer.target if customer else None
        unmatched.append(item)

    # 影響の大きいもの（出現件数が多い・最近も出ている）から片付けられるように並べる
    unmatched.sort(key=lambda i: i["last_work_date"] or "", reverse=True)
    unmatched.sort(key=lambda i: i["entry_count"], reverse=True)
    return unmatched


# 日報の明細のうち、表記の確認用に返す列（未照合キューで表記をクリックしたとき）
_ENTRY_COLUMNS = (
    "id, sheet_name, row_no, work_date, customer_raw, product_raw, process_raw, "
    "equipment_raw, worker_raw, processed_qty, defect_qty, good_qty"
)
# 明細の列名（daily_report_entries）。表記の種別ごと
_ENTRY_RAW_COLUMN: dict[str, str] = {
    "equipment": "equipment_raw",
    "process": "process_raw",
    "customer": "customer_raw",
    "product": "product_raw",
}


def list_name_entries(
    db: Client,
    tenant_id: str,
    kind: NameKind,
    raw_text: str,
    customer_raw: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """表記が使われている日報の明細を加工日の新しい順に返す（未照合キュー #489 の確認用）。

    製品は未照合キューと同じく (顧客先, 商品名) の組で絞る（顧客先が空欄なら NULL の行）。
    """
    query = (
        db.table(SupabaseTableName.DAILY_REPORT_ENTRIES.value)
        .select(_ENTRY_COLUMNS)
        .eq("tenant_id", tenant_id)
        .eq(_ENTRY_RAW_COLUMN[kind], raw_text)
    )
    if kind == "product":
        query = (
            query.eq("customer_raw", customer_raw)
            if customer_raw is not None
            else query.is_("customer_raw", "null")
        )
    result = (
        query.order("work_date", desc=True, nullsfirst=False)
        .order("sheet_name", desc=True)
        .order("row_no", desc=True)
        .limit(limit)
        .execute()
    )
    return cast(list[dict[str, Any]], result.data or [])
