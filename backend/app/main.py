# backend/main.py
from fastapi import FastAPI

from app.routers.master import (
    equipment_group_router,
    equipment_router,
    process_routing_router,
    product_router,
)
from app.routers.transaction import orders_router

# FastAPIアプリの初期化
app = FastAPI(
    title="Product Planner API",
    description="API on Render",
    version="1.0.0",
)

# ルーターの登録
app.include_router(product_router)
app.include_router(equipment_router)
app.include_router(equipment_group_router)
app.include_router(process_routing_router)
app.include_router(orders_router)


@app.get("/health")
async def health():
    return {"status": "ok", "platform": "Render"}
