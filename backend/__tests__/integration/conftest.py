import os

import pytest
from dotenv import load_dotenv

from supabase import Client, create_client

load_dotenv()

# テスト用のユーザー情報 (事前にDBに入れておくか、Setupで作成する)
TEST_USER_EMAIL = "user_a@example.com"
TEST_USER_PASS = "password123"
TEST_TENANT_ID = "uuid-of-tenant-a"


@pytest.fixture(scope="session")
def real_supabase_client():
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_KEY"]
    return create_client(url, key)


@pytest.fixture(scope="session")
def auth_token(real_supabase_client):
    """本物のSupabaseでログインし、JWTトークンを返す"""
    res = real_supabase_client.auth.sign_in_with_password(
        {"email": TEST_USER_EMAIL, "password": TEST_USER_PASS}
    )
    return res.session.access_token


@pytest.fixture(scope="session")
def admin_db() -> Client:
    """
    Service Role Key を使った Supabase 管理者クライアント。
    RLSを経由せずテスト用データのセットアップ・後始末を行うために使う。
    Gmail/Claude APIには依存しないため、ローカル `supabase start` があれば動く。
    """
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        pytest.skip("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set")
    return create_client(url, key)
