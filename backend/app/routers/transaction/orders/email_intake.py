# routers/transaction/orders/email_intake.py
"""メール起票結果一覧・手動起票・注文分割（Issue #357 / #358 / #280、Issue #376）。"""

import uuid
from typing import Any, cast

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from postgrest.exceptions import APIError
from pydantic import ValidationError

from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_order_repo,
    get_supabase_admin_client,
    get_supabase_client,
)
from app.models.transaction.order_schema import (
    EmailIntakeOutcome,
    EmailIntakeResultResponse,
    ManualEmailIntakeRequest,
    OrderSplitRequest,
)
from app.repositories.supa_infra.common import DuplicateRecordError
from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.repositories.supa_infra.transaction.order_repo import OrderRepository
from app.services.attachment_service import (
    create_signed_urls,
    upload_manual_email_attachment,
)
from app.services.product_alias_service import record_correction_if_applicable
from app.utils.logger import get_logger
from supabase import Client

from ._shared import _duplicate_order_conflict_exception, _map_order_response

router = APIRouter()

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# 受信受注メールの処理結果の観点を「起票 / スキップ / 失敗」の3値に固定する（Issue #422）
# ---------------------------------------------------------------------------
# order_parse_log.reason は CHECK 制約のない自由文字列。分類は完全にアプリ側の責務。

# 抽出・処理が完了できなかった（起票に至らない）ことを示す理由
_EMAIL_INTAKE_FAIL_REASONS = frozenset(
    {"failed_encrypted", "failed_image", "failed_no_attachment"}
)
# 起票はされたが運用者の確認が必要なことを示す理由
_EMAIL_INTAKE_ATTENTION_REASONS = frozenset(
    {"no_product_match", "multi_order_suspected", "invalid_quantity"}
)
# 正常に処理された上で意図的に起票しなかったことを示す理由
_EMAIL_INTAKE_SKIP_REASONS = frozenset(
    {
        "non_order_email",
        "draft_conflict_skipped",
        "downgrade_skipped",
        "no_order_created",
    }
)
_EMAIL_INTAKE_KNOWN_REASONS = (
    _EMAIL_INTAKE_FAIL_REASONS
    | _EMAIL_INTAKE_ATTENTION_REASONS
    | _EMAIL_INTAKE_SKIP_REASONS
)


def _derive_email_intake_outcome(
    parse_status: str, created_order_count: int, parse_log_reasons: list[str]
) -> tuple[EmailIntakeOutcome, bool, bool]:
    """受信受注メール1件の処理結果を (outcome, needs_attention, empty_draft) に導出する。

    - outcome: "created" / "skipped" / "failed"（Issue #422）
    - needs_attention: outcome="created" かつ要確認理由を含む
    - empty_draft: 読み取り不能PDF等で中身が空の下書きだけが起票された（outcome="failed"）

    PR-1 では pending は経過時間を問わず failed とする。パースキュー待ちの行が一時的に
    failed 表示になり得るが、次サイクルで created/skipped に遷移する。猶予時間や
    「処理待ち」の第4状態への切り出しは PR-3 の検討事項（Issue #422）。
    """
    reason_set = set(parse_log_reasons)
    has_fail_reason = bool(reason_set & _EMAIL_INTAKE_FAIL_REASONS)

    if parse_status == "pending" or has_fail_reason:
        # 読み取り不能PDFは product_id/quantity/deadline すべて NULL の空下書きを
        # 1件起票する（_process_unreadable_pdf）。中身が空なので failed に寄せ、
        # 起票済みの下書きへ導線を残すため empty_draft フラグで示す。
        return "failed", False, has_fail_reason and created_order_count > 0

    if created_order_count == 0 and "invalid_quantity" in reason_set:
        return "failed", False, False

    if created_order_count >= 1:
        needs_attention = bool(reason_set & _EMAIL_INTAKE_ATTENTION_REASONS)
        return "created", needs_attention, False

    # 正常に処理され、意図的に起票しなかった(重複・対象外、または理由ログなしの起票0件)
    return "skipped", False, False


@router.get("/email-intake-results", response_model=list[EmailIntakeResultResponse])
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
        reasons = reasons_by_attachment.get(row["id"], [])
        unknown_reasons = set(reasons) - _EMAIL_INTAKE_KNOWN_REASONS
        if unknown_reasons:
            # 分類外の理由は skipped 扱いにフォールバックする（_derive_email_intake_outcome）。
            # 新しい reason を追加したら分類集合にも登録すること。
            logger.warning(
                "Unclassified order_parse_log reason(s) for attachment %s: %s",
                row["id"],
                sorted(unknown_reasons),
            )
        outcome, needs_attention, empty_draft = _derive_email_intake_outcome(
            row["parse_status"], len(order_ids), reasons
        )
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
                parse_log_reasons=reasons,
                outcome=outcome,
                needs_attention=needs_attention,
                empty_draft=empty_draft,
            )
        )
    return results


def _rollback_split_creations(
    repo: OrderRepository,
    created_orders: list[dict],
    order_id: int,
    original_deadline_date: str | None,
) -> None:
    """split_order の失敗時に、作成済みの明細を削除し元の注文の deadline_date を復元する。"""
    for created in created_orders:
        repo.delete(created["id"])
    repo.update(order_id, {"deadline_date": original_deadline_date})


@router.post("/{order_id}/split")
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
    except DuplicateRecordError as e:
        _rollback_split_creations(
            repo, created_orders, order_id, original_deadline_date
        )
        # `item` は例外を送出したループ回の明細（Python のループ変数はループ後も残る）
        raise _duplicate_order_conflict_exception(
            e,
            client=client,
            order_repo=repo,
            tenant_id=tenant_id,
            customer_id=item.customer_id
            if item.customer_id is not None
            else order.get("customer_id"),
            product_id=item.product_id,
            deadline_date=item.deadline_date,
            extracted_product_name=item.extracted_product_name,
            exclude_order_id=order_id,
        ) from None
    except (ValueError, APIError) as e:
        _rollback_split_creations(
            repo, created_orders, order_id, original_deadline_date
        )
        # Supabase の APIError には制約名等の内部情報が含まれ得るため、レスポンスは
        # 固定文言にし詳細はログにのみ残す（cron エラー規約と同方針。Issue #415 PR2）。
        logger.error(
            f"split_order failed: order_id={order_id} error={e}", exc_info=True
        )
        raise HTTPException(
            status_code=400, detail="注文の分割に失敗しました"
        ) from None

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


def _rollback_email_intake_creations(
    repo: OrderRepository,
    client: Client,
    created_orders: list[dict[str, Any]],
    staging_id: Any,
) -> None:
    """create_email_order_intake の失敗時に、作成済みの注文と集約行を削除する。"""
    for created in created_orders:
        repo.delete(created["id"])
    client.table(SupabaseTableName.ORDER_ATTACHMENTS.value).delete().eq(
        "id", staging_id
    ).execute()


@router.post("/email-intake")
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
        # APIError.message には内部情報が含まれ得るため固定文言にする（Issue #415 PR2）
        logger.error(f"email-intake staging insert failed: error={e}", exc_info=True)
        raise HTTPException(
            status_code=400, detail="受信メール（集約行）の作成に失敗しました"
        ) from None
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
                    "customer_order_no": item.customer_order_no,
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
    except DuplicateRecordError as e:
        _rollback_email_intake_creations(repo, client, created_orders, staging_id)
        # `index` / `item` は例外を送出したループ回の明細（Python のループ変数は
        # ループ後も残る）。どの明細が重複したかをフロントで示せるよう index を返す。
        raise _duplicate_order_conflict_exception(
            e,
            client=client,
            order_repo=repo,
            tenant_id=tenant_id,
            customer_id=intake.customer_id,
            product_id=item.product_id,
            deadline_date=item.deadline_date,
            extracted_product_name=item.extracted_product_name,
            extra_detail={"line_item_index": index},
        ) from None
    except (ValueError, APIError) as e:
        _rollback_email_intake_creations(repo, client, created_orders, staging_id)
        # Supabase の APIError には制約名等の内部情報が含まれ得るため、レスポンスは
        # 固定文言にし詳細はログにのみ残す（cron エラー規約と同方針。Issue #415 PR2）。
        logger.error(f"create_email_order_intake failed: error={e}", exc_info=True)
        raise HTTPException(
            status_code=400, detail="受注メールの起票に失敗しました"
        ) from None

    return {
        "staging_attachment_id": str(staging_id),
        "created_orders": [_map_order_response(o) for o in created_orders],
    }
