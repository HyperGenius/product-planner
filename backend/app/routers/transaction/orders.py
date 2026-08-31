# routers/transaction/orders.py
import csv
import io
import uuid
from datetime import UTC, date, datetime
from typing import Any, cast

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from postgrest.exceptions import APIError
from pydantic import ValidationError

from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_current_user_role,
    get_equipment_repo,
    get_order_approval_log_repo,
    get_order_repo,
    get_product_repo,
    get_schedule_repo,
    get_supabase_admin_client,
    get_supabase_client,
)
from app.models.transaction.order_schema import (
    EmailIntakeResultResponse,
    ManualEmailIntakeRequest,
    OrderApprovalLogResponse,
    OrderAttachmentResponse,
    OrderBulkApproveRequest,
    OrderCreate,
    OrderRejectRequest,
    OrderSimulateRequest,
    OrderSplitRequest,
    OrderUpdate,
    ShipOverdueDraftsResponse,
)
from app.repositories.supa_infra.common.scheduling_settings_repo import (
    SchedulingSettingsRepository,
)
from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.repositories.supa_infra.master.equipment_repo import EquipmentRepository
from app.repositories.supa_infra.master.product_repo import ProductRepository
from app.repositories.supa_infra.transaction.order_approval_log_repo import (
    OrderApprovalLogRepository,
)
from app.repositories.supa_infra.transaction.order_repo import OrderRepository
from app.repositories.supa_infra.transaction.schedule_repo import ScheduleRepository
from app.scheduler_logic import RoutingUnconfirmedError, schedule_order
from app.services.attachment_service import (
    create_signed_url,
    create_signed_urls,
    upload_manual_email_attachment,
)
from app.services.notification_service import create_notification
from app.services.order_status_service import (
    InvalidOrderStatusTransitionError,
    is_overdue_draft,
    validate_order_status_transition,
)
from app.services.product_alias_service import (
    record_auto_match_alias_if_applicable,
    record_correction_if_applicable,
)
from app.services.simulation_service import build_simulate_response
from app.utils.logger import get_logger
from supabase import Client

orders_router = APIRouter(prefix="/orders", tags=["Transaction (Orders)"])

logger = get_logger(__name__)


def _map_order_response(order: dict) -> dict:
    """
    データベース形式（order_number, deadline_date）を
    フロントエンド形式（order_no, desired_deadline）にマッピングする。
    """
    mapped = dict(order)
    if "order_number" in mapped:
        mapped["order_no"] = mapped.pop("order_number")
    if "deadline_date" in mapped:
        mapped["desired_deadline"] = mapped.pop("deadline_date")
    if "order_date" in mapped:
        mapped["created_at"] = mapped.pop("order_date")
    return mapped


@orders_router.post("")
def create_order(
    order_data: OrderCreate,
    tenant_id: str = Depends(get_current_tenant_id),
    repo: OrderRepository = Depends(get_order_repo),
):
    """注文を新規作成"""
    logger.info(f"Creating order {order_data}")
    try:
        result = repo.create(order_data.with_tenant_id(tenant_id))
        return _map_order_response(result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None


@orders_router.get("")
def get_orders(repo: OrderRepository = Depends(get_order_repo)):
    """注文を全件取得（has_no_routings / has_unconfirmed_routings フラグ付き）"""
    logger.info("Fetching all orders")
    results = repo.get_all_with_routing_status()
    return [_map_order_response(order) for order in results]


@orders_router.get("/unconfirmed-routing-queue")
def get_unconfirmed_routing_queue(
    repo: OrderRepository = Depends(get_order_repo),
    product_repo: ProductRepository = Depends(get_product_repo),
):
    """工程未確定の draft 注文を残バッファ昇順で返す専門家キュー"""
    logger.info("Fetching unconfirmed routing queue")
    today = date.today()

    all_orders = repo.get_all_with_routing_status()
    draft_unconfirmed = [
        o
        for o in all_orders
        if o.get("status") == "draft" and o.get("has_unconfirmed_routings")
    ]

    products = product_repo.get_all()
    product_name_map = {p["id"]: p.get("name", "不明") for p in products}

    product_ids = [o["product_id"] for o in draft_unconfirmed if o.get("product_id")]
    unconfirmed_counts = product_repo.get_unconfirmed_routing_counts(product_ids)

    items = []
    for order in draft_unconfirmed:
        deadline = order.get("deadline_date")
        buffer_days: int | None = (
            (date.fromisoformat(deadline) - today).days if deadline else None
        )
        pid: int | None = order.get("product_id")
        items.append(
            {
                "order_id": order["id"],
                "order_no": order.get("order_number"),
                "product_name": product_name_map.get(pid, "不明")
                if pid is not None
                else "不明",
                "buffer_days": buffer_days,
                "desired_deadline": deadline,
                "unconfirmed_routing_count": unconfirmed_counts.get(pid, 0)
                if pid is not None
                else 0,
            }
        )

    items.sort(key=lambda x: (x["buffer_days"] is None, x["buffer_days"] or 0))
    return {"count": len(items), "items": items}


# 承認履歴の閲覧・出力を許可するロール（iso_officer: 監査目的、president: 承認者本人としての確認）。
# order_handler は自身の操作ログであっても閲覧不可とし、監査ログとしての独立性を保つ。
_APPROVAL_LOG_VIEWER_ROLES = ("iso_officer", "president", "platform_admin")


def _fetch_enriched_approval_logs(
    tenant_id: str,
    user_id: str,
    client: Client,
    approval_log_repo: OrderApprovalLogRepository,
) -> list[dict[str, Any]]:
    _require_any_role(
        tenant_id, user_id, client, _APPROVAL_LOG_VIEWER_ROLES, "承認履歴の閲覧"
    )

    # 監査ログ本体・注文番号・操作者プロフィールのいずれも、閲覧者自身のユーザーJWT
    # クライアントで取得する（Service Role Keyは使わない）。orders / profiles は
    # 「同一テナントのメンバーなら閲覧可」というRLSを既に持つため、
    # _require_any_role でテナントメンバー かつ 閲覧許可ロールであることを検証済みの
    # このユーザーであれば、RLSをバイパスせずに参照できる。
    logs = approval_log_repo.get_all()
    if not logs:
        return []

    order_ids = list({log["order_id"] for log in logs})
    actor_ids = list({log["actor_user_id"] for log in logs})

    orders_res = (
        client.table("orders").select("id, order_number").in_("id", order_ids).execute()
    )
    order_number_map = {
        o["id"]: o["order_number"]
        for o in cast(list[dict[str, Any]], orders_res.data or [])
    }

    profiles_res = (
        client.table("profiles")
        .select("id, full_name, email")
        .in_("id", actor_ids)
        .execute()
    )
    profiles_map = {
        p["id"]: p for p in cast(list[dict[str, Any]], profiles_res.data or [])
    }

    enriched: list[dict[str, Any]] = []
    for log in logs:
        profile = profiles_map.get(log["actor_user_id"], {})
        enriched.append(
            {
                "id": log["id"],
                "order_id": log["order_id"],
                "order_number": order_number_map.get(log["order_id"]),
                "action": log["action"],
                "actor_user_id": log["actor_user_id"],
                "actor_full_name": profile.get("full_name"),
                "actor_email": profile.get("email"),
                "reason": log.get("reason"),
                "created_at": log["created_at"],
            }
        )
    return enriched


@orders_router.get("/approval-logs", response_model=list[OrderApprovalLogResponse])
def list_approval_logs(
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    approval_log_repo: OrderApprovalLogRepository = Depends(
        get_order_approval_log_repo
    ),
):
    """
    承認ワークフロー（承認依頼送信・承認・差し戻し・取り下げ）の監査ログを一覧取得する
    （iso_officer / president / platform_admin のみ閲覧可）。
    """
    return _fetch_enriched_approval_logs(tenant_id, user_id, client, approval_log_repo)


@orders_router.get("/approval-logs/export")
def export_approval_logs_csv(
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    approval_log_repo: OrderApprovalLogRepository = Depends(
        get_order_approval_log_repo
    ),
):
    """
    承認ワークフローの監査ログをCSV形式で出力する（iso_officer / president / platform_admin のみ）。
    """
    logs = _fetch_enriched_approval_logs(tenant_id, user_id, client, approval_log_repo)

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        ["注文番号", "操作", "操作者氏名", "操作者メール", "理由", "操作日時"]
    )
    action_labels = {
        "request_approval": "承認依頼送信",
        "approve": "承認",
        "reject": "差し戻し",
        "withdraw": "取り下げ",
    }
    for log in logs:
        writer.writerow(
            [
                log["order_number"] or f"#{log['order_id']}",
                action_labels.get(log["action"], log["action"]),
                log["actor_full_name"] or "",
                log["actor_email"] or "",
                log["reason"] or "",
                log["created_at"],
            ]
        )

    # Excelでの文字化けを避けるためBOMを付与する
    csv_content = "﻿" + buffer.getvalue()
    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="approval_logs.csv"'},
    )


@orders_router.get(
    "/email-intake-results", response_model=list[EmailIntakeResultResponse]
)
def list_email_intake_results(
    tenant_id: str = Depends(get_current_tenant_id),
    client: Client = Depends(get_supabase_client),
    admin_client: Client = Depends(get_supabase_admin_client),
):
    """
    受信した受注メール（order_attachments のステージング行, order_id IS NULL）ごとに、
    受信日時・顧客・parse_status・そのメールから新規起票された注文件数・
    スキップ/失敗理由（order_parse_log.reason）・元PDFの署名付きURL / Gmailリンクを
    一覧で返す（Issue #357）。

    「パースは成功したが起票0件」（全明細が重複スキップ等）のケースを、
    運用側がメーラーを開かずに追跡できるようにするのが主目的。
    parse_status / created_order_count / parse_log_reasons の組み合わせで判別する。

    ステージング行・顧客・注文・parse_log はいずれも「同一テナントのメンバーなら
    参照可」というRLSを持つため、閲覧者自身のユーザーJWTクライアントで取得する。
    admin_client は署名付きURL生成にのみ使う。
    """
    logger.info("Fetching email intake results")
    # source_raw（メール本文）など、レスポンス生成に不要で大きい列は取得しない
    staging_res = (
        client.table(SupabaseTableName.ORDER_ATTACHMENTS.value)
        .select(
            "id, customer_id, storage_path, original_filename, content_type, "
            "parse_status, gmail_message_id, created_at"
        )
        .is_("order_id", "null")
        .eq("tenant_id", tenant_id)
        .order("created_at", desc=True)
        .execute()
    )
    staging_rows = cast(list[dict[str, Any]], staging_res.data or [])
    if not staging_rows:
        return []

    staging_ids = [row["id"] for row in staging_rows]
    customer_ids = list(
        {row["customer_id"] for row in staging_rows if row.get("customer_id")}
    )

    customer_name_map: dict[int, str] = {}
    if customer_ids:
        cust_res = (
            client.table(SupabaseTableName.CUSTOMERS.value)
            .select("id, name")
            .in_("id", customer_ids)
            .execute()
        )
        customer_name_map = {
            c["id"]: c["name"] for c in cast(list[dict[str, Any]], cust_res.data or [])
        }

    orders_res = (
        client.table(SupabaseTableName.ORDERS.value)
        .select("id, source_attachment_id")
        .in_("source_attachment_id", staging_ids)
        .execute()
    )
    orders_by_attachment: dict[str, list[int]] = {}
    for order_row in cast(list[dict[str, Any]], orders_res.data or []):
        orders_by_attachment.setdefault(order_row["source_attachment_id"], []).append(
            order_row["id"]
        )

    log_res = (
        client.table(SupabaseTableName.ORDER_PARSE_LOG.value)
        .select("order_attachment_id, reason, created_at")
        .in_("order_attachment_id", staging_ids)
        .order("created_at")
        .execute()
    )
    reasons_by_attachment: dict[str, list[str]] = {}
    for log_row in cast(list[dict[str, Any]], log_res.data or []):
        reasons_by_attachment.setdefault(log_row["order_attachment_id"], []).append(
            log_row["reason"]
        )

    storage_paths = sorted(
        {row["storage_path"] for row in staging_rows if row.get("storage_path")}
    )
    signed_url_map: dict[str, str] = {}
    if storage_paths:
        try:
            signed_url_map = create_signed_urls(admin_client, storage_paths)
        except Exception:
            logger.warning(
                f"Failed to generate signed URLs for {len(storage_paths)} paths"
            )

    results: list[EmailIntakeResultResponse] = []
    for row in staging_rows:
        order_ids = sorted(orders_by_attachment.get(row["id"], []))
        storage_path = row.get("storage_path") or ""
        gmail_message_id = row.get("gmail_message_id")
        customer_id = cast("int | None", row.get("customer_id"))
        results.append(
            EmailIntakeResultResponse(
                id=str(row["id"]),
                received_at=str(row["created_at"]),
                customer_id=customer_id,
                customer_name=(
                    customer_name_map.get(customer_id)
                    if customer_id is not None
                    else None
                ),
                original_filename=row.get("original_filename") or None,
                has_attachment=bool(storage_path),
                content_type=row.get("content_type"),
                parse_status=row["parse_status"],
                gmail_message_id=gmail_message_id,
                gmail_url=(
                    f"https://mail.google.com/mail/u/0/#all/{gmail_message_id}"
                    if gmail_message_id
                    else None
                ),
                signed_url=(signed_url_map.get(storage_path) if storage_path else None),
                created_order_count=len(order_ids),
                created_order_ids=order_ids,
                parse_log_reasons=reasons_by_attachment.get(row["id"], []),
            )
        )
    return results


@orders_router.get("/{order_id}")
def get_order(order_id: int, repo: OrderRepository = Depends(get_order_repo)):
    """注文を1件取得（has_no_routings / has_unconfirmed_routings フラグ付き）"""
    logger.info(f"Fetching order {order_id}")
    result = repo.get_by_id_with_routing_status(order_id)
    if not result:
        raise HTTPException(status_code=404, detail="Not found")
    return _map_order_response(result)


@orders_router.get(
    "/{order_id}/attachments", response_model=list[OrderAttachmentResponse]
)
def get_order_attachments(
    order_id: int,
    client: Client = Depends(get_supabase_client),
    admin_client: Client = Depends(get_supabase_admin_client),
):
    """注文に紐づく添付ファイル一覧を署名付きURLと共に返す"""
    logger.info(f"Fetching attachments for order {order_id}")
    result = (
        client.table(SupabaseTableName.ORDER_ATTACHMENTS.value)
        .select("*")
        .eq("order_id", order_id)
        .order("created_at")
        .execute()
    )
    rows = cast(list[dict[str, Any]], result.data or [])
    attachments = []
    for row in rows:
        signed_url = ""
        if row.get("storage_path"):
            try:
                signed_url = create_signed_url(admin_client, row["storage_path"])
            except Exception:
                logger.warning(
                    f"Failed to generate signed URL for {row['storage_path']}"
                )
        attachments.append(
            OrderAttachmentResponse(
                id=str(row["id"]),
                order_id=row["order_id"],
                storage_path=row.get("storage_path", ""),
                original_filename=row.get("original_filename", ""),
                content_type=row.get("content_type"),
                size_bytes=row.get("size_bytes"),
                parse_status=row["parse_status"],
                signed_url=signed_url,
                created_at=str(row["created_at"]),
            )
        )
    return attachments


@orders_router.patch("/{order_id}")
def update_order(
    order_id: int,
    order_data: OrderUpdate,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    repo: OrderRepository = Depends(get_order_repo),
):
    """注文を更新

    customer_id 変更時の order_attachments.customer_id 同期（実添付行・
    メール/PDF起票のステージング行の双方）は、orders.customer_id の UPDATE と
    同一トランザクションで実行される DB トリガー
    (sync_order_attachments_customer_id, Issue #315) が担う。

    メール起票の下書きで product_id が修正された場合は、その対応を製品別名辞書
    （product_name_aliases）へ記録する（Issue #347）。あわせて、担当者が一度でも
    product_id に手を入れた注文は product_id_manually_corrected=true を立てて
    「手動修正済み」として恒久的にマークする（Issue #350。承認依頼時の
    自動マッチ反映フックが二重記録しないための判定に使う）。
    """
    logger.info(f"Updating order {order_id}")
    order_before = repo.get_by_id(order_id)

    update_dict = order_data.model_dump(exclude_unset=True)
    if (
        "product_id" in update_dict
        and order_before is not None
        and update_dict["product_id"] != order_before.get("product_id")
        and not order_before.get("product_id_manually_corrected")
    ):
        # 一度 true になったら false へは戻さない（Issue #350）
        update_dict["product_id_manually_corrected"] = True

    result = repo.update(order_id, update_dict)
    if not result:
        raise HTTPException(status_code=404, detail="Not found")

    record_correction_if_applicable(client, tenant_id, order_before, result, user_id)

    return _map_order_response(result)


@orders_router.delete("/{order_id}")
def delete_order(order_id: int, repo: OrderRepository = Depends(get_order_repo)):
    """注文を削除"""
    logger.info(f"Deleting order {order_id}")
    success = repo.delete(order_id)
    if not success:
        raise HTTPException(status_code=404, detail="Not found")
    return {"status": "deleted"}


@orders_router.post("/{order_id}/split")
def split_order(
    order_id: int,
    split_data: OrderSplitRequest,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    repo: OrderRepository = Depends(get_order_repo),
    client: Client = Depends(get_supabase_client),
):
    """
    誤って1件にマージされた下書き注文を、同じ source_attachment_id を参照する
    N件の下書き注文に手動分割する（Issue #280）。
    """
    logger.info(f"Splitting order {order_id} into {len(split_data.line_items)} items")
    order = repo.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.get("status") != "draft":
        raise HTTPException(status_code=400, detail="下書き状態の注文のみ分割できます")
    source_attachment_id = order.get("source_attachment_id")
    if not source_attachment_id:
        raise HTTPException(
            status_code=400,
            detail="分割元の受注ソース（メール／添付ファイル）が不明なため分割できません",
        )

    try:
        source_row = cast(
            "dict[str, Any] | None",
            client.table(SupabaseTableName.ORDER_ATTACHMENTS.value)
            .select("*")
            .eq("id", source_attachment_id)
            .single()
            .execute()
            .data,
        )
    except APIError as e:
        raise HTTPException(
            status_code=400,
            detail="分割元の受注ソース（メール／添付ファイル）が見つかりませんでした",
        ) from e
    if not source_row:
        raise HTTPException(
            status_code=400,
            detail="分割元の受注ソース（メール／添付ファイル）が見つかりませんでした",
        )

    # 分割後の明細が元の注文と同じ (customer_id, product_id, deadline_date) を
    # 指定した場合、元の注文自身と orders_dedupe_key が衝突してしまう。これを
    # 避けるため、元の注文は削除せず deadline_date を一時的にNULLへ退避する
    # （UNIQUE制約はNULL同士を等価とみなさないため衝突しなくなる）。全明細の
    # 作成に成功した時点で初めて元の注文を実際に削除し、失敗時は
    # deadline_date を元に戻すだけで良い（idや紐づく order_attachments は
    # 一切触れないため、削除→再作成のようなデータ消失が起きない）。
    original_deadline_date = order.get("deadline_date")
    repo.update(order_id, {"deadline_date": None})

    created_orders: list[dict] = []
    try:
        for item in split_data.line_items:
            new_order = repo.create(
                {
                    "tenant_id": tenant_id,
                    "product_id": item.product_id,
                    "quantity": item.quantity,
                    "deadline_date": item.deadline_date,
                    "customer_id": item.customer_id
                    if item.customer_id is not None
                    else order.get("customer_id"),
                    "customer_certainty": item.customer_certainty
                    or order.get("customer_certainty"),
                    "status": "draft",
                    "source_type": order.get("source_type"),
                    "source_raw": order.get("source_raw"),
                    "extracted_product_name": item.extracted_product_name,
                    "source_attachment_id": source_attachment_id,
                }
            )
            created_orders.append(new_order)

            record_correction_if_applicable(client, tenant_id, None, new_order, user_id)

            client.table(SupabaseTableName.ORDER_ATTACHMENTS.value).insert(
                {
                    "order_id": new_order["id"],
                    "tenant_id": tenant_id,
                    "storage_path": source_row.get("storage_path", ""),
                    "original_filename": source_row.get("original_filename", ""),
                    "content_type": source_row.get("content_type"),
                    "size_bytes": source_row.get("size_bytes"),
                    "parse_status": "success"
                    if source_row.get("storage_path")
                    else "failed_no_attachment",
                }
            ).execute()
    except (ValueError, APIError) as e:
        for created in created_orders:
            repo.delete(created["id"])
        # 元の注文のdeadline_dateを退避前の値に戻す（分割前の状態に復元）
        repo.update(order_id, {"deadline_date": original_deadline_date})
        detail = e.message if isinstance(e, APIError) else str(e)
        raise HTTPException(status_code=400, detail=detail) from None

    if not repo.delete(order_id):
        logger.error(
            f"split_order: created {len(created_orders)} orders but failed to "
            f"delete original order {order_id}"
        )
        raise HTTPException(
            status_code=500,
            detail="分割後の注文は作成されましたが、元の注文の削除に失敗しました。管理者に確認してください。",
        )

    return {
        "original_order_id": order_id,
        "created_orders": [_map_order_response(o) for o in created_orders],
    }


@orders_router.post("/email-intake")
async def create_email_order_intake(
    payload: str = Form(...),
    files: list[UploadFile] = File(default=[]),
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    admin_client: Client = Depends(get_supabase_admin_client),
    repo: OrderRepository = Depends(get_order_repo),
):
    """
    自動パースできない受注メールを、本文（source_raw）・添付ファイル付きで手動起票する
    （Issue #358）。1メール = 顧客・本文・添付を共有する N 明細（分納）としてまとめて
    起票し、各注文は `source_type='email'`・`status='draft'` で作成される。

    - 添付は Supabase Storage の `order-attachments` バケットへ保存し、作成した各注文に
      `order_attachments` 行として紐付ける（`order_id` 未確定の集約行を1件、各注文に
      紐づく実行を明細数×添付数だけ作成し、`source_attachment_id` で束ねる）
    - 集約行（`order_id IS NULL`）の `parse_status` は「処理状態」を表すため常に `success`
      とする（自動経路では gmail_service が `pending` で入れ parse 後に `success` へ更新
      する。手動起票は同期的に処理済みのため `success` に寄せ、
      `/orders/email-intake-results` の表示・処理済み判定と整合させる）
    - 添付なし・本文のみでも起票可。「添付なし」は集約行の `storage_path` 空、および
      各注文に紐づく `order_attachments` 行の `parse_status='failed_no_attachment'`
      （自動経路 `_process_line_item` と同じ規約）で表現する
    - RLS: `order_attachments` は `is_tenant_member(tenant_id)` 前提のためユーザーJWT
      クライアントで INSERT する。`admin_client` は Storage への保存にのみ使う
    """
    try:
        intake = ManualEmailIntakeRequest.model_validate_json(payload)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors()) from None

    logger.info(
        f"Manual email order intake: {len(intake.line_items)} line item(s), "
        f"{len(files)} file(s)"
    )

    # 1. 添付ファイルを Storage へ保存（1回の起票を group_id で束ねる）
    group_id = uuid.uuid4().hex
    uploaded: list[dict[str, Any]] = []
    for upload in files:
        content = await upload.read()
        if not content:
            continue
        content_type = upload.content_type or "application/octet-stream"
        storage_path = upload_manual_email_attachment(
            admin_client,
            tenant_id,
            group_id,
            upload.filename or "attachment",
            content,
            content_type,
        )
        uploaded.append(
            {
                "storage_path": storage_path,
                "original_filename": upload.filename or "attachment",
                "content_type": content_type,
                "size_bytes": len(content),
            }
        )

    attachments_table = SupabaseTableName.ORDER_ATTACHMENTS.value
    has_attachment = len(uploaded) > 0
    row_parse_status = "success" if has_attachment else "failed_no_attachment"

    # 2. 受信メールに相当する集約行（order_id IS NULL）を1件作成し、
    #    各注文の source_attachment_id をここに向ける（自動経路のステージング行と同じ扱い）。
    #    複数添付時は先頭ファイルを代表として記録する（自動経路も1メール1添付前提）。
    #    集約行の parse_status は「処理状態」を表すため、添付有無に関わらず success で入れる。
    representative = uploaded[0] if has_attachment else {}
    try:
        staging_res = (
            client.table(attachments_table)
            .insert(
                {
                    "tenant_id": tenant_id,
                    "customer_id": intake.customer_id,
                    "source_raw": intake.source_raw,
                    "storage_path": representative.get("storage_path", ""),
                    "original_filename": representative.get("original_filename", ""),
                    "content_type": representative.get("content_type"),
                    "size_bytes": representative.get("size_bytes"),
                    "parse_status": "success",
                }
            )
            .execute()
        )
    except APIError as e:
        raise HTTPException(status_code=400, detail=e.message) from None
    staging_rows = cast(list[dict[str, Any]], staging_res.data or [])
    if not staging_rows:
        raise HTTPException(
            status_code=500, detail="受信メール（集約行）の作成に失敗しました"
        )
    staging_id = staging_rows[0]["id"]

    # 3. 明細ごとに注文を作成し、添付行を紐付ける
    created_orders: list[dict[str, Any]] = []
    try:
        for index, item in enumerate(intake.line_items):
            new_order = repo.create(
                {
                    "tenant_id": tenant_id,
                    # order_number は UNIQUE(tenant_id, order_number) のため
                    # 先頭明細にのみ付与する（分納の2件目以降は採番なし）
                    "order_number": intake.order_number if index == 0 else None,
                    "product_id": item.product_id,
                    "quantity": item.quantity,
                    "deadline_date": item.deadline_date,
                    "customer_id": intake.customer_id,
                    "customer_certainty": intake.customer_certainty,
                    "status": "draft",
                    "source_type": "email",
                    "source_raw": intake.source_raw,
                    "extracted_product_name": item.extracted_product_name,
                    "source_attachment_id": staging_id,
                }
            )
            created_orders.append(new_order)

            record_correction_if_applicable(client, tenant_id, None, new_order, user_id)

            attachment_rows = (
                [
                    {
                        "order_id": new_order["id"],
                        "tenant_id": tenant_id,
                        "storage_path": f["storage_path"],
                        "original_filename": f["original_filename"],
                        "content_type": f["content_type"],
                        "size_bytes": f["size_bytes"],
                        "parse_status": row_parse_status,
                    }
                    for f in uploaded
                ]
                if has_attachment
                else [
                    {
                        "order_id": new_order["id"],
                        "tenant_id": tenant_id,
                        "storage_path": "",
                        "original_filename": "",
                        "content_type": None,
                        "size_bytes": None,
                        "parse_status": row_parse_status,
                    }
                ]
            )
            client.table(attachments_table).insert(attachment_rows).execute()
    except (ValueError, APIError) as e:
        for created in created_orders:
            repo.delete(created["id"])
        client.table(attachments_table).delete().eq("id", staging_id).execute()
        detail = e.message if isinstance(e, APIError) else str(e)
        raise HTTPException(status_code=400, detail=detail) from None

    return {
        "staging_attachment_id": str(staging_id),
        "created_orders": [_map_order_response(o) for o in created_orders],
    }


def get_settings_repo(
    client: Client = Depends(get_supabase_client),
) -> SchedulingSettingsRepository:
    return SchedulingSettingsRepository(client)


@orders_router.post("/simulate")
def simulate_schedule_without_id(
    order_data: OrderSimulateRequest,
    tenant_id: str = Depends(get_current_tenant_id),
    product_repo: ProductRepository = Depends(get_product_repo),
    equipment_repo: EquipmentRepository = Depends(get_equipment_repo),
    schedule_repo: ScheduleRepository = Depends(get_schedule_repo),
    settings_repo: SchedulingSettingsRepository = Depends(get_settings_repo),
):
    """
    スケジュールのシミュレーションを行う（DB保存なし）。
    新規注文作成時にorder_idなしで呼び出される。
    """
    logger.info(
        f"Simulating schedule with product_id={order_data.product_id}, quantity={order_data.quantity}"
    )

    try:
        result = schedule_order(
            order_id=None,
            product_id=order_data.product_id,
            quantity=order_data.quantity,
            product_repo=product_repo,
            schedule_repo=schedule_repo,
            tenant_id=tenant_id,
            dry_run=True,
            standalone=order_data.standalone,
            settings_repo=settings_repo,
        )
        return build_simulate_response(
            result, order_data.deadline_date, product_repo, equipment_repo
        )
    except RoutingUnconfirmedError as e:
        return {
            "routing_status": "no_routing" if e.no_routing else "unconfirmed",
            "calculated_deadline": None,
            "is_feasible": None,
            "process_schedules": [],
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None


@orders_router.post("/{order_id}/simulate")
def simulate_schedule(
    order_id: int,
    tenant_id: str = Depends(get_current_tenant_id),
    order_repo: OrderRepository = Depends(get_order_repo),
    product_repo: ProductRepository = Depends(get_product_repo),
    equipment_repo: EquipmentRepository = Depends(get_equipment_repo),
    schedule_repo: ScheduleRepository = Depends(get_schedule_repo),
    settings_repo: SchedulingSettingsRepository = Depends(get_settings_repo),
):
    """
    スケジュールのシミュレーションを行う（DB保存なし）。
    既存の注文をベースにシミュレーションを実行。
    """
    logger.info(f"Simulating schedule for order {order_id}")
    order = order_repo.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("product_id") is None:
        raise HTTPException(status_code=422, detail={"error": "product_unmatched"})

    try:
        result = schedule_order(
            order_id=order["id"],
            product_id=order["product_id"],
            quantity=order["quantity"],
            product_repo=product_repo,
            schedule_repo=schedule_repo,
            tenant_id=tenant_id,
            dry_run=True,
            settings_repo=settings_repo,
        )
        order_repo.mark_as_scheduled(order_id)
        return build_simulate_response(
            result, order.get("deadline_date"), product_repo, equipment_repo
        )
    except RoutingUnconfirmedError as e:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "no_routing" if e.no_routing else "routing_unconfirmed",
            },
        ) from None
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None


def _require_role(
    tenant_id: str, user_id: str, client: Client, allowed_role: str, action: str
) -> None:
    """指定ロールのみ実行可能な操作のロールチェック。許可されなければ403を送出する。"""
    role = get_current_user_role(tenant_id, user_id, client)
    if role != allowed_role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"{action}は {allowed_role} のみ操作できます",
        )


def _log_approval_action_safely(
    approval_log_repo: OrderApprovalLogRepository,
    tenant_id: str,
    order_id: int,
    action: str,
    user_id: str,
    reason: str | None = None,
) -> None:
    """
    承認監査ログの記録はベストエフォートとする。
    状態遷移（承認依頼送信・承認・差し戻し・取り下げ）自体は既にDB更新が成功しており、
    監査ログの記録に失敗したからといって業務上成功した操作をエラー扱いにはしない
    （特に `approve-bulk` では、1件のログ記録失敗が他の注文の確定結果を
    巻き込んで500にしてしまうことを防ぐ）。
    """
    try:
        approval_log_repo.log_action(tenant_id, order_id, action, user_id, reason)
    except Exception:
        logger.exception(
            f"Failed to record approval log: order_id={order_id}, action={action}"
        )


def _notify_approval_requested_safely(
    client: Client, tenant_id: str, order_id: int, order_no: str | None
) -> None:
    """
    承認依頼通知の書き込みはベストエフォートとする（Issue #327）。
    通知の記録に失敗しても、承認依頼送信自体（既にDB更新済み）はエラー扱いにしない。
    """
    try:
        create_notification(
            client,
            tenant_id,
            "approval_requested",
            "orders",
            str(order_id),
            detail={"order_no": order_no} if order_no else None,
        )
    except Exception:
        logger.exception(
            f"Failed to record approval_requested notification: order_id={order_id}"
        )


def _require_any_role(
    tenant_id: str,
    user_id: str,
    client: Client,
    allowed_roles: tuple[str, ...],
    action: str,
) -> None:
    """複数ロールのいずれかであれば実行可能な操作のロールチェック。許可されなければ403を送出する。"""
    role = get_current_user_role(tenant_id, user_id, client)
    if role not in allowed_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"{action}は {'/'.join(allowed_roles)} のみ操作できます",
        )


def _confirm_single_order(
    order_id: int,
    tenant_id: str,
    order_repo: OrderRepository,
    product_repo: ProductRepository,
    schedule_repo: ScheduleRepository,
    settings_repo: SchedulingSettingsRepository,
) -> dict:
    """
    スケジュールを確定・保存し、注文ステータスをconfirmedにする。
    ロールチェックは呼び出し側（単体/一括の各エンドポイント）で行う。
    """
    order = order_repo.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("product_id") is None:
        raise HTTPException(status_code=422, detail={"error": "product_unmatched"})

    try:
        validate_order_status_transition(order.get("status"), "confirmed")
    except InvalidOrderStatusTransitionError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None

    # 1. 実際に保存 (dry_run=False)
    result = schedule_order(
        order_id=order["id"],
        product_id=order["product_id"],
        quantity=order["quantity"],
        product_repo=product_repo,
        schedule_repo=schedule_repo,
        tenant_id=tenant_id,
        dry_run=False,
        settings_repo=settings_repo,
        desired_deadline=order.get("deadline_date"),
    )

    # 2. ステータス更新 & is_scheduled フラグ更新
    last_end = max(s["end_datetime"] for s in result)
    confirmed_deadline = datetime.fromisoformat(last_end).date().isoformat()
    order_repo.update(
        order_id,
        {
            "status": "confirmed",
            "is_scheduled": True,
            "confirmed_at": datetime.now(UTC).isoformat(),
            "confirmed_deadline": confirmed_deadline,
        },
    )

    return {"status": "confirmed", "schedules": result}


@orders_router.post("/{order_id}/request-approval")
def request_order_approval(
    order_id: int,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    order_repo: OrderRepository = Depends(get_order_repo),
    approval_log_repo: OrderApprovalLogRepository = Depends(
        get_order_approval_log_repo
    ),
):
    """
    下書き注文の承認依頼を送信し、注文ステータスをpending_approvalにする（order_handler限定）。

    メール起票かつ自動マッチのまま（担当者が product_id を未修正）の注文は、
    この時点で「担当者の目を通った」とみなし、その対応を製品別名辞書へ
    source='auto_match_unreviewed' として記録する（Issue #350）。
    """
    logger.info(f"Requesting approval for order {order_id}")
    _require_role(tenant_id, user_id, client, "order_handler", "承認依頼の送信")

    order = order_repo.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("product_id") is None:
        raise HTTPException(status_code=422, detail={"error": "product_unmatched"})

    try:
        validate_order_status_transition(order.get("status"), "pending_approval")
    except InvalidOrderStatusTransitionError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None

    result = order_repo.update(
        order_id, {"status": "pending_approval", "rejection_reason": None}
    )
    _log_approval_action_safely(
        approval_log_repo, tenant_id, order_id, "request_approval", user_id
    )
    _notify_approval_requested_safely(
        client, tenant_id, order_id, order.get("order_number")
    )
    record_auto_match_alias_if_applicable(client, tenant_id, order, user_id)
    return _map_order_response(result)


@orders_router.post("/{order_id}/confirm")
def confirm_order(
    order_id: int,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    order_repo: OrderRepository = Depends(get_order_repo),
    product_repo: ProductRepository = Depends(get_product_repo),
    schedule_repo: ScheduleRepository = Depends(get_schedule_repo),
    settings_repo: SchedulingSettingsRepository = Depends(get_settings_repo),
    approval_log_repo: OrderApprovalLogRepository = Depends(
        get_order_approval_log_repo
    ),
):
    """
    受注を承認する。スケジュールを確定・保存し、注文ステータスをconfirmedにする（president限定）。
    """
    logger.info(f"Confirming order {order_id}")
    _require_role(tenant_id, user_id, client, "president", "受注の承認（確定）")

    try:
        result = _confirm_single_order(
            order_id, tenant_id, order_repo, product_repo, schedule_repo, settings_repo
        )
        _log_approval_action_safely(
            approval_log_repo, tenant_id, order_id, "approve", user_id
        )
        return result
    except RoutingUnconfirmedError as e:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "routing_unconfirmed",
                "desired_deadline": e.desired_deadline,
            },
        ) from None
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None


@orders_router.post("/approve-bulk")
def approve_orders_bulk(
    bulk_data: OrderBulkApproveRequest,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    order_repo: OrderRepository = Depends(get_order_repo),
    product_repo: ProductRepository = Depends(get_product_repo),
    schedule_repo: ScheduleRepository = Depends(get_schedule_repo),
    settings_repo: SchedulingSettingsRepository = Depends(get_settings_repo),
    approval_log_repo: OrderApprovalLogRepository = Depends(
        get_order_approval_log_repo
    ),
):
    """
    複数の承認待ち注文をまとめて承認する（president限定）。1件ごとの成否を返す。
    """
    logger.info(f"Bulk approving orders {bulk_data.order_ids}")
    _require_role(tenant_id, user_id, client, "president", "受注の承認（確定）")

    results: list[dict[str, Any]] = []
    for order_id in bulk_data.order_ids:
        try:
            confirm_result = _confirm_single_order(
                order_id,
                tenant_id,
                order_repo,
                product_repo,
                schedule_repo,
                settings_repo,
            )
            _log_approval_action_safely(
                approval_log_repo, tenant_id, order_id, "approve", user_id
            )
            results.append(
                {
                    "order_id": order_id,
                    "status": "confirmed",
                    "schedules": confirm_result["schedules"],
                }
            )
        except HTTPException as e:
            results.append(
                {"order_id": order_id, "status": "error", "detail": e.detail}
            )
        except RoutingUnconfirmedError as e:
            results.append(
                {
                    "order_id": order_id,
                    "status": "error",
                    "detail": {
                        "error": "routing_unconfirmed",
                        "desired_deadline": e.desired_deadline,
                    },
                }
            )
        except ValueError as e:
            results.append({"order_id": order_id, "status": "error", "detail": str(e)})

    return {"results": results}


@orders_router.post("/{order_id}/reject")
def reject_order(
    order_id: int,
    reject_data: OrderRejectRequest,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    order_repo: OrderRepository = Depends(get_order_repo),
    approval_log_repo: OrderApprovalLogRepository = Depends(
        get_order_approval_log_repo
    ),
):
    """
    承認待ちの注文を差し戻す（president限定）。理由は任意入力。
    """
    logger.info(f"Rejecting order {order_id}")
    _require_role(tenant_id, user_id, client, "president", "受注の差し戻し")

    order = order_repo.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    try:
        validate_order_status_transition(order.get("status"), "draft")
    except InvalidOrderStatusTransitionError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None

    result = order_repo.update(
        order_id, {"status": "draft", "rejection_reason": reject_data.reason}
    )
    _log_approval_action_safely(
        approval_log_repo, tenant_id, order_id, "reject", user_id, reject_data.reason
    )
    return _map_order_response(result)


@orders_router.post("/{order_id}/withdraw-approval")
def withdraw_order_approval(
    order_id: int,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    order_repo: OrderRepository = Depends(get_order_repo),
    approval_log_repo: OrderApprovalLogRepository = Depends(
        get_order_approval_log_repo
    ),
):
    """
    誤って送信した承認依頼を取り下げ、下書きに差し戻す（order_handler限定）。

    president による差し戻し（`reject`）とは異なり理由は付かない。
    「差し戻し」を業務上の判断（president による reject）と、送信主自身による単純な取り消しとで
    区別できるよう、監査ログには別action（`withdraw`）として記録する。
    """
    logger.info(f"Withdrawing approval request for order {order_id}")
    _require_role(tenant_id, user_id, client, "order_handler", "承認依頼の取り下げ")

    order = order_repo.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    try:
        validate_order_status_transition(order.get("status"), "draft")
    except InvalidOrderStatusTransitionError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None

    result = order_repo.update(order_id, {"status": "draft"})
    _log_approval_action_safely(
        approval_log_repo, tenant_id, order_id, "withdraw", user_id
    )
    return _map_order_response(result)


@orders_router.post("/{order_id}/ship")
def ship_order(
    order_id: int,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    order_repo: OrderRepository = Depends(get_order_repo),
):
    """
    確定済の注文を送品済み (shipped) にする（president / order_handler）。

    confirmed からのみ遷移でき、shipped は実質的な終端状態。
    """
    logger.info(f"Marking order {order_id} as shipped")
    _require_any_role(
        tenant_id,
        user_id,
        client,
        ("president", "order_handler"),
        "送品済みへの変更",
    )

    order = order_repo.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    try:
        validate_order_status_transition(order.get("status"), "shipped")
    except InvalidOrderStatusTransitionError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None

    result = order_repo.update(order_id, {"status": "shipped"})
    return _map_order_response(result)


@orders_router.post("/ship-overdue-drafts", response_model=ShipOverdueDraftsResponse)
def ship_overdue_drafts(
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    order_repo: OrderRepository = Depends(get_order_repo),
):
    """
    納期を過ぎたまま残っている下書き (draft) 受注をまとめて送品済み (shipped) にする
    （president / platform_admin 限定、Issue #367）。

    トライアル運用中に溜まった「納期超過の下書き」を後片付けするための管理者操作。
    通常の draft -> shipped は許可されておらず（承認フローを通す）、このエンドポイント
    だけが例外的にその遷移を行う。対象は「status == 'draft' かつ 納期設定済み かつ
    納期 < 今日」に限定する。対象が0件でも 200 を返す。
    """
    logger.info("Shipping overdue draft orders")
    _require_any_role(
        tenant_id,
        user_id,
        client,
        ("president", "platform_admin"),
        "納期超過下書きの送品済み化",
    )

    today = date.today()
    target_ids = [
        order["id"]
        for order in order_repo.get_all()
        if is_overdue_draft(order.get("status"), order.get("deadline_date"), today)
    ]

    for order_id in target_ids:
        order_repo.update(order_id, {"status": "shipped"})

    logger.info(f"Shipped {len(target_ids)} overdue draft orders: {target_ids}")
    return {"shipped_count": len(target_ids), "order_ids": target_ids}
