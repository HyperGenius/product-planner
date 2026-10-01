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

    process_names: list[str] = []
    for routing in routings:
        name = (routing.get("process_name") or "").strip()
        if name and name not in process_names:
            process_names.append(name)

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
        process_names=process_names,
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


def list_unmatched_names(
    db: Client, tenant_id: str, kind: NameKind | None = None
) -> list[dict[str, Any]]:
    """照合できなかった表記の一覧を出現件数の多い順に返す（未照合キュー #489 用）。

    製品は (顧客先, 商品名) の組ごとに返す。製品の別名は顧客単位なので、別名を登録するには
    顧客が照合できている必要がある（`customer_id` が None なら先に顧客の対応付けが要る）。
    """
    matcher = load_matcher(db, tenant_id)
    unmatched: list[dict[str, Any]] = []
    for stat in fetch_name_stats(db, tenant_id):
        stat_kind = stat["kind"]
        if kind is not None and stat_kind != kind:
            continue
        raw_text = stat["raw_text"]
        customer_raw = stat.get("customer_raw")
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
