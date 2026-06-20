# backend/app/dependencies.py
import os

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.repositories.supa_infra import (
    CustomerRepository,
    EquipmentRepository,
    OrderRepository,
    ProductRepository,
    ScheduleRepository,
)
from supabase import Client, ClientOptions, create_client  # type: ignore

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
        ) from e


def get_current_user_id(
    token: str = Depends(get_current_user_token),
    client: Client = Depends(get_supabase_client),
) -> str:
    """Supabaseクライアントを通じて現在の認証ユーザーIDを取得する。

    JWT署名をSupabaseサーバーサイドで検証済みのセッション情報から取得するため、
    トークンの改ざんを正しく検出できる。
    """
    try:
        user_response = client.auth.get_user(jwt=token)
        if not user_response or not user_response.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials",
            )
        return str(user_response.user.id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
        ) from e


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


def get_customer_repo(
    client: Client = Depends(get_supabase_client),
) -> CustomerRepository:
    """顧客リポジトリを取得する。"""
    return CustomerRepository(client)


def get_current_user_role(tenant_id: str, user_id: str, client: Client) -> str:
    """organization_members から現在ユーザーのロールを取得する。

    Returns:
        "admin" または "member"

    Raises:
        HTTPException 403: テナントメンバーでない場合
    """
    res = (
        client.table("organization_members")
        .select("role")
        .eq("tenant_id", tenant_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not res.data:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="テナントのメンバーではありません",
        )
    data = res.data
    assert isinstance(data, dict)
    return str(data["role"])


def get_supabase_admin_client() -> Client:
    """
    Service Role Key を使ったSupabase管理者クライアントを返す。
    Admin API の呼び出し（ユーザー作成等）にのみ使用する。
    この関数は必ず権限チェック後に呼び出すこと。
    """
    sb_url = os.environ.get("SUPABASE_URL")
    sb_service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not sb_url or not sb_service_role_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="サーバー設定エラー: Supabase環境変数が不足しています",
        )

    return create_client(sb_url, sb_service_role_key)
