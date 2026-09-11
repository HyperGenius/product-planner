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
    get_order_scheduling_start_backdate_log_repo,
    get_product_repo,
    get_schedule_repo,
    get_supabase_admin_client,
    get_supabase_client,
)
from app.models.transaction.order_schema import (
    EmailIntakeOutcome,
    EmailIntakeResultResponse,
    ManualEmailIntakeRequest,
    OrderApprovalLogResponse,
    OrderAttachmentResponse,
    OrderBulkApproveRequest,
    OrderCreate,
    OrderRejectRequest,
    OrderSimulateByIdRequest,
    OrderSimulateRequest,
    OrderSplitRequest,
    OrderUpdate,
    ShipOverdueDraftsResponse,
)
from app.repositories.supa_infra.common import DuplicateRecordError
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
from app.repositories.supa_infra.transaction.order_scheduling_start_backdate_log_repo import (
    OrderSchedulingStartBackdateLogRepository,
)
from app.repositories.supa_infra.transaction.schedule_repo import ScheduleRepository
from app.scheduler_logic import (
    InvalidRoutingDurationError,
    RoutingUnconfirmedError,
    schedule_order,
)
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
from app.services.scheduling_start_service import (
    PastSchedulingStartDateError,
    is_backdated,
    to_scheduling_start_time,
    validate_scheduling_start_date,
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

    order_date（受注起票日）は後方互換のため created_at にも複製しつつ、
    作業開始日（scheduling_start_date）と区別できるよう order_date 自体も残す（Issue #372）。
    scheduling_start_date は dict(order) でそのまま透過する。
    """
    mapped = dict(order)
    if "order_number" in mapped:
        mapped["order_no"] = mapped.pop("order_number")
    if "deadline_date" in mapped:
        mapped["desired_deadline"] = mapped.pop("deadline_date")
    if "order_date" in mapped:
        mapped["created_at"] = mapped["order_date"]
    return mapped


def _map_conflicting_order(conflict: dict[str, Any], client: Client) -> dict[str, Any]:
    """衝突した既存注文の識別情報を組み立てる（Issue #415 PR2）。

    重複通知モーダルの表示用に、生の DB 制約名・例外文言を含まない識別情報のみを
    返す。customer_id / product_id は master テーブルから名前解決する
    （RLS 下のユーザー JWT クライアントで参照するため、閲覧権限のない行は取れない）。
    """
    customer_name = None
    customer_id = conflict.get("customer_id")
    if customer_id is not None:
        res = (
            client.table("customers")
            .select("name")
            .eq("id", customer_id)
            .maybe_single()
            .execute()
        )
        if res and res.data:
            customer_name = cast(dict[str, Any], res.data).get("name")

    product_name = conflict.get("extracted_product_name")
    product_id = conflict.get("product_id")
    if product_id is not None:
        res = (
            client.table("products")
            .select("name")
            .eq("id", product_id)
            .maybe_single()
            .execute()
        )
        if res and res.data:
            product_name = cast(dict[str, Any], res.data).get("name")

    return {
        "id": conflict.get("id"),
        "order_no": conflict.get("order_number"),
        "customer_name": customer_name,
        "product_name": product_name,
        "quantity": conflict.get("quantity"),
        "deadline_date": conflict.get("deadline_date"),
        "status": conflict.get("status"),
    }


def _duplicate_order_conflict_exception(
    e: DuplicateRecordError,
    *,
    client: Client,
    order_repo: OrderRepository,
    tenant_id: str,
    customer_id: int | None,
    product_id: int | None,
    deadline_date: str | None,
    extracted_product_name: str | None,
    exclude_order_id: int | None = None,
    extra_detail: dict[str, Any] | None = None,
) -> HTTPException:
    """DuplicateRecordError を 409 Conflict の構造化 detail へ変換する（Issue #415 PR2）。

    orders には UNIQUE が2本あり、どちらの列を変更しても衝突しうるため、制約名
    （`e.constraint`）で振り分ける:
      - `orders_tenant_id_order_number_idx`: (tenant_id, order_number)
      - `orders_dedupe_key` / `orders_dedupe_key_unmatched_product`:
        (tenant_id, customer_id, product_id, deadline_date) または
        product_id IS NULL 時は extracted_product_name 込みのキー
    dedupe 側は衝突先レコードを SELECT し直し、識別情報を `conflicting_order` として
    付与する（取得できなければ固定文言のみ返す）。4経路（create/update/split/
    email-intake）共通で使う。生の DB 制約名・例外文言はレスポンスに含めない。
    """
    if "order_number" in (e.constraint or ""):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "duplicate_order_number",
                "message": "この注文番号はすでに使用されています",
            },
        )

    detail: dict[str, Any] = {
        "error": "duplicate_order",
        "message": "同じ 顧客 × 製品 × 納期 の注文がすでに存在します",
    }
    conflict = order_repo.find_dedupe_conflict(
        tenant_id,
        customer_id,
        product_id,
        deadline_date,
        extracted_product_name,
        exclude_order_id=exclude_order_id,
    )
    if conflict is not None:
        detail["conflicting_order"] = _map_conflicting_order(conflict, client)
    if extra_detail:
        detail.update(extra_detail)
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _attach_approval_requester_names(client: Client, orders: list[dict]) -> None:
    """承認依頼者（approval_requested_by）の表示名を各注文へ付与する（Issue #402）。

    承認待ちキューカードが「依頼者」列を出すための補完。`approval_requested_by`
    （非正規化した auth.users.id）から profiles を1クエリで引き、`full_name`
    → なければ `email` を `approval_requested_by_name` として詰める。依頼者が
    いない（＝pending_approval 以外の）注文には None を入れる。profiles は
    「同一テナントのメンバーなら参照可」の RLS を持つため、閲覧者自身の
    ユーザー JWT クライアントで取得する。
    """
    requester_ids = list(
        {o["approval_requested_by"] for o in orders if o.get("approval_requested_by")}
    )
    name_map: dict[str, str | None] = {}
    if requester_ids:
        res = (
            client.table("profiles")
            .select("id, full_name, email")
            .in_("id", requester_ids)
            .execute()
        )
        name_map = {
            p["id"]: (p.get("full_name") or p.get("email"))
            for p in cast(list[dict[str, Any]], res.data or [])
        }
    for order in orders:
        rid = order.get("approval_requested_by")
        order["approval_requested_by_name"] = name_map.get(rid) if rid else None


def _deadline_from_schedules(schedules: list[dict]) -> str:
    """スケジュール（工程セグメント）群の最終終了日時から完成見込み日を算出する。

    承認確定の confirmed_deadline とシミュレーションの simulated_deadline で
    同一ロジックを共有するための共通ヘルパー（Issue #394-A）。
    end_datetime はタイムゾーン表記（`Z` / `+09:00` 等）が混在しても実時刻で
    比較できるよう datetime にパースしてから最大値を取る。
    戻り値は YYYY-MM-DD 形式の文字列。
    """
    last_end = max(
        datetime.fromisoformat(s["end_datetime"].replace("Z", "+00:00"))
        for s in schedules
    )
    return last_end.date().isoformat()


# product_id / 数量 / 希望納期 / 作業開始日 のいずれかが変わると、実行済みの
# シミュレーション結果（simulated_deadline）と is_scheduled は陳腐化するため、
# PATCH /orders/{id} でこれらが変化したら両方を無効化する（Issue #394-A / #392 統合）。
# キー名は OrderUpdate のフィールド名（エイリアスではない）に合わせる。
_SIM_INVALIDATING_ORDER_FIELDS = (
    "product_id",
    "quantity",
    "deadline_date",
    "scheduling_start_date",
)


def _assert_scheduling_start_date_allowed(
    raw: str | None, tenant_id: str, user_id: str, client: Client
) -> bool:
    """作業開始日の形式・過去日権限を検証し、過去日だったかどうかを返す（Issue #372）。

    過去日 かつ 非権限ロールなら 403、形式不正なら 422 を送出する（Issue #374）。
    未来日・当日・未指定の場合はロール問い合わせを行わず False を返す
    （過去日でなければ権限チェック不要のため、無駄な organization_members 参照を避ける）。
    """
    if not raw:
        return False
    try:
        backdated = is_backdated(raw)
    except ValueError as e:
        logger.warning("invalid scheduling_start_date value=%r: %s", raw, e)
        raise HTTPException(
            status_code=422, detail={"error": "invalid_scheduling_start_date"}
        ) from None
    if not backdated:
        return False
    role = get_current_user_role(tenant_id, user_id, client)
    try:
        validate_scheduling_start_date(raw, role)
    except PastSchedulingStartDateError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=str(e)
        ) from None
    return True


def _log_scheduling_start_backdate_safely(
    repo: OrderSchedulingStartBackdateLogRepository,
    tenant_id: str,
    order_id: int,
    scheduling_start_date: str,
    actor_user_id: str,
    context: str,
) -> None:
    """過去日の作業開始日設定の監査記録はベストエフォートとする（Issue #372）。

    受注の作成／更新自体は既に成功しているため、監査ログの記録失敗で
    業務操作をエラー扱いにはしない。
    """
    try:
        repo.log_backdate(
            tenant_id, order_id, scheduling_start_date, actor_user_id, context
        )
    except Exception:
        logger.exception(
            f"Failed to record scheduling_start backdate log: order_id={order_id}"
        )


@orders_router.post("")
def create_order(
    order_data: OrderCreate,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    repo: OrderRepository = Depends(get_order_repo),
    backdate_log_repo: OrderSchedulingStartBackdateLogRepository = Depends(
        get_order_scheduling_start_backdate_log_repo
    ),
):
    """注文を新規作成"""
    logger.info(f"Creating order {order_data}")
    backdated = _assert_scheduling_start_date_allowed(
        order_data.scheduling_start_date, tenant_id, user_id, client
    )
    try:
        result = repo.create(order_data.with_tenant_id(tenant_id))
    except DuplicateRecordError as e:
        raise _duplicate_order_conflict_exception(
            e,
            client=client,
            order_repo=repo,
            tenant_id=tenant_id,
            customer_id=order_data.customer_id,
            product_id=order_data.product_id,
            deadline_date=order_data.deadline_date,
            extracted_product_name=order_data.extracted_product_name,
        ) from None
    if backdated and order_data.scheduling_start_date:
        _log_scheduling_start_backdate_safely(
            backdate_log_repo,
            tenant_id,
            result["id"],
            order_data.scheduling_start_date,
            user_id,
            "create",
        )
    return _map_order_response(result)


@orders_router.get("")
def get_orders(
    repo: OrderRepository = Depends(get_order_repo),
    client: Client = Depends(get_supabase_client),
):
    """注文を全件取得（has_no_routings / has_unconfirmed_routings フラグ付き）

    承認待ち（pending_approval）注文には承認依頼者名（approval_requested_by_name）と
    依頼日時（approval_requested_at）を付与する。承認待ちキューカード（Issue #402）が
    「誰から・いつ」承認を頼まれたかを一覧表示するために使う。
    """
    logger.info("Fetching all orders")
    results = repo.get_all_with_routing_status()
    mapped = [_map_order_response(order) for order in results]
    _attach_approval_requester_names(client, mapped)
    return mapped


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

    # 正常に処理され、意図的に起票しなかった（重複・対象外、または理由ログなしの起票0件）
    return "skipped", False, False


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
    backdate_log_repo: OrderSchedulingStartBackdateLogRepository = Depends(
        get_order_scheduling_start_backdate_log_repo
    ),
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
    backdated = _assert_scheduling_start_date_allowed(
        order_data.scheduling_start_date, tenant_id, user_id, client
    )
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

    # スケジュール条件（製品・数量・希望納期・作業開始日）が実質変化したら、
    # 実行済みのシミュレーション結果を無効化する（Issue #394-A / #392 統合）。
    # 既に無効な項目は書き込まず、余計な UPDATE を避ける。
    if order_before is not None and any(
        field in update_dict and update_dict[field] != order_before.get(field)
        for field in _SIM_INVALIDATING_ORDER_FIELDS
    ):
        if order_before.get("simulated_deadline") is not None:
            update_dict["simulated_deadline"] = None
        if order_before.get("is_scheduled"):
            update_dict["is_scheduled"] = False

    try:
        result = repo.update(order_id, update_dict)
    except DuplicateRecordError as e:
        # orders には UNIQUE が2本ある。編集ダイアログはどちらの列も変更できるため、
        # 制約名で振り分ける（`_duplicate_order_conflict_exception` の判定ロジック参照）。
        # 衝突判定には「変更後の値」を使う必要があるため、update_dict にない項目は
        # order_before の値で補う。
        before = order_before or {}
        raise _duplicate_order_conflict_exception(
            e,
            client=client,
            order_repo=repo,
            tenant_id=tenant_id,
            customer_id=update_dict.get("customer_id", before.get("customer_id")),
            product_id=update_dict.get("product_id", before.get("product_id")),
            deadline_date=update_dict.get("deadline_date", before.get("deadline_date")),
            extracted_product_name=before.get("extracted_product_name"),
            exclude_order_id=order_id,
        ) from None
    if not result:
        raise HTTPException(status_code=404, detail="Not found")

    if backdated and order_data.scheduling_start_date:
        _log_scheduling_start_backdate_safely(
            backdate_log_repo,
            tenant_id,
            order_id,
            order_data.scheduling_start_date,
            user_id,
            "update",
        )

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
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    product_repo: ProductRepository = Depends(get_product_repo),
    equipment_repo: EquipmentRepository = Depends(get_equipment_repo),
    schedule_repo: ScheduleRepository = Depends(get_schedule_repo),
    settings_repo: SchedulingSettingsRepository = Depends(get_settings_repo),
):
    """
    スケジュールのシミュレーションを行う（DB保存なし）。
    新規注文作成時にorder_idなしで呼び出される。

    scheduling_start_date が指定されていればその日の稼働開始時刻を起点にする（Issue #372）。
    過去日は president / platform_admin のみ許可。
    """
    logger.info(
        f"Simulating schedule with product_id={order_data.product_id}, "
        f"quantity={order_data.quantity}, "
        f"scheduling_start_date={order_data.scheduling_start_date}"
    )

    _assert_scheduling_start_date_allowed(
        order_data.scheduling_start_date, tenant_id, user_id, client
    )
    try:
        start_time = to_scheduling_start_time(order_data.scheduling_start_date)
    except ValueError as e:
        logger.warning(
            "simulate: invalid scheduling_start_date value=%r: %s",
            order_data.scheduling_start_date,
            e,
        )
        raise HTTPException(
            status_code=422, detail={"error": "invalid_scheduling_start_date"}
        ) from None

    try:
        result = schedule_order(
            order_id=None,
            product_id=order_data.product_id,
            quantity=order_data.quantity,
            product_repo=product_repo,
            schedule_repo=schedule_repo,
            tenant_id=tenant_id,
            start_time=start_time,
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
    except InvalidRoutingDurationError as e:
        # 工程の合計所要時間が負（データ不正）。ユーザーが修正すれば解消するため 422。
        # 所要時間 0 の工程はマイルストーン工程として正常処理される（Issue #378）。
        logger.warning(
            "simulate: invalid routing duration product_id=%s routing_id=%s",
            order_data.product_id,
            e.routing_id,
        )
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_routing_duration", "routing_id": e.routing_id},
        ) from None
    except ValueError:
        # スケジューラ内部の想定外状態（開始時刻を算出できない・スケジュールが空 等）。
        # クライアント起因ではないため 500 とし、原因を traceback 付きでログに残す。
        logger.exception(
            "simulate failed: product_id=%s quantity=%s scheduling_start_date=%r",
            order_data.product_id,
            order_data.quantity,
            order_data.scheduling_start_date,
        )
        raise HTTPException(
            status_code=500, detail="シミュレーションの計算に失敗しました"
        ) from None


@orders_router.post("/{order_id}/simulate")
def simulate_schedule(
    order_id: int,
    body: OrderSimulateByIdRequest | None = None,
    tenant_id: str = Depends(get_current_tenant_id),
    user_id: str = Depends(get_current_user_id),
    client: Client = Depends(get_supabase_client),
    order_repo: OrderRepository = Depends(get_order_repo),
    product_repo: ProductRepository = Depends(get_product_repo),
    equipment_repo: EquipmentRepository = Depends(get_equipment_repo),
    schedule_repo: ScheduleRepository = Depends(get_schedule_repo),
    settings_repo: SchedulingSettingsRepository = Depends(get_settings_repo),
):
    """
    スケジュールのシミュレーションを行う（DB保存なし）。
    既存の注文をベースにシミュレーションを実行。

    作業開始日は、リクエストボディの scheduling_start_date（上書き指定）→
    受注に保存済みの scheduling_start_date の順で解決する。未指定なら実行日時が起点（Issue #372）。
    ボディで上書きする場合、過去日は president / platform_admin のみ許可。
    """
    logger.info(f"Simulating schedule for order {order_id}")
    order = order_repo.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("product_id") is None:
        raise HTTPException(status_code=422, detail={"error": "product_unmatched"})

    override = body.scheduling_start_date if body else None
    if override:
        _assert_scheduling_start_date_allowed(override, tenant_id, user_id, client)
        raw_start = override
    else:
        # 受注に保存済みの値は書き込み時に検証済みのため、ここでは権限チェック不要
        raw_start = order.get("scheduling_start_date")

    try:
        start_time = to_scheduling_start_time(raw_start)
    except ValueError as e:
        # 保存済み／指定された作業開始日のフォーマットが不正。データ不備のため 422 で明示する。
        logger.warning(
            "simulate_schedule: invalid scheduling_start_date order_id=%s value=%r: %s",
            order_id,
            raw_start,
            e,
        )
        raise HTTPException(
            status_code=422, detail={"error": "invalid_scheduling_start_date"}
        ) from None

    try:
        result = schedule_order(
            order_id=order["id"],
            product_id=order["product_id"],
            quantity=order["quantity"],
            product_repo=product_repo,
            schedule_repo=schedule_repo,
            tenant_id=tenant_id,
            start_time=start_time,
            dry_run=True,
            settings_repo=settings_repo,
        )
        # dry_run のため実スケジュールは保存されないが、完成見込み日（シミュ納期）は
        # confirmed_deadline と同一ロジックで算出し、承認前の表示用に永続化する（Issue #394-A）。
        order_repo.mark_as_scheduled(order_id, _deadline_from_schedules(result))
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
    except InvalidRoutingDurationError as e:
        # 工程の合計所要時間が負（データ不正）。ユーザーが修正すれば解消するため 422。
        # 所要時間 0 の工程はマイルストーン工程として正常処理される（Issue #378）。
        logger.warning(
            "simulate_schedule: invalid routing duration order_id=%s routing_id=%s",
            order_id,
            e.routing_id,
        )
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_routing_duration", "routing_id": e.routing_id},
        ) from None
    except ValueError:
        # スケジューラ内部の想定外状態（開始時刻を算出できない・スケジュールが空 等）。
        # クライアント起因ではないため 500 とし、原因をスタックトレース付きでログに残す
        # （本番でアクセスログの "400 Bad Request" だけが残り原因不明になる事象への対策。Issue #374）。
        logger.exception(
            "simulate_schedule failed: order_id=%s scheduling_start_date=%r",
            order_id,
            raw_start,
        )
        raise HTTPException(
            status_code=500, detail="シミュレーションの計算に失敗しました"
        ) from None


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
    #    受注に作業開始日が設定されていれば、その日の稼働開始時刻を起点にする（Issue #372）。
    #    保存済みの値は書き込み時に検証済みのため、ここでは権限チェック不要。
    start_time = to_scheduling_start_time(order.get("scheduling_start_date"))
    result = schedule_order(
        order_id=order["id"],
        product_id=order["product_id"],
        quantity=order["quantity"],
        product_repo=product_repo,
        schedule_repo=schedule_repo,
        tenant_id=tenant_id,
        start_time=start_time,
        dry_run=False,
        settings_repo=settings_repo,
        desired_deadline=order.get("deadline_date"),
    )

    # 2. ステータス更新 & is_scheduled フラグ更新
    confirmed_deadline = _deadline_from_schedules(result)
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
        order_id,
        {
            "status": "pending_approval",
            "rejection_reason": None,
            # 承認待ちキューカード（Issue #402）の「依頼者 / 経過時間」表示用に非正規化する。
            # 監査ログ（order_approval_log）とは別に orders 側へも直接書き込む。
            "approval_requested_at": datetime.now(UTC).isoformat(),
            "approval_requested_by": user_id,
        },
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
    except InvalidRoutingDurationError as e:
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_routing_duration", "routing_id": e.routing_id},
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
        except InvalidRoutingDurationError as e:
            results.append(
                {
                    "order_id": order_id,
                    "status": "error",
                    "detail": {
                        "error": "invalid_routing_duration",
                        "routing_id": e.routing_id,
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
        order_id,
        {
            "status": "draft",
            "rejection_reason": reject_data.reason,
            # draft へ戻った注文に古い依頼者・依頼日時を残さない（Issue #402）。
            "approval_requested_at": None,
            "approval_requested_by": None,
        },
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

    result = order_repo.update(
        order_id,
        {
            "status": "draft",
            # draft へ戻った注文に古い依頼者・依頼日時を残さない（Issue #402）。
            "approval_requested_at": None,
            "approval_requested_by": None,
        },
    )
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
    確定済 / 生産中の注文を送品済み (shipped) にする（president / order_handler）。

    confirmed / in_progress から遷移でき、shipped は実質的な終端状態。
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

    updated = order_repo.bulk_update_status(target_ids, "shipped")
    updated_ids = [o["id"] for o in updated] if updated else []

    logger.info(f"Shipped {len(updated_ids)} overdue draft orders")
    logger.debug(f"Shipped overdue draft order ids: {updated_ids}")
    return {"shipped_count": len(updated_ids), "order_ids": updated_ids}
