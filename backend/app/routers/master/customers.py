# routers/master/customers.py
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_current_user_role,
    get_customer_repo,
    get_supabase_client,
)
from app.models.master import CustomerCreateSchema, CustomerUpdateSchema
from app.models.master.customer_merge_schemas import (
    CustomerMergeCounts,
    CustomerMergeLogEntry,
    CustomerMergePreview,
    CustomerMergeRequest,
)
from app.repositories.supa_infra.master.customer_repo import CustomerRepository
from app.services import customer_merge_service
from app.services.customer_contact_service import sync_primary_contact
from app.utils.logger import get_logger
from supabase import Client  # type: ignore

customer_router = APIRouter(prefix="/customers", tags=["Master (Customers)"])

logger = get_logger(__name__)

# 抽出指示の本文は platform_admin 専用の API（customer_extraction_prompt.py）だけが返す（Issue #602）
_HIDDEN_COLUMNS = ("order_extraction_prompt",)


def _public_customer(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {key: value for key, value in row.items() if key not in _HIDDEN_COLUMNS}


@customer_router.post("")
def create_customer(
    customer_data: CustomerCreateSchema,
    tenant_id: str = Depends(get_current_tenant_id),
    repo: CustomerRepository = Depends(get_customer_repo),
):
    """顧客を新規作成"""
    logger.info(f"Creating customer {customer_data}")
    created = repo.create(customer_data.with_tenant_id(tenant_id))
    if created.get("email"):
        # ユーザー JWT のクライアントで書く（customer_contacts も RLS で守られる）
        sync_primary_contact(
            repo.client, tenant_id, int(created["id"]), None, created["email"]
        )
    return _public_customer(created)


_MERGE_FORBIDDEN = "顧客の統合は president または platform_admin のみ操作できます"
_MERGE_CUSTOMER_NOT_FOUND = "統合する顧客が見つかりません"


def _require_merge_editor(tenant_id: str, user_id: str, client: Client) -> None:
    role = get_current_user_role(tenant_id, user_id, client)
    if role not in customer_merge_service.MERGE_EDITOR_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=_MERGE_FORBIDDEN
        )


def _load_merge_preview(
    client: Client, tenant_id: str, payload: CustomerMergeRequest
) -> CustomerMergePreview:
    try:
        return customer_merge_service.load_merge_preview(
            client, tenant_id, payload.keep_customer_id, payload.merge_customer_ids
        )
    except customer_merge_service.MergeCustomerNotFoundError as exc:
        raise HTTPException(status_code=404, detail=_MERGE_CUSTOMER_NOT_FOUND) from exc


# /{customer_id} より先に登録する（"merge-log" が customer_id として解釈されないように）
@customer_router.get("/merge-log", response_model=list[CustomerMergeLogEntry])
def get_customer_merge_log(
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    """顧客の統合の履歴（どの顧客をどこへ統合したか）を新しい順に返す（Issue #610）"""
    _require_merge_editor(tenant_id, user_id, client)
    return customer_merge_service.list_merge_log(client, tenant_id)


@customer_router.post("/merge/preview", response_model=CustomerMergePreview)
def preview_customer_merge(
    payload: CustomerMergeRequest,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    """統合の付け替え・削除の件数と、統合を止める理由を返す（Issue #610）"""
    _require_merge_editor(tenant_id, user_id, client)
    return _load_merge_preview(client, tenant_id, payload)


@customer_router.post("/merge", response_model=CustomerMergeCounts)
def merge_customers(
    payload: CustomerMergeRequest,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
):
    """重複顧客を残す顧客へ統合する（Issue #610、取り消し不可）。

    実行直前に事前チェックをやり直し、止める理由があれば 409（`merge_blocked`）を返す。
    チェック後に他の操作と競合して RPC が失敗した場合も 409（`merge_conflict`）。
    どちらもレスポンスに生の DB 例外文言を載せない。
    """
    _require_merge_editor(tenant_id, user_id, client)
    preview = _load_merge_preview(client, tenant_id, payload)
    if preview.blockers:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "merge_blocked",
                "message": "統合できない理由があります",
                "blockers": [b.model_dump() for b in preview.blockers],
            },
        )

    logger.info(
        f"Merging customers {payload.merge_customer_ids} into {payload.keep_customer_id}"
    )
    try:
        return customer_merge_service.execute_merge(client, tenant_id, preview)
    except customer_merge_service.MergeForbiddenError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=_MERGE_FORBIDDEN
        ) from exc
    except customer_merge_service.MergeCustomerNotFoundError as exc:
        raise HTTPException(status_code=404, detail=_MERGE_CUSTOMER_NOT_FOUND) from exc
    except customer_merge_service.MergeConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "merge_conflict",
                "message": "他の操作と競合したため統合できませんでした。プレビューからやり直してください",
            },
        ) from exc


@customer_router.get("")
def get_customers(repo: CustomerRepository = Depends(get_customer_repo)):
    """顧客を全件取得"""
    logger.info("Fetching all customers")
    return [_public_customer(row) for row in repo.get_all()]


@customer_router.get("/{customer_id}")
def get_customer(
    customer_id: int, repo: CustomerRepository = Depends(get_customer_repo)
):
    """顧客を1件取得"""
    logger.info(f"Fetching customer {customer_id}")
    return _public_customer(repo.get_by_id(customer_id))


@customer_router.patch("/{customer_id}")
def update_customer(
    customer_id: int,
    customer_data: CustomerUpdateSchema,
    repo: CustomerRepository = Depends(get_customer_repo),
):
    """顧客を更新。専用の「確定」ボタンは設けず、保存するだけで下書きが解除される
    （status は常に 'active' に上書きする）"""
    logger.info(f"Updating customer {customer_id}")
    update_data = customer_data.model_dump(exclude_unset=True)
    update_data["status"] = "active"
    # email を送ったときだけ担当者へ反映する（送らない更新では担当者に触れない）
    before = repo.get_by_id(customer_id) if "email" in update_data else None
    updated = repo.update(customer_id, update_data)
    if before is not None:
        sync_primary_contact(
            repo.client,
            before["tenant_id"],
            customer_id,
            before.get("email"),
            updated.get("email"),
        )
    return _public_customer(updated)


@customer_router.delete("/{customer_id}")
def delete_customer(
    customer_id: int, repo: CustomerRepository = Depends(get_customer_repo)
):
    """顧客を削除"""
    logger.info(f"Deleting customer {customer_id}")
    try:
        success = repo.delete(customer_id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from None
    if not success:
        raise HTTPException(status_code=404, detail="Not found")
    return {"status": "deleted"}
