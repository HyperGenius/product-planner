# backend/app/repositories/supa_infra/__init__.py
from app.repositories.supa_infra.common import CalendarRepository, SupabaseTableName
from app.repositories.supa_infra.master import (
    CustomerRepository,
    EquipmentRepository,
    ProductNameAliasHistoryRepository,
    ProductNameAliasRepository,
    ProductRepository,
)
from app.repositories.supa_infra.transaction import (
    OrderApprovalLogRepository,
    OrderRepository,
    OrderSchedulingStartBackdateLogRepository,
    ScheduleRepository,
)

__all__ = [
    # common
    "SupabaseTableName",
    "CalendarRepository",
    # master
    "EquipmentRepository",
    "ProductRepository",
    "CustomerRepository",
    "ProductNameAliasHistoryRepository",
    "ProductNameAliasRepository",
    # transaction
    "ScheduleRepository",
    "OrderRepository",
    "OrderApprovalLogRepository",
    "OrderSchedulingStartBackdateLogRepository",
]
