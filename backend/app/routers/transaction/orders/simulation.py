# routers/transaction/orders/simulation.py
"""納期シミュレーション: POST /orders/simulate, POST /orders/{order_id}/simulate（Issue #376）。"""

from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_equipment_repo,
    get_order_repo,
    get_product_repo,
    get_schedule_repo,
    get_supabase_client,
)
from app.models.transaction.order_schema import (
    OrderSimulateByIdRequest,
    OrderSimulateRequest,
)
from app.repositories.supa_infra.common.scheduling_settings_repo import (
    SchedulingSettingsRepository,
)
from app.repositories.supa_infra.master.equipment_repo import EquipmentRepository
from app.repositories.supa_infra.master.product_repo import ProductRepository
from app.repositories.supa_infra.transaction.order_repo import OrderRepository
from app.repositories.supa_infra.transaction.schedule_repo import ScheduleRepository
from app.scheduler_logic import (
    InvalidRoutingDurationError,
    RoutingUnconfirmedError,
    schedule_order,
)
from app.services.scheduling_start_service import to_scheduling_start_time
from app.services.simulation_service import build_simulate_response
from app.utils.logger import get_logger
from supabase import Client

from ._shared import _deadline_from_schedules, get_settings_repo
from .scheduling_start import _assert_scheduling_start_date_allowed

router = APIRouter()

logger = get_logger(__name__)


@router.post("/simulate")
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


@router.post("/{order_id}/simulate")
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
