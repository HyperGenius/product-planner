# routers/transaction/orders/_shared.py
"""orders パッケージ内の複数サブルーターで共有するヘルパー（Issue #376）。

循環 import を避けるため、このモジュールはサブルーター（crud / email_intake /
simulation / approval_workflow 等）を import しないこと。
"""

from datetime import datetime
from typing import Any, cast

from fastapi import Depends, HTTPException, status

from app.dependencies import get_current_user_role, get_supabase_client
from app.repositories.supa_infra.common import DuplicateRecordError
from app.repositories.supa_infra.common.scheduling_settings_repo import (
    SchedulingSettingsRepository,
)
from app.repositories.supa_infra.transaction.order_repo import OrderRepository
from supabase import Client


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


def get_settings_repo(
    client: Client = Depends(get_supabase_client),
) -> SchedulingSettingsRepository:
    return SchedulingSettingsRepository(client)
