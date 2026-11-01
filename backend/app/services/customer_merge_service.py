"""重複登録された顧客の統合（Issue #610）。

統合の事前チェック（付け替え・削除の件数と統合を止める理由）を行う。プレビューと実行時の再検証の
両方で使い、実行は RPC `merge_customers` で1トランザクションにまとめる（製品の統合
`product_merge_service` と同じ構成）。

計算（`plan_order_conflicts()` / `plan_merge()`）は DB から切り離した純粋関数に保ち、DB の読み込みは
`load_merge_preview()` に置く。ルーターからユーザー JWT で呼ぶ（RLS 下で動く）。
"""

from collections import defaultdict
from typing import Any, cast

from postgrest.exceptions import APIError

from app.models.master.customer_merge_schemas import (
    CustomerMergeBlocker,
    CustomerMergeCounts,
    CustomerMergeLogEntry,
    CustomerMergePreview,
    CustomerMergeTarget,
)
from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.services.customer_contact_service import normalize_contact_email
from app.services.daily_report_name_matching_service import fetch_all_rows
from app.utils.logger import get_logger
from supabase import Client  # type: ignore

logger = get_logger(__name__)

# 統合を実行できるロール（Frontend の CUSTOMER_MERGE_ROLES と揃える）
MERGE_EDITOR_ROLES = ("president", "platform_admin")

_CUSTOMER_COLUMNS = "id, name, alias, email"
_ORDER_COLUMNS = (
    "id, order_number, customer_id, product_id, deadline_date, status, order_type, "
    "extracted_product_name, customer_order_no"
)


class MergeCustomerNotFoundError(Exception):
    """残す顧客・統合される顧客のいずれかがテナントに無い。"""


class MergeForbiddenError(Exception):
    """統合の権限が無い（RPC のロール確認で弾かれた）。"""


class MergeConflictError(Exception):
    """プレビュー後に他の操作で状況が変わり、RPC が制約違反等で失敗した。"""


# ---------------------------------------------------------------------------
# 純粋関数
# ---------------------------------------------------------------------------


def _dedupe_keys(order: dict[str, Any]) -> list[tuple[Any, ...]]:
    """顧客を除いた、受注の UNIQUE のキー。NULL を含み UNIQUE の対象外になる受注はキー無し。

    - orders_dedupe_key: (顧客, 製品, 希望納期)
    - orders_dedupe_key_unmatched_product: 製品が NULL の受注の (顧客, 希望納期, 抽出した品名)
    - orders_repair_customer_order_no_key: 修理等の (顧客, 顧客の注文番号)
    """
    keys: list[tuple[Any, ...]] = []
    deadline = order.get("deadline_date")
    if order.get("product_id") is not None:
        if deadline is not None:
            keys.append(("product", order["product_id"], deadline))
    elif deadline is not None and order.get("extracted_product_name") is not None:
        keys.append(("unmatched", deadline, order["extracted_product_name"]))
    if (
        order.get("order_type") == "repair"
        and order.get("customer_order_no") is not None
    ):
        keys.append(("repair", order["customer_order_no"]))
    return keys


def plan_order_conflicts(
    keep_customer_id: int,
    merge_customers: dict[int, str],
    orders: list[dict[str, Any]],
) -> list[CustomerMergeBlocker]:
    """付け替えで受注の UNIQUE が衝突する、統合される側の受注を調べる。

    同じキーの受注が複数の顧客にまたがるとき、残す顧客の受注があればそれが枠を持つ。無ければ
    ID の若い受注が枠を持つ。枠を持てない統合される側の受注は統合を止める理由になる
    （製品の統合と違い、出荷済みでも自動では削除しない）。
    """
    groups: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    for order in orders:
        if order.get("customer_id") is None:
            continue
        for key in _dedupe_keys(order):
            groups[key].append(order)

    blockers: dict[int, CustomerMergeBlocker] = {}
    for members in groups.values():
        if len({o["customer_id"] for o in members}) < 2:
            continue
        holder = next(
            (o for o in members if o["customer_id"] == keep_customer_id),
            min(members, key=lambda o: o["id"]),
        )
        for order in members:
            if (
                order["customer_id"] == keep_customer_id
                or order["id"] == holder["id"]
                or order["id"] in blockers
            ):
                continue
            blockers[order["id"]] = CustomerMergeBlocker(
                reason="order_conflict",
                customer_id=order["customer_id"],
                customer_name=merge_customers[order["customer_id"]],
                order_id=order["id"],
                order_number=order.get("order_number"),
                order_status=order["status"],
                conflicting_order_id=holder["id"],
                conflicting_order_number=holder.get("order_number"),
            )
    return sorted(blockers.values(), key=lambda b: b.order_id)


def count_dropped_aliases(keep_customer_id: int, aliases: list[dict[str, Any]]) -> int:
    """製品の別名のうち、統合で捨てる件数（同じ表記が残す顧客、または先に統合される顧客にある）。

    RPC は表記ごとに (顧客 ID, 登録日時, ID) の若い1件を残すので、件数は表記の重なりだけで決まる。
    """
    keep_raw = {a["raw_text"] for a in aliases if a["customer_id"] == keep_customer_id}
    merged_raw = [
        a["raw_text"] for a in aliases if a["customer_id"] != keep_customer_id
    ]
    distinct_new = {raw for raw in merged_raw if raw not in keep_raw}
    return len(merged_raw) - len(distinct_new)


def plan_merge(
    keep_customer: dict[str, Any],
    merge_customers: list[dict[str, Any]],
    orders: list[dict[str, Any]],
    attachment_count: int,
    product_aliases: list[dict[str, Any]],
    alias_history_count: int,
    customer_alias_count: int,
    unallocated_count: int,
    prompt_history_count: int,
    contacts: list[dict[str, Any]],
) -> CustomerMergePreview:
    """統合の付け替え・削除の件数と、統合を止める理由を求める。

    Args:
        orders: 残す顧客・統合される顧客の受注
        product_aliases: 残す顧客・統合される顧客の製品の別名（id / customer_id / raw_text）
        contacts: 統合される顧客の担当者（email）
        *_count: 統合される顧客に紐づく行数
    """
    keep_id = keep_customer["id"]
    names = {c["id"]: c["name"] for c in merge_customers}
    blockers = plan_order_conflicts(keep_id, names, orders)

    aliases_dropped = count_dropped_aliases(keep_id, product_aliases)
    merged_aliases = sum(1 for a in product_aliases if a["customer_id"] != keep_id)

    # 担当者に無い customers.email は RPC が担当者として足す（正規化後に重なるものは1件）
    known = {normalize_contact_email(c["email"]) for c in contacts}
    extra = {
        normalize_contact_email(c["email"])
        for c in merge_customers
        if (c.get("email") or "").strip()
    } - known

    merge_orders = [o for o in orders if o["customer_id"] != keep_id]
    return CustomerMergePreview(
        keep_customer_id=keep_id,
        merge_customer_ids=[c["id"] for c in merge_customers],
        merge_customers=[
            CustomerMergeTarget(
                id=c["id"],
                name=c["name"],
                alias=c.get("alias"),
                email=c.get("email"),
            )
            for c in merge_customers
        ],
        counts=CustomerMergeCounts(
            orders_reassigned=len(merge_orders),
            attachments_reassigned=attachment_count,
            aliases_reassigned=merged_aliases - aliases_dropped,
            aliases_dropped=aliases_dropped,
            alias_history_reassigned=alias_history_count,
            customer_aliases_reassigned=customer_alias_count,
            unallocated_actuals_reassigned=unallocated_count,
            prompt_history_reassigned=prompt_history_count,
            contacts_reassigned=len(contacts) + len(extra),
            customers_deleted=len(merge_customers),
        ),
        blockers=blockers,
    )


# ---------------------------------------------------------------------------
# DB 入出力
# ---------------------------------------------------------------------------


def _select_in(
    db: Client,
    table: SupabaseTableName,
    columns: str,
    tenant_id: str,
    column: str,
    values: list[int],
) -> list[dict[str, Any]]:
    return fetch_all_rows(
        lambda: (
            db.table(table.value)
            .select(columns)
            .eq("tenant_id", tenant_id)
            .in_(column, values)
            .order("id")
        )
    )


def load_merge_preview(
    db: Client, tenant_id: str, keep_customer_id: int, merge_customer_ids: list[int]
) -> CustomerMergePreview:
    """統合の事前チェックに必要な行を読み、`plan_merge()` で件数と止める理由を求める。

    Raises:
        MergeCustomerNotFoundError: 残す顧客・統合される顧客のいずれかがテナントに無い
    """
    all_ids = [keep_customer_id, *merge_customer_ids]
    customers = {
        c["id"]: c
        for c in _select_in(
            db, SupabaseTableName.CUSTOMERS, _CUSTOMER_COLUMNS, tenant_id, "id", all_ids
        )
    }
    if any(cid not in customers for cid in all_ids):
        raise MergeCustomerNotFoundError

    def select_merged(
        table: SupabaseTableName, columns: str = "id"
    ) -> list[dict[str, Any]]:
        return _select_in(
            db, table, columns, tenant_id, "customer_id", merge_customer_ids
        )

    return plan_merge(
        keep_customer=customers[keep_customer_id],
        merge_customers=[customers[cid] for cid in merge_customer_ids],
        orders=_select_in(
            db,
            SupabaseTableName.ORDERS,
            _ORDER_COLUMNS,
            tenant_id,
            "customer_id",
            all_ids,
        ),
        attachment_count=len(select_merged(SupabaseTableName.ORDER_ATTACHMENTS)),
        product_aliases=_select_in(
            db,
            SupabaseTableName.PRODUCT_NAME_ALIASES,
            "id, customer_id, raw_text",
            tenant_id,
            "customer_id",
            all_ids,
        ),
        alias_history_count=len(
            select_merged(SupabaseTableName.PRODUCT_NAME_ALIAS_HISTORY)
        ),
        customer_alias_count=len(
            select_merged(SupabaseTableName.CUSTOMER_NAME_ALIASES)
        ),
        unallocated_count=len(
            select_merged(SupabaseTableName.DAILY_REPORT_UNALLOCATED_ACTUALS)
        ),
        prompt_history_count=len(
            select_merged(SupabaseTableName.CUSTOMER_EXTRACTION_PROMPT_HISTORY)
        ),
        contacts=select_merged(SupabaseTableName.CUSTOMER_CONTACTS, "id, email"),
    )


def execute_merge(
    db: Client, tenant_id: str, preview: CustomerMergePreview
) -> CustomerMergeCounts:
    """RPC `merge_customers` で統合を1トランザクションで実行する。

    止める理由が無いことは呼び出し側で確かめておく。プレビュー後に受注が変わっていた場合は
    RPC が制約違反（23505）や削除件数の不一致で失敗し、何も変わらない。

    Raises:
        MergeForbiddenError: 統合の権限が無い
        MergeCustomerNotFoundError: 顧客が他の操作で削除された
        MergeConflictError: 上記以外で RPC が失敗した（プレビューからやり直す）
    """
    try:
        result = db.rpc(
            "merge_customers",
            {
                "p_tenant_id": tenant_id,
                "p_keep_customer_id": preview.keep_customer_id,
                "p_merge_customer_ids": preview.merge_customer_ids,
            },
        ).execute()
    except APIError as exc:
        logger.error(
            "merge_customers failed (keep=%s, merge=%s, code=%s)",
            preview.keep_customer_id,
            preview.merge_customer_ids,
            exc.code,
            exc_info=True,
        )
        if exc.code == "42501":
            raise MergeForbiddenError from exc
        if exc.code == "P0002":
            raise MergeCustomerNotFoundError from exc
        raise MergeConflictError from exc
    return CustomerMergeCounts.model_validate(cast(dict[str, Any], result.data))


def list_merge_log(
    db: Client, tenant_id: str, limit: int = 100
) -> list[CustomerMergeLogEntry]:
    """統合の履歴を新しい順に返す。"""
    result = (
        db.table(SupabaseTableName.CUSTOMER_MERGE_LOG.value)
        .select(
            "id, keep_customer_id, keep_customer_name, merged_customers, counts, "
            "merged_by, merged_at"
        )
        .eq("tenant_id", tenant_id)
        .order("id", desc=True)
        .limit(limit)
        .execute()
    )
    return [
        CustomerMergeLogEntry.model_validate(row)
        for row in cast(list[dict[str, Any]], result.data or [])
    ]
