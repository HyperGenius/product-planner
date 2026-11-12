# routers/transaction/shipments.py
"""弥生の売上明細の名寄せと送品の突合 (Issue #667, #662 フェーズ2)。

- 送品の消し込み: 受注ごとに弥生で送品が確認できた数量（分納を合算）を返す。**自動では送品済みにしない**
- 名寄せ: 得意先 → 顧客（1対多。商流のため）、(得意先, 商品コード) → 製品の辞書と「対象外」

照合・突合は参照のたびに求める（`services/shipment_matching_service.py`）。辞書はユーザー JWT で書き、
書き込めるのは事務担当者（Frontend の `SHIPMENT_NAME_EDITOR_ROLES` と揃える）。
"""

from datetime import UTC, datetime
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from postgrest.exceptions import APIError

from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_current_user_role,
    get_supabase_client,
)
from app.models.shipment import (
    ShipmentCustomerItem,
    ShipmentCustomerLinkCreate,
    ShipmentIgnoredCreate,
    ShipmentOrderMatchListResponse,
    ShipmentProductItem,
    ShipmentProductLinkUpsert,
)
from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.services.shipment_matcher import normalize_code
from app.services.shipment_matching_service import (
    get_order_shipments,
    list_customer_items,
    list_product_items,
)
from supabase import Client  # type: ignore

shipments_router = APIRouter(prefix="/shipments", tags=["Shipments"])

# 辞書・対象外を書き込めるロール（送品の消し込み・弥生の取り込みと同じ事務担当者）
SHIPMENT_NAME_EDITOR_ROLES = ("order_handler", "president", "platform_admin")

# 送品の消し込みの対象の受注をまとめて引く。URL の長さを抑えるため上限を設ける
_MAX_ORDER_IDS = 500
_UNIQUE_VIOLATION = "23505"


def _require_editor(tenant_id: str, user_id: str, client: Client) -> None:
    role = get_current_user_role(tenant_id, user_id, client)
    if role not in SHIPMENT_NAME_EDITOR_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "弥生の名寄せの編集は "
                f"{'/'.join(SHIPMENT_NAME_EDITOR_ROLES)} のみ操作できます"
            ),
        )


def _require_row(
    client: Client, table: SupabaseTableName, tenant_id: str, row_id: int, label: str
) -> None:
    """照合先がこのテナントに存在することを確かめる（他テナントの ID を指させない）。"""
    result = (
        client.table(table.value)
        .select("id")
        .eq("tenant_id", tenant_id)
        .eq("id", row_id)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"{label}が見つかりません",
        )


def _code_key(value: str | None, label: str) -> str:
    key = normalize_code(value)
    if not key:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"{label}が空です",
        )
    return key


def _conflict(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"error": "duplicate_shipment_name", "message": message},
    )


def _delete_row(
    client: Client, table: SupabaseTableName, tenant_id: str, row_id: str
) -> Response:
    result = (
        client.table(table.value)
        .delete()
        .eq("tenant_id", tenant_id)
        .eq("id", row_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@shipments_router.get("/order-matches", response_model=ShipmentOrderMatchListResponse)
def get_shipment_order_matches(
    order_id: list[int] | None = Query(default=None, max_length=_MAX_ORDER_IDS),
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
):
    """受注ごとの弥生の送品（`?order_id=1&order_id=2` で絞る。省略時は当たった受注すべて）。"""
    return get_order_shipments(client, tenant_id, order_id)


@shipments_router.get("/customers", response_model=list[ShipmentCustomerItem])
def get_shipment_customers(
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
):
    """得意先ごとの照合状況と候補（名寄せの画面）。"""
    return list_customer_items(client, tenant_id)


@shipments_router.get("/products", response_model=list[ShipmentProductItem])
def get_shipment_products(
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
):
    """(得意先, 商品コード) ごとの照合状況と候補（名寄せの画面）。"""
    return list_product_items(client, tenant_id)


@shipments_router.post("/customer-links", status_code=status.HTTP_201_CREATED)
def create_shipment_customer_link(
    body: ShipmentCustomerLinkCreate,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
) -> dict[str, Any]:
    """得意先に顧客をひも付ける。1つの得意先に複数の顧客を登録できる（商流）。"""
    _require_editor(tenant_id, user_id, client)
    customer_code = _code_key(body.customer_code, "得意先コード")
    _require_row(
        client, SupabaseTableName.CUSTOMERS, tenant_id, body.customer_id, "顧客"
    )
    try:
        result = (
            client.table(SupabaseTableName.SHIPMENT_CUSTOMER_LINKS.value)
            .insert(
                {
                    "tenant_id": tenant_id,
                    "customer_code": customer_code,
                    "customer_id": body.customer_id,
                    "created_by": user_id,
                }
            )
            .execute()
        )
    except APIError as e:
        if e.code == _UNIQUE_VIOLATION:
            raise _conflict("この顧客は既にひも付いています") from e
        raise
    return cast(list[dict[str, Any]], result.data)[0]


@shipments_router.delete("/customer-links/{link_id}", status_code=204)
def delete_shipment_customer_link(
    link_id: str,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
) -> Response:
    _require_editor(tenant_id, user_id, client)
    return _delete_row(
        client, SupabaseTableName.SHIPMENT_CUSTOMER_LINKS, tenant_id, link_id
    )


@shipments_router.put("/product-links")
def upsert_shipment_product_link(
    body: ShipmentProductLinkUpsert,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
) -> dict[str, Any]:
    """(得意先, 商品コード) に製品を対応付ける。登録済みなら製品を付け替える。"""
    _require_editor(tenant_id, user_id, client)
    customer_code = _code_key(body.customer_code, "得意先コード")
    product_code = _code_key(body.product_code, "商品コード")
    _require_row(client, SupabaseTableName.PRODUCTS, tenant_id, body.product_id, "製品")

    table = client.table(SupabaseTableName.SHIPMENT_PRODUCT_LINKS.value)
    existing = (
        table.select("id")
        .eq("tenant_id", tenant_id)
        .eq("customer_code", customer_code)
        .eq("product_code", product_code)
        .limit(1)
        .execute()
    )
    if existing.data:
        link_id = cast(list[dict[str, Any]], existing.data)[0]["id"]
        result = (
            client.table(SupabaseTableName.SHIPMENT_PRODUCT_LINKS.value)
            .update(
                {
                    "product_id": body.product_id,
                    "updated_at": datetime.now(UTC).isoformat(),
                }
            )
            .eq("tenant_id", tenant_id)
            .eq("id", link_id)
            .execute()
        )
        return cast(list[dict[str, Any]], result.data)[0]
    try:
        result = (
            client.table(SupabaseTableName.SHIPMENT_PRODUCT_LINKS.value)
            .insert(
                {
                    "tenant_id": tenant_id,
                    "customer_code": customer_code,
                    "product_code": product_code,
                    "product_id": body.product_id,
                    "created_by": user_id,
                }
            )
            .execute()
        )
    except APIError as e:
        if e.code == _UNIQUE_VIOLATION:
            raise _conflict("この商品は既に対応付けられています") from e
        raise
    return cast(list[dict[str, Any]], result.data)[0]


@shipments_router.delete("/product-links/{link_id}", status_code=204)
def delete_shipment_product_link(
    link_id: str,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
) -> Response:
    _require_editor(tenant_id, user_id, client)
    return _delete_row(
        client, SupabaseTableName.SHIPMENT_PRODUCT_LINKS, tenant_id, link_id
    )


@shipments_router.post("/ignored", status_code=status.HTTP_201_CREATED)
def create_shipment_ignored(
    body: ShipmentIgnoredCreate,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
) -> dict[str, Any]:
    """送料など商品ではない行（kind=product）や、突合に使わない得意先（kind=customer）を対象外にする。"""
    _require_editor(tenant_id, user_id, client)
    customer_code = _code_key(body.customer_code, "得意先コード")
    product_code = (
        _code_key(body.product_code, "商品コード") if body.kind == "product" else None
    )
    try:
        result = (
            client.table(SupabaseTableName.SHIPMENT_IGNORED_CODES.value)
            .insert(
                {
                    "tenant_id": tenant_id,
                    "kind": body.kind,
                    "customer_code": customer_code,
                    "product_code": product_code,
                    "created_by": user_id,
                }
            )
            .execute()
        )
    except APIError as e:
        if e.code == _UNIQUE_VIOLATION:
            raise _conflict("既に対象外に登録されています") from e
        raise
    return cast(list[dict[str, Any]], result.data)[0]


@shipments_router.delete("/ignored/{ignored_id}", status_code=204)
def delete_shipment_ignored(
    ignored_id: str,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
) -> Response:
    _require_editor(tenant_id, user_id, client)
    return _delete_row(
        client, SupabaseTableName.SHIPMENT_IGNORED_CODES, tenant_id, ignored_id
    )
