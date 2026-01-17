from .equipment_groups import equipment_group_router
from .equipments import equipment_router
from .process_routings import process_routing_router
from .products import product_router

__all__ = [
    "product_router",
    "equipment_router",
    "equipment_group_router",
    "process_routing_router",
]
