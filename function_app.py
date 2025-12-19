# function_app.py
import azure.functions as func
from fastapi import FastAPI

# ルーターをインポート
from routers.master import (
    product_router,
)

# --- FastAPIのセットアップ ---
prod_planner_api = FastAPI(
    title="Product Planner API",
    description="API for product planning and scheduling using Supabase as the backend.",
    version="1.0.0",
)

# TODO: 例外ハンドラーの追加


# --- 各ルーターの登録 ---
prod_planner_api.include_router(product_router)


@prod_planner_api.get("/health", tags=["Health"])
async def root():
    return {"message": "Product Planner API"}


app = func.FunctionApp()


@app.route(route="{*route}", auth_level=func.AuthLevel.ANONYMOUS)
def main(req: func.HttpRequest, context: func.Context) -> func.HttpResponse:
    return func.AsgiMiddleware(prod_planner_api).handle(req, context)
