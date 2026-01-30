# backend/app/repositories/supa_infra/common/table_name.py
from enum import Enum


class SupabaseTableName(Enum):
    """Supabaseのテーブル名を定義する列挙型クラス。"""

    USERS = "users"
    PRODUCTS = "products"
    ORDERS = "orders"
    PROCESS_ROUTINGS = "process_routings"
    EQUIPMENTS = "equipments"
    EQUIPMENT_GROUPS = "equipment_groups"
    EQUIPMENT_GROUP_MEMBERS = "equipment_group_members"
    PRODUCTION_SCHEDULES = "production_schedules"
    WORK_CALENDARS = "work_calendars"
    # Add more table names as needed
