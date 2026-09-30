"""既存受注の納期シミュレーション（dry_run）と、その結果の永続化（Issue #477）。

`POST /orders/{id}/simulate`（手動シミュ）と cron の自動起票（`pdf_order_parsing_service`）
の両方から、同じロジックでシミュ納期（`simulated_deadline`）を算出・保存するための
サービス層。ルーターモジュールを import しないこと（cron から呼ぶため）。
"""

import time as time_module
from datetime import date, datetime
from typing import Any, cast

from app.repositories.supa_infra.common.scheduling_settings_repo import (
    SchedulingSettingsRepository,
)
from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.repositories.supa_infra.master.product_repo import ProductRepository
from app.repositories.supa_infra.transaction.order_repo import OrderRepository
from app.repositories.supa_infra.transaction.schedule_repo import ScheduleRepository
from app.scheduler_logic import (
    InvalidRoutingDurationError,
    RoutingUnconfirmedError,
    schedule_order,
)
from app.services.scheduling_start_service import (
    default_scheduling_start_date,
    parse_scheduling_start_date,
    to_scheduling_start_time,
)
from app.utils.logger import get_logger
from supabase import Client

logger = get_logger(__name__)


def deadline_from_schedules(schedules: list[dict]) -> str:
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


def simulate_and_persist(
    order: dict[str, Any],
    *,
    tenant_id: str,
    start_time: datetime | None,
    order_repo: OrderRepository,
    product_repo: ProductRepository,
    schedule_repo: ScheduleRepository,
    settings_repo: SchedulingSettingsRepository,
    auto_scheduling_start_date: date | None = None,
) -> list[dict[str, Any]]:
    """既存受注を dry_run でスケジュールし、シミュ納期を受注へ保存する。

    dry_run のため実スケジュールは保存されないが、完成見込み日（シミュ納期）は
    confirmed_deadline と同一ロジックで算出し、承認前の表示用に永続化する（Issue #394-A）。
    `auto_scheduling_start_date` を渡すと、自動補完した作業開始日も同一 UPDATE で
    保存する（Issue #477）。

    Raises:
        RoutingUnconfirmedError / InvalidRoutingDurationError / ValueError:
            `schedule_order()` の例外をそのまま送出する（呼び出し側でハンドリングする）。
    """
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
    order_repo.mark_as_scheduled(
        order["id"],
        deadline_from_schedules(result),
        auto_scheduling_start_date=auto_scheduling_start_date,
        tenant_id=tenant_id,
    )
    return result


def auto_simulate_intake_order(
    db: Client,
    tenant_id: str,
    order_id: int,
    *,
    today: date | None = None,
) -> bool:
    """cron で自動起票（inserted / updated）した受注のシミュ納期を算出・保存する（Issue #477）。

    作業開始日が未設定なら処理日（JST）の翌日を保存し、その日を起点に dry_run で
    シミュレーションする。設定済みの作業開始日は上書きしない。

    ベストエフォート: 製品未照合（product_id IS NULL）はスキップし、工程未登録・
    所要時間不正・その他の例外はログに残して握りつぶす（受注起票自体は成功扱いのまま）。
    シミュ納期を保存できた場合 True を返す。

    `db` は RLS をバイパスする admin クライアント。受注は `tenant_id` で明示的に
    絞り込み、スケジューラ内のクエリは受注の product_id に紐づく工程・設備 ID で
    絞り込まれるため、他テナントのデータは参照しない。
    """
    started = time_module.monotonic()
    try:
        res = (
            db.table(SupabaseTableName.ORDERS.value)
            .select("id, product_id, quantity, scheduling_start_date")
            .eq("id", order_id)
            .eq("tenant_id", tenant_id)
            .limit(1)
            .execute()
        )
        rows = cast(list[dict[str, Any]], res.data or [])
        if not rows:
            logger.warning(
                "auto_simulate: order not found order_id=%s tenant_id=%s",
                order_id,
                tenant_id,
            )
            return False
        order = rows[0]
        if order.get("product_id") is None or order.get("quantity") is None:
            # 製品未照合・数量未抽出の下書きはシミュできない（紐付け後の手動シミュで補完する）
            return False

        stored_start = parse_scheduling_start_date(order.get("scheduling_start_date"))
        auto_start = (
            default_scheduling_start_date(today=today) if stored_start is None else None
        )
        start_time = to_scheduling_start_time(stored_start or auto_start)

        simulate_and_persist(
            order,
            tenant_id=tenant_id,
            start_time=start_time,
            order_repo=OrderRepository(db),
            product_repo=ProductRepository(db),
            schedule_repo=ScheduleRepository(db),
            settings_repo=SchedulingSettingsRepository(db),
            auto_scheduling_start_date=auto_start,
        )
    except RoutingUnconfirmedError as e:
        logger.warning(
            "auto_simulate: skipped order_id=%s reason=%s",
            order_id,
            "no_routing" if e.no_routing else "routing_unconfirmed",
        )
        return False
    except InvalidRoutingDurationError as e:
        logger.warning(
            "auto_simulate: skipped order_id=%s reason=invalid_routing_duration "
            "routing_id=%s",
            order_id,
            e.routing_id,
        )
        return False
    except Exception:
        logger.exception("auto_simulate: failed order_id=%s", order_id)
        return False

    logger.info(
        "auto_simulate: order_id=%s simulated in %.2fs",
        order_id,
        time_module.monotonic() - started,
    )
    return True
