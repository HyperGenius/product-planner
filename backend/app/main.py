# backend/main.py
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers.master import (
    equipment_group_router,
    equipment_router,
    process_routing_router,
    product_router,
)
from app.routers.transaction import orders_router

# .envファイルの読み込み
load_dotenv()

# FastAPIアプリの初期化
app = FastAPI(
    title="Product Planner API",
    description="API on Render",
    version="1.0.0",
)

# CORS設定
origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8081",  # In case user insists on 8081 proxy
    "*",  # Permissive for development
]

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
app.include_router(orders_router)


@app.get("/health")
async def health():
    return {"status": "ok", "platform": "Render"}
