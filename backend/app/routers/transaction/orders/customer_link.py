# routers/transaction/orders/customer_link.py
"""顧客不明の注文を既存の顧客へ紐づける（Issue #609）。

- GET  /orders/{order_id}/customer-link-context: 差出人・担当者の登録状況・同じドメインの候補
- POST /orders/{order_id}/link-customer: 紐づけ（任意で差出人を担当者へ登録・同じ差出人の注文をまとめて紐づけ）
"""

from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import get_current_tenant_id, get_order_repo, get_supabase_client
from app.models.transaction.order_schema import (
    OrderCustomerLinkContext,
    OrderLinkCustomerRequest,
    OrderLinkCustomerResponse,
)
from app.repositories.supa_infra.common import DuplicateRecordError
from app.repositories.supa_infra.transaction.order_repo import OrderRepository
from app.services.customer_link_service import (
    LinkContactConflictError,
    LinkCustomerNotFoundError,
    LinkForbiddenError,
    LinkOrderDuplicateError,
    LinkOrderNotFoundError,
    LinkOrderNotUnknownError,
    get_link_context,
    link_customer,
)
from supabase import Client

from ._shared import _duplicate_order_conflict_exception

router = APIRouter()


@router.get(
    "/{order_id}/customer-link-context", response_model=OrderCustomerLinkContext
)
def get_customer_link_context(
    order_id: int,
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
    repo: OrderRepository = Depends(get_order_repo),
):
    """顧客不明の注文を紐づけるときに出す情報。顧客不明でない注文は空の情報を返す。"""
    order = repo.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Not found")
    if order.get("customer_id") is not None:
        return OrderCustomerLinkContext()
    return get_link_context(client, tenant_id, order)


@router.post("/{order_id}/link-customer", response_model=OrderLinkCustomerResponse)
def link_customer_to_order(
    order_id: int,
    body: OrderLinkCustomerRequest,
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
    repo: OrderRepository = Depends(get_order_repo),
):
    """顧客不明の注文に既存の顧客を紐づける。

    元メールの差出人アドレスは、`register_contact` が true ならその顧客の担当者として登録する。
    既に別の顧客の担当者であれば上書きせず 409 `contact_owned_by_other_customer`。
    """
    order = repo.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Not found")
    try:
        return link_customer(
            client,
            tenant_id,
            order_id,
            body.customer_id,
            body.register_contact,
            body.apply_to_same_sender,
        )
    except LinkContactConflictError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "contact_owned_by_other_customer",
                "message": "このメールアドレスは別の顧客の担当者として登録済みです",
            },
        ) from None
    except LinkOrderDuplicateError as e:
        raise _duplicate_order_conflict_exception(
            DuplicateRecordError(str(e), constraint=e.constraint),
            client=client,
            order_repo=repo,
            tenant_id=tenant_id,
            customer_id=body.customer_id,
            product_id=order.get("product_id"),
            deadline_date=order.get("deadline_date"),
            extracted_product_name=order.get("extracted_product_name"),
            exclude_order_id=order_id,
        ) from None
    except LinkOrderNotUnknownError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "customer_already_set",
                "message": "この注文にはすでに顧客が設定されています",
            },
        ) from None
    except LinkCustomerNotFoundError:
        raise HTTPException(status_code=404, detail="顧客が見つかりません") from None
    except LinkOrderNotFoundError:
        raise HTTPException(status_code=404, detail="Not found") from None
    except LinkForbiddenError:
        raise HTTPException(status_code=403, detail="権限がありません") from None
