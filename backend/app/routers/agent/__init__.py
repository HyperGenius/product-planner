from app.routers.agent.daily_reports import daily_reports_router
from app.routers.agent.heartbeat import heartbeat_router
from app.routers.agent.shipment_files import shipment_files_agent_router

__all__ = [
    "daily_reports_router",
    "heartbeat_router",
    "shipment_files_agent_router",
]
