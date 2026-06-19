# backend/main.py
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers.admin import admin_router
from app.routers.cron import cron_router
from app.routers.master import (
    calendar_router,
    customer_router,
    equipment_group_router,
    equipment_router,
    process_routing_router,
    product_router,
    scheduling_settings_router,
)
from app.routers.tenant import member_router
from app.routers.transaction import orders_router, production_schedules_router

# .envファイルの読み込み
load_dotenv()

# FastAPIアプリの初期化
app = FastAPI(
    title="Product Planner API",
    description="API on Render",
    version="1.0.0",
)

# CORS設定
_extra_origins = os.getenv("CORS_ALLOWED_ORIGINS", "")
origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
] + [o.strip() for o in _extra_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ルーターの登録
app.include_router(product_router)
app.include_router(equipment_router)
app.include_router(equipment_group_router)
app.include_router(process_routing_router)
app.include_router(calendar_router)
app.include_router(customer_router)
app.include_router(orders_router)
app.include_router(production_schedules_router)
app.include_router(scheduling_settings_router)
app.include_router(member_router)
app.include_router(admin_router)
app.include_router(cron_router)


@app.get("/health")
async def health():
    return {"status": "ok", "platform": "Render"}
