"""表記ゆれで重複登録された製品の統合（Issue #515）。

重複の候補の抽出（品名の直径・長さ・材質が一致する製品の組）、候補の検索（指定した直径・長さ・材質に
一致する製品）と、統合の事前チェック（付け替え・削除の件数と
統合を止める理由）を行う。事前チェックは実行前のプレビューと実行時の再検証の両方で使い、実行は
RPC `merge_products` で1トランザクションにまとめる。

計算（`group_duplicate_products()` / `summarize_candidates()` / `plan_merge()`）は DB から切り離した純粋関数に
保ち、DB の読み込みは `find_merge_groups()` / `find_merge_candidates()` / `load_merge_preview()` に置く。ルーターからユーザー JWT で呼ぶ（RLS 下で動く）。
"""

from collections import Counter, defaultdict
from collections.abc import Iterable
from decimal import Decimal
from typing import Any, cast

from postgrest.exceptions import APIError

from app.models.master.product_merge_schemas import (
    MergeBlockerReason,
    ProductMergeBlocker,
    ProductMergeCandidate,
    ProductMergeCandidatesResponse,
    ProductMergeCounts,
    ProductMergeGroup,
    ProductMergeGroupsResponse,
    ProductMergeOrderRef,
    ProductMergePreview,
)
from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.services.daily_report_name_matching_service import fetch_all_rows
from app.services.product_spec_parser import (
    ProductSpec,
    format_decimal,
    normalize_material,
    parse_product_spec,
)
from app.utils.logger import get_logger
from supabase import Client  # type: ignore

logger = get_logger(__name__)

# 統合を実行できるロール（Frontend の PRODUCT_MERGE_ROLES と揃える）
MERGE_EDITOR_ROLES = ("president", "platform_admin")

_PRODUCT_COLUMNS = "id, name, code, is_active"
_ROUTING_COLUMNS = "id, product_id, sequence_order, unit_time_seconds"
_ORDER_COLUMNS = "id, order_number, product_id, customer_id, deadline_date, status"


class MergeProductNotFoundError(Exception):
    """残す製品・統合される製品のいずれかがテナントに無い。"""


class MergeForbiddenError(Exception):
    """統合の権限が無い（RPC のロール確認で弾かれた）。"""


class MergeConflictError(Exception):
    """プレビュー後に他の操作で状況が変わり、RPC が制約違反等で失敗した。"""


# ---------------------------------------------------------------------------
# 純粋関数
# ---------------------------------------------------------------------------


def _unit_times(routings: Iterable[dict[str, Any]]) -> list[Decimal]:
    return [Decimal(str(r.get("unit_time_seconds") or 0)) for r in routings]


def correctness_rank(routings: list[dict[str, Any]]) -> int:
    """残す製品を選ぶための「正しさ」の順位。

    3: 工程時間が小数まで登録されている > 2: 工程時間が登録されている > 1: 工程が登録されている > 0: 工程なし
    """
    if not routings:
        return 0
    times = _unit_times(routings)
    if any(t != t.to_integral_value() for t in times):
        return 3
    if any(t > 0 for t in times):
        return 2
    return 1


def group_duplicate_products(
    products: list[dict[str, Any]],
) -> list[ProductMergeGroup]:
    """品名の直径・長さ・材質が一致する製品が2件以上ある組を返す。品名を読み取れない製品は対象外。

    接頭辞だけが違う製品の組も参考として含める（`mergeable=False`）。統合できる組を先に、
    件数の多い順に並べる。
    """
    groups: dict[tuple[Decimal, Decimal, str], list[tuple[dict[str, Any], ProductSpec]]]
    groups = defaultdict(list)
    for product in sorted(products, key=lambda p: p["id"]):
        spec = parse_product_spec(product["name"])
        if spec is not None:
            groups[(spec.diameter, spec.length, spec.material_key)].append(
                (product, spec)
            )

    result: list[tuple[tuple[Decimal, Decimal, str], ProductMergeGroup]] = []
    for key, members in groups.items():
        if len(members) < 2:
            continue
        diameter, length, _ = key
        prefix_counts = Counter(spec.prefix_key for _, spec in members)
        material = Counter(spec.material for _, spec in members).most_common(1)[0][0]
        result.append(
            (
                key,
                ProductMergeGroup(
                    diameter=format_decimal(diameter),
                    length=format_decimal(length),
                    material=material,
                    product_count=len(members),
                    mergeable=max(prefix_counts.values()) >= 2,
                    product_names=[product["name"] for product, _ in members],
                ),
            )
        )
    result.sort(key=lambda r: (not r[1].mergeable, -r[1].product_count, r[0]))
    return [group for _, group in result]


def summarize_candidates(
    products: list[tuple[dict[str, Any], ProductSpec]],
    routings: list[dict[str, Any]],
    orders: list[dict[str, Any]],
    aliases: list[dict[str, Any]],
) -> tuple[list[ProductMergeCandidate], int | None]:
    """候補ごとの件数をまとめ、正しさの順に並べる。残す製品の初期選択（同順位が複数なら None）も返す。"""
    routings_by_product: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for routing in routings:
        routings_by_product[routing["product_id"]].append(routing)
    orders_by_product: dict[int, Counter[str]] = defaultdict(Counter)
    for order in orders:
        orders_by_product[order["product_id"]][order["status"]] += 1
    alias_counts = Counter(a["product_id"] for a in aliases)

    candidates: list[ProductMergeCandidate] = []
    for product, spec in products:
        product_routings = routings_by_product[product["id"]]
        times = _unit_times(product_routings)
        candidates.append(
            ProductMergeCandidate(
                id=product["id"],
                name=product["name"],
                code=product.get("code"),
                is_active=bool(product.get("is_active", True)),
                prefix=spec.prefix,
                prefix_key=spec.prefix_key,
                routing_count=len(product_routings),
                timed_routing_count=sum(1 for t in times if t > 0),
                has_decimal_time=any(t != t.to_integral_value() for t in times),
                order_counts=dict(orders_by_product[product["id"]]),
                alias_count=alias_counts[product["id"]],
                rank=correctness_rank(product_routings),
            )
        )

    candidates.sort(key=lambda c: (-c.rank, c.id))
    top = [c for c in candidates if candidates and c.rank == candidates[0].rank]
    default_keep = top[0].id if len(top) == 1 else None
    return candidates, default_keep


def _plan_order_conflicts(
    keep_product_id: int, orders: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[tuple[dict[str, Any], dict[str, Any]]]]:
    """付け替えで orders_dedupe_key（顧客・製品・納期）が衝突する受注を調べる。

    同じ (顧客, 納期) の受注のうち、残す製品の受注があればそれが枠を持つ。無ければ統合される側の
    出荷済み以外の受注（無ければ出荷済みの受注）のうち ID の若いものが枠を持つ。枠を持てなかった
    統合される側の受注は、出荷済みなら削除、それ以外は統合を止める。顧客・納期が NULL の受注は
    UNIQUE で衝突しない。

    Returns:
        (削除する出荷済みの受注, [(衝突して統合を止める受注, 衝突先の受注)])
    """
    groups: dict[tuple[Any, Any], list[dict[str, Any]]] = defaultdict(list)
    for order in orders:
        if order.get("customer_id") is None or order.get("deadline_date") is None:
            continue
        groups[(order["customer_id"], order["deadline_date"])].append(order)

    to_delete: list[dict[str, Any]] = []
    conflicts: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for members in groups.values():
        merged = sorted(
            (o for o in members if o["product_id"] != keep_product_id),
            key=lambda o: o["id"],
        )
        if not merged:
            continue
        holder = next((o for o in members if o["product_id"] == keep_product_id), None)
        active = [o for o in merged if o["status"] != "shipped"]
        shipped = [o for o in merged if o["status"] == "shipped"]
        if holder is None:
            holder = active.pop(0) if active else shipped.pop(0)
        conflicts.extend((order, holder) for order in active)
        to_delete.extend(shipped)
    return to_delete, conflicts


def plan_merge(
    keep_product: dict[str, Any],
    merge_products: list[dict[str, Any]],
    routings: list[dict[str, Any]],
    orders: list[dict[str, Any]],
    schedules: list[dict[str, Any]],
    alias_count: int,
    alias_history_count: int,
) -> ProductMergePreview:
    """統合の付け替え・削除の件数と、統合を止める理由を求める。

    Args:
        routings: 残す製品・統合される製品の工程
        orders: 残す製品・統合される製品の受注
        schedules: 統合される製品の工程を参照するスケジュールのセグメント
        alias_count / alias_history_count: 統合される製品を指す別名・別名履歴の件数
    """
    keep_id = keep_product["id"]
    merge_ids = [p["id"] for p in merge_products]
    names = {p["id"]: p["name"] for p in [keep_product, *merge_products]}
    blockers: list[ProductMergeBlocker] = []

    keep_spec = parse_product_spec(keep_product["name"])
    for product in merge_products:
        spec = parse_product_spec(product["name"])
        reason: MergeBlockerReason
        if (
            keep_spec is None
            or spec is None
            or not spec.same_size_and_material(keep_spec)
        ):
            reason = "spec_mismatch"
        elif spec.prefix_key != keep_spec.prefix_key:
            reason = "prefix_mismatch"
        else:
            continue
        blockers.append(
            ProductMergeBlocker(
                reason=reason, product_id=product["id"], product_name=product["name"]
            )
        )

    to_delete, conflicts = _plan_order_conflicts(keep_id, orders)
    for order, holder in conflicts:
        blockers.append(
            ProductMergeBlocker(
                reason="order_conflict",
                product_id=order["product_id"],
                product_name=names[order["product_id"]],
                order_id=order["id"],
                order_number=order.get("order_number"),
                order_status=order["status"],
                conflicting_order_id=holder["id"],
                conflicting_order_number=holder.get("order_number"),
            )
        )

    # 削除する受注のセグメントは CASCADE で消えるので、付け替え・工程の対応の確認から外す
    deleted_order_ids = {o["id"] for o in to_delete}
    orders_by_id = {o["id"]: o for o in orders}
    merge_routings = {r["id"]: r for r in routings if r["product_id"] in merge_ids}
    keep_sequences = {
        r["sequence_order"] for r in routings if r["product_id"] == keep_id
    }
    schedules_reassigned = 0
    mismatched: set[tuple[int, int]] = set()
    for segment in schedules:
        routing = merge_routings.get(segment["process_routing_id"])
        if routing is None or segment["order_id"] in deleted_order_ids:
            continue
        schedules_reassigned += 1
        if routing["sequence_order"] in keep_sequences:
            continue
        key = (segment["order_id"], routing["sequence_order"])
        if key in mismatched:
            continue
        mismatched.add(key)
        order = orders_by_id.get(segment["order_id"], {})
        blockers.append(
            ProductMergeBlocker(
                reason="routing_mismatch",
                product_id=routing["product_id"],
                product_name=names[routing["product_id"]],
                order_id=segment["order_id"],
                order_number=order.get("order_number"),
                order_status=order.get("status"),
                sequence_order=routing["sequence_order"],
            )
        )

    merge_orders = [o for o in orders if o["product_id"] in merge_ids]
    return ProductMergePreview(
        keep_product_id=keep_id,
        merge_product_ids=merge_ids,
        counts=ProductMergeCounts(
            orders_reassigned=sum(
                1 for o in merge_orders if o["id"] not in deleted_order_ids
            ),
            schedules_reassigned=schedules_reassigned,
            aliases_reassigned=alias_count,
            alias_history_reassigned=alias_history_count,
            orders_deleted=len(to_delete),
            routings_deleted=len(merge_routings),
            products_deleted=len(merge_ids),
        ),
        deleted_orders=[
            ProductMergeOrderRef(
                id=o["id"],
                order_number=o.get("order_number"),
                product_id=o["product_id"],
                status=o["status"],
            )
            for o in sorted(to_delete, key=lambda o: o["id"])
        ],
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
    if not values:
        return []
    return fetch_all_rows(
        lambda: (
            db.table(table.value)
            .select(columns)
            .eq("tenant_id", tenant_id)
            .in_(column, values)
            .order("id")
        )
    )


def _load_products(db: Client, tenant_id: str) -> list[dict[str, Any]]:
    """テナントの全製品（無効な製品を含む）。"""
    return fetch_all_rows(
        lambda: (
            db.table(SupabaseTableName.PRODUCTS.value)
            .select(_PRODUCT_COLUMNS)
            .eq("tenant_id", tenant_id)
            .order("id")
        )
    )


def find_merge_groups(db: Client, tenant_id: str) -> ProductMergeGroupsResponse:
    """テナントの全製品（無効な製品を含む）から重複の候補の組を抽出する。"""
    return ProductMergeGroupsResponse(
        groups=group_duplicate_products(_load_products(db, tenant_id))
    )


def find_merge_candidates(
    db: Client, tenant_id: str, diameter: Decimal, length: Decimal, material: str
) -> ProductMergeCandidatesResponse:
    """品名の直径・長さ・材質が一致する製品（無効な製品を含む）を候補として返す。"""
    material_key = normalize_material(material)
    products = _load_products(db, tenant_id)
    matched: list[tuple[dict[str, Any], ProductSpec]] = []
    for product in products:
        spec = parse_product_spec(product["name"])
        if (
            spec is not None
            and spec.diameter == diameter
            and spec.length == length
            and spec.material_key == material_key
        ):
            matched.append((product, spec))

    ids = [p["id"] for p, _ in matched]
    candidates, default_keep = summarize_candidates(
        matched,
        _select_in(
            db,
            SupabaseTableName.PROCESS_ROUTINGS,
            _ROUTING_COLUMNS,
            tenant_id,
            "product_id",
            ids,
        ),
        _select_in(
            db,
            SupabaseTableName.ORDERS,
            "id, product_id, status",
            tenant_id,
            "product_id",
            ids,
        ),
        _select_in(
            db,
            SupabaseTableName.PRODUCT_NAME_ALIASES,
            "id, product_id",
            tenant_id,
            "product_id",
            ids,
        ),
    )
    return ProductMergeCandidatesResponse(
        diameter=format_decimal(diameter),
        length=format_decimal(length),
        material=material.strip(),
        candidates=candidates,
        default_keep_product_id=default_keep,
    )


def load_merge_preview(
    db: Client, tenant_id: str, keep_product_id: int, merge_product_ids: list[int]
) -> ProductMergePreview:
    """統合の事前チェックに必要な行を読み、`plan_merge()` で件数と止める理由を求める。

    Raises:
        MergeProductNotFoundError: 残す製品・統合される製品のいずれかがテナントに無い
    """
    all_ids = [keep_product_id, *merge_product_ids]
    products = {
        p["id"]: p
        for p in _select_in(
            db, SupabaseTableName.PRODUCTS, _PRODUCT_COLUMNS, tenant_id, "id", all_ids
        )
    }
    if any(pid not in products for pid in all_ids):
        raise MergeProductNotFoundError

    routings = _select_in(
        db,
        SupabaseTableName.PROCESS_ROUTINGS,
        _ROUTING_COLUMNS,
        tenant_id,
        "product_id",
        all_ids,
    )
    merge_routing_ids = [
        r["id"] for r in routings if r["product_id"] != keep_product_id
    ]
    return plan_merge(
        keep_product=products[keep_product_id],
        merge_products=[products[pid] for pid in merge_product_ids],
        routings=routings,
        orders=_select_in(
            db,
            SupabaseTableName.ORDERS,
            _ORDER_COLUMNS,
            tenant_id,
            "product_id",
            all_ids,
        ),
        schedules=_select_in(
            db,
            SupabaseTableName.PRODUCTION_SCHEDULES,
            "id, order_id, process_routing_id",
            tenant_id,
            "process_routing_id",
            merge_routing_ids,
        ),
        alias_count=len(
            _select_in(
                db,
                SupabaseTableName.PRODUCT_NAME_ALIASES,
                "id",
                tenant_id,
                "product_id",
                merge_product_ids,
            )
        ),
        alias_history_count=len(
            _select_in(
                db,
                SupabaseTableName.PRODUCT_NAME_ALIAS_HISTORY,
                "id",
                tenant_id,
                "product_id",
                merge_product_ids,
            )
        ),
    )


def execute_merge(
    db: Client, tenant_id: str, preview: ProductMergePreview
) -> ProductMergeCounts:
    """RPC `merge_products` で統合を1トランザクションで実行する。

    止める理由が無いことは呼び出し側で確かめておく。プレビュー後に受注・スケジュールが変わって
    いた場合は RPC が制約違反（23505 / 23503）や削除件数の不一致で失敗し、何も変わらない。

    Raises:
        MergeForbiddenError: 統合の権限が無い
        MergeProductNotFoundError: 製品が他の操作で削除された
        MergeConflictError: 上記以外で RPC が失敗した（プレビューからやり直す）
    """
    try:
        result = db.rpc(
            "merge_products",
            {
                "p_tenant_id": tenant_id,
                "p_keep_product_id": preview.keep_product_id,
                "p_merge_product_ids": preview.merge_product_ids,
                "p_delete_order_ids": [o.id for o in preview.deleted_orders],
            },
        ).execute()
    except APIError as exc:
        logger.error(
            "merge_products failed (keep=%s, merge=%s, code=%s)",
            preview.keep_product_id,
            preview.merge_product_ids,
            exc.code,
            exc_info=True,
        )
        if exc.code == "42501":
            raise MergeForbiddenError from exc
        if exc.code == "P0002":
            raise MergeProductNotFoundError from exc
        raise MergeConflictError from exc
    return ProductMergeCounts.model_validate(cast(dict[str, Any], result.data))
