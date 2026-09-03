# backend/app/repositories/supa_infra/common/table_name.py
from enum import Enum


class SupabaseTableName(Enum):
    """Supabaseのテーブル名を定義する列挙型クラス。"""

    USERS = "users"
    PRODUCTS = "products"
    ORDERS = "orders"
    CUSTOMERS = "customers"
    PROCESS_ROUTINGS = "process_routings"
    EQUIPMENTS = "equipments"
    EQUIPMENT_GROUPS = "equipment_groups"
    EQUIPMENT_GROUP_MEMBERS = "equipment_group_members"
    PRODUCTION_SCHEDULES = "production_schedules"
    WORK_CALENDARS = "work_calendars"
    SCHEDULING_SETTINGS = "scheduling_settings"
    GMAIL_LABEL_TENANTS = "gmail_label_tenants"
    ORDER_ATTACHMENTS = "order_attachments"
    ORDER_PARSE_LOG = "order_parse_log"
    NOTIFICATIONS = "notifications"
    ORDER_APPROVAL_LOG = "order_approval_log"
    ORDER_SCHEDULING_START_BACKDATE_LOG = "order_scheduling_start_backdate_log"
    PRODUCT_NAME_ALIASES = "product_name_aliases"
    PRODUCT_NAME_ALIAS_HISTORY = "product_name_alias_history"
