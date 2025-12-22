from .products import product_router
from .equipments import equipment_router
from .equipment_groups import equipment_group_router
from .process_routings import process_routing_router

__all__ = [
    "product_router",
    "equipment_router",
    "equipment_group_router",
    "process_routing_router",
]
