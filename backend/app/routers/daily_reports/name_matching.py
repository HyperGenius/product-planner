# routers/daily_reports/name_matching.py
"""日報の名寄せ: 未照合の表記の一覧と別名辞書の登録・変更・削除 (Issue #488)。

照合結果は明細に保存せず、明細＋マスタ＋辞書から都度解決する
（`services/daily_report_name_matching_service.py`）。辞書を変えれば過去の明細にも反映される。

参照はテナントメンバー全員、辞書の書き込みは事務担当者（order_handler / president /
platform_admin）に限る。製品の別名は既存の product_name_aliases（顧客単位）に
source='daily_report' で登録し、変更・削除は製品マスタの別名 API
（`PATCH|DELETE /products/{product_id}/aliases/{alias_id}`）を使う。
"""

from dataclasses import dataclass
from typing import Any, cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from postgrest.exceptions import APIError

from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_current_user_role,
    get_supabase_client,
)
from app.models.daily_report_names import (
    CustomerNameAliasCreate,
    CustomerNameAliasUpdate,
    DailyReportProductAliasCreate,
    EquipmentNameAliasCreate,
    EquipmentNameAliasUpdate,
    NameKindParam,
    ProcessNameAliasCreate,
    ProcessNameAliasUpdate,
    ProductCandidateResponse,
    UnmatchedNameResponse,
)
from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.services.daily_report_name_matching_service import (
    fetch_all_rows,
    list_unmatched_names,
)
from app.services.product_alias_service import register_daily_report_alias
from app.services.product_matching_service import match_products
from app.utils.logger import get_logger
from supabase import Client  # type: ignore

daily_report_names_router = APIRouter(
    prefix="/daily-reports", tags=["Daily Reports (Name Matching)"]
)

logger = get_logger(__name__)

# 辞書を書き込めるロール（事務担当者）。iso_officer は日報の名寄せを担当しない
_ALIAS_EDITOR_ROLES = ("order_handler", "president", "platform_admin")


@dataclass(frozen=True)
class _AliasTable:
    table: str
    columns: str
    # 照合先の列（equipment_id / process_names / customer_id）
    target_column: str


_EQUIPMENT = _AliasTable(
    SupabaseTableName.EQUIPMENT_NAME_ALIASES.value,
    "id, raw_text, equipment_id, created_by, created_at, updated_at",
    "equipment_id",
)
_PROCESS = _AliasTable(
    SupabaseTableName.PROCESS_NAME_ALIASES.value,
    "id, raw_text, process_names, created_by, created_at, updated_at",
    "process_names",
)
_CUSTOMER = _AliasTable(
    SupabaseTableName.CUSTOMER_NAME_ALIASES.value,
    "id, raw_text, customer_id, created_by, created_at, updated_at",
    "customer_id",
)


def _require_alias_editor(tenant_id: str, user_id: str, client: Client) -> None:
    role = get_current_user_role(tenant_id, user_id, client)
    if role not in _ALIAS_EDITOR_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"別名辞書の編集は {'/'.join(_ALIAS_EDITOR_ROLES)} のみ操作できます",
        )


def _require_row(
    client: Client, table: str, tenant_id: str, row_id: int, label: str
) -> None:
    """照合先がこのテナントに存在することを確かめる（他テナントの ID を指させない）。"""
    result = (
        client.table(table)
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


def _require_process_names(client: Client, tenant_id: str, names: list[str]) -> None:
    """工程名がマスタ（process_routings.process_name）に存在することを確かめる。

    同じ工程名の行は製品の数だけあり、`in_()` でまとめて引くと max_rows で他の名前の行が
    切られうるので、名前ごとに1行だけ引く（指定される名前は数件）。
    """
    missing = []
    for name in names:
        result = (
            client.table(SupabaseTableName.PROCESS_ROUTINGS.value)
            .select("id")
            .eq("tenant_id", tenant_id)
            .eq("process_name", name)
            .limit(1)
            .execute()
        )
        if not result.data:
            missing.append(name)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"マスタに無い工程名です: {'、'.join(missing)}",
        )


def _list_aliases(
    client: Client, alias_table: _AliasTable, tenant_id: str
) -> list[dict[str, Any]]:
    return fetch_all_rows(
        lambda: (
            client.table(alias_table.table)
            .select(alias_table.columns)
            .eq("tenant_id", tenant_id)
            .order("raw_text")
            .order("id")
        )
    )


def _create_alias(
    client: Client,
    alias_table: _AliasTable,
    tenant_id: str,
    user_id: str,
    raw_text: str,
    target: Any,
) -> dict[str, Any]:
    try:
        result = (
            client.table(alias_table.table)
            .insert(
                {
                    "tenant_id": tenant_id,
                    "raw_text": raw_text,
                    alias_table.target_column: target,
                    "created_by": user_id,
                }
            )
            .execute()
        )
    except APIError as e:
        if e.code == "23505":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": "duplicate_alias",
                    "message": "この表記は既に登録されています",
                },
            ) from e
        raise
    return cast(list[dict[str, Any]], result.data)[0]


def _update_alias(
    client: Client,
    alias_table: _AliasTable,
    tenant_id: str,
    alias_id: UUID,
    target: Any,
) -> dict[str, Any]:
    result = (
        client.table(alias_table.table)
        .update({alias_table.target_column: target})
        .eq("tenant_id", tenant_id)
        .eq("id", str(alias_id))
        .execute()
    )
    rows = cast(list[dict[str, Any]], result.data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="別名が見つかりません")
    return rows[0]


def _delete_alias(
    client: Client, alias_table: _AliasTable, tenant_id: str, alias_id: UUID
) -> dict[str, str]:
    result = (
        client.table(alias_table.table)
        .delete()
        .eq("tenant_id", tenant_id)
        .eq("id", str(alias_id))
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="別名が見つかりません")
    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# 未照合の表記
# ---------------------------------------------------------------------------


@daily_report_names_router.get(
    "/unmatched-names", response_model=list[UnmatchedNameResponse]
)
def get_unmatched_names(
    kind: NameKindParam | None = Query(default=None),
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
):
    """照合できなかった表記の一覧（種別・表記・出現件数・最終出現日）を出現件数の多い順に返す。

    製品は (顧客先, 商品名) の組ごと。`customer_id` が None の製品は、先に顧客の
    対応付けをしないと製品の別名（顧客単位）を登録できない。
    """
    return list_unmatched_names(client, tenant_id, kind)


@daily_report_names_router.get(
    "/product-candidates", response_model=list[ProductCandidateResponse]
)
def get_product_candidates(
    raw_text: str = Query(min_length=1),
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
):
    """日報の商品名に似た製品（pg_trgm）の候補を返す。

    候補の提示専用。名寄せでは類似候補で自動確定しない（誤った照合で他の受注に実績が
    付くのを避けるため）ので、`match_products()` の自動確定結果は使わない。
    """
    return match_products(client, tenant_id, raw_text.strip())["candidates"]


# ---------------------------------------------------------------------------
# 設備の別名
# ---------------------------------------------------------------------------


@daily_report_names_router.get("/name-aliases/equipment")
def list_equipment_aliases(
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
):
    return _list_aliases(client, _EQUIPMENT, tenant_id)


@daily_report_names_router.post(
    "/name-aliases/equipment", status_code=status.HTTP_201_CREATED
)
def create_equipment_alias(
    payload: EquipmentNameAliasCreate,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    _require_alias_editor(tenant_id, user_id, client)
    _require_row(
        client,
        SupabaseTableName.EQUIPMENTS.value,
        tenant_id,
        payload.equipment_id,
        "設備",
    )
    return _create_alias(
        client, _EQUIPMENT, tenant_id, user_id, payload.raw_text, payload.equipment_id
    )


@daily_report_names_router.patch("/name-aliases/equipment/{alias_id}")
def update_equipment_alias(
    alias_id: UUID,
    payload: EquipmentNameAliasUpdate,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    _require_alias_editor(tenant_id, user_id, client)
    _require_row(
        client,
        SupabaseTableName.EQUIPMENTS.value,
        tenant_id,
        payload.equipment_id,
        "設備",
    )
    return _update_alias(client, _EQUIPMENT, tenant_id, alias_id, payload.equipment_id)


@daily_report_names_router.delete("/name-aliases/equipment/{alias_id}")
def delete_equipment_alias(
    alias_id: UUID,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    _require_alias_editor(tenant_id, user_id, client)
    return _delete_alias(client, _EQUIPMENT, tenant_id, alias_id)


# ---------------------------------------------------------------------------
# 工程の別名（1:N）
# ---------------------------------------------------------------------------


@daily_report_names_router.get("/name-aliases/process")
def list_process_aliases(
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
):
    return _list_aliases(client, _PROCESS, tenant_id)


@daily_report_names_router.post(
    "/name-aliases/process", status_code=status.HTTP_201_CREATED
)
def create_process_alias(
    payload: ProcessNameAliasCreate,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    _require_alias_editor(tenant_id, user_id, client)
    _require_process_names(client, tenant_id, payload.process_names)
    return _create_alias(
        client, _PROCESS, tenant_id, user_id, payload.raw_text, payload.process_names
    )


@daily_report_names_router.patch("/name-aliases/process/{alias_id}")
def update_process_alias(
    alias_id: UUID,
    payload: ProcessNameAliasUpdate,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    _require_alias_editor(tenant_id, user_id, client)
    _require_process_names(client, tenant_id, payload.process_names)
    return _update_alias(client, _PROCESS, tenant_id, alias_id, payload.process_names)


@daily_report_names_router.delete("/name-aliases/process/{alias_id}")
def delete_process_alias(
    alias_id: UUID,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    _require_alias_editor(tenant_id, user_id, client)
    return _delete_alias(client, _PROCESS, tenant_id, alias_id)


# ---------------------------------------------------------------------------
# 顧客の別名
# ---------------------------------------------------------------------------


@daily_report_names_router.get("/name-aliases/customer")
def list_customer_aliases(
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
):
    return _list_aliases(client, _CUSTOMER, tenant_id)


@daily_report_names_router.post(
    "/name-aliases/customer", status_code=status.HTTP_201_CREATED
)
def create_customer_alias(
    payload: CustomerNameAliasCreate,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    _require_alias_editor(tenant_id, user_id, client)
    _require_row(
        client,
        SupabaseTableName.CUSTOMERS.value,
        tenant_id,
        payload.customer_id,
        "顧客",
    )
    return _create_alias(
        client, _CUSTOMER, tenant_id, user_id, payload.raw_text, payload.customer_id
    )


@daily_report_names_router.patch("/name-aliases/customer/{alias_id}")
def update_customer_alias(
    alias_id: UUID,
    payload: CustomerNameAliasUpdate,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    _require_alias_editor(tenant_id, user_id, client)
    _require_row(
        client,
        SupabaseTableName.CUSTOMERS.value,
        tenant_id,
        payload.customer_id,
        "顧客",
    )
    return _update_alias(client, _CUSTOMER, tenant_id, alias_id, payload.customer_id)


@daily_report_names_router.delete("/name-aliases/customer/{alias_id}")
def delete_customer_alias(
    alias_id: UUID,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    _require_alias_editor(tenant_id, user_id, client)
    return _delete_alias(client, _CUSTOMER, tenant_id, alias_id)


# ---------------------------------------------------------------------------
# 製品の別名（product_name_aliases、顧客単位）
# ---------------------------------------------------------------------------


@daily_report_names_router.get("/name-aliases/product")
def list_product_aliases(
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
):
    """製品の別名の一覧。メール起票由来も含む（日報の照合はどの由来の別名も使う）。"""
    return fetch_all_rows(
        lambda: (
            client.table(SupabaseTableName.PRODUCT_NAME_ALIASES.value)
            .select(
                "id, customer_id, raw_text, product_id, source, created_at, updated_at"
            )
            .eq("tenant_id", tenant_id)
            .order("raw_text")
            .order("id")
        )
    )


@daily_report_names_router.post(
    "/name-aliases/product", status_code=status.HTTP_201_CREATED
)
def create_product_alias(
    payload: DailyReportProductAliasCreate,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    """日報の商品名を製品別名辞書に登録する（同じ顧客・表記があれば付け替える）。"""
    _require_alias_editor(tenant_id, user_id, client)
    _require_row(
        client,
        SupabaseTableName.CUSTOMERS.value,
        tenant_id,
        payload.customer_id,
        "顧客",
    )
    _require_row(
        client, SupabaseTableName.PRODUCTS.value, tenant_id, payload.product_id, "製品"
    )
    register_daily_report_alias(
        client,
        tenant_id,
        customer_id=payload.customer_id,
        raw_text=payload.raw_text,
        product_id=payload.product_id,
        changed_by=user_id,
    )
    return {
        "customer_id": payload.customer_id,
        "raw_text": payload.raw_text,
        "product_id": payload.product_id,
    }
