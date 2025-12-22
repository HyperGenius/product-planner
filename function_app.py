# function_app.py
import azure.functions as func
from fastapi import FastAPI

# ルーターをインポート
from routers.master import (
    product_router,
    equipment_router,
    equipment_group_router,
    process_routing_router,
)
from routers.transaction import orders_router

# --- FastAPIのセットアップ ---
prod_planner_api = FastAPI(
    title="Product Planner API",
    description="API for product planning and scheduling using Supabase as the backend.",
    version="1.0.0",
    root_path="/api",
)

# TODO: 例外ハンドラーの追加


# --- 各ルーターの登録 ---
prod_planner_api.include_router(product_router)
prod_planner_api.include_router(equipment_router)
prod_planner_api.include_router(equipment_group_router)
prod_planner_api.include_router(process_routing_router)
prod_planner_api.include_router(orders_router)


@prod_planner_api.get("/health", tags=["Health"])
async def health():
    return {"message": "Product Planner API"}


app = func.FunctionApp()


@app.route(route="{*route}", auth_level=func.AuthLevel.ANONYMOUS)
async def main(req: func.HttpRequest, context: func.Context) -> func.HttpResponse:
    return await func.AsgiMiddleware(prod_planner_api).handle_async(req, context)
