# repositories/supabase/master/__init__.py
from .customer_repo import CustomerRepository
from .equipment_repo import EquipmentRepository
from .product_repo import ProductRepository

__all__ = ["EquipmentRepository", "ProductRepository", "CustomerRepository"]
