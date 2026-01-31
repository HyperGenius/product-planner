# backend/app/routers/master/__init__.py
from .calendars import calendar_router
from .customers import customer_router
from .equipment_groups import equipment_group_router
from .equipments import equipment_router
from .process_routings import process_routing_router
from .products import product_router

__all__ = [
    "product_router",
    "equipment_router",
    "equipment_group_router",
    "process_routing_router",
    "calendar_router",
    "customer_router",
]
