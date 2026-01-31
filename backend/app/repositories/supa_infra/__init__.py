# backend/app/repositories/supa_infra/__init__.py
from app.repositories.supa_infra.common import CalendarRepository, SupabaseTableName
from app.repositories.supa_infra.master import (
    CustomerRepository,
    EquipmentRepository,
    ProductRepository,
)
from app.repositories.supa_infra.transaction import OrderRepository, ScheduleRepository

__all__ = [
    # common
    "SupabaseTableName",
    "CalendarRepository",
    # master
    "EquipmentRepository",
    "ProductRepository",
    "CustomerRepository",
    # transaction
    "ScheduleRepository",
    "OrderRepository",
]
