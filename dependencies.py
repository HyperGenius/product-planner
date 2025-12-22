# dependencies.py
import os
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from supabase import create_client, Client, ClientOptions
from repositories.supabase import (
    ProductRepository,
    EquipmentRepository,
    OrderRepository,
    ScheduleRepository,
)

# Bearer Token (JWT) を取得するためのスキーム
security = HTTPBearer()


def get_current_user_token(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> str:
    """Authorizationヘッダーからトークンを取り出す"""
    return credentials.credentials


def get_current_tenant_id(x_tenant_id: str = Header(...)) -> str:
    """テナントIDを取得する"""
    return x_tenant_id


def get_supabase_client(token: str = Depends(get_current_user_token)) -> Client:
    """
    ユーザーのトークンを使ってSupabaseクライアントを初期化する。
    これによりDB側で auth.uid() が機能し、RLSが正しく動作する。
    """
    # Supabaseクライアントはアプリ全体で1つだけ作成（シングルトン）
    sb_url = os.environ.get("SUPABASE_URL")
    # 公開キー(anon key)を使用(service_role keyは絶対に使わない)
    sb_anon_key = os.environ.get("SUPABASE_ANON_KEY")

    if not sb_url or not sb_anon_key:
        raise ValueError("Supabase environment variables are not set.")

    try:
        # headersにAuthorizationをセットすることで、ユーザーとして振る舞う
        client = create_client(
            sb_url,
            sb_anon_key,
            options=ClientOptions(headers={"Authorization": f"Bearer {token}"}),
        )
        return client
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
        )


# --- Dependency Injection用の関数 ---


def get_order_repo(client: Client = Depends(get_supabase_client)) -> OrderRepository:
    """注文リポジトリを取得する。"""
    return OrderRepository(client)


def get_schedule_repo(
    client: Client = Depends(get_supabase_client),
) -> ScheduleRepository:
    """スケジュールリポジトリを取得する。"""
    return ScheduleRepository(client)


def get_product_repo(
    client: Client = Depends(get_supabase_client),
) -> ProductRepository:
    """プロダクトリポジトリを取得する。"""
    return ProductRepository(client)


def get_equipment_repo(
    client: Client = Depends(get_supabase_client),
) -> EquipmentRepository:
    """設備リポジトリを取得する。"""
    return EquipmentRepository(client)
