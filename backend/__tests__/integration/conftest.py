import os

import pytest
from dotenv import load_dotenv

from supabase import Client, create_client

load_dotenv()

# テスト用のユーザー情報 (事前にDBに入れておくか、Setupで作成する)
# .env の TEST_USER_EMAIL / TEST_USER_PASS / TEST_TENANT_ID (backend/scripts/ の
# シードスクリプト群と共通) と一致させる。ここをハードコードすると .env と値が
# 乖離してログインに失敗する（実際に発生し、本コメントを追加する契機になった）。
TEST_USER_EMAIL = os.environ.get("TEST_USER_EMAIL", "")
TEST_USER_PASS = os.environ.get("TEST_USER_PASS", "")
TEST_TENANT_ID = os.environ.get("TEST_TENANT_ID", "")


@pytest.fixture(scope="session")
def real_supabase_client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_ANON_KEY")
    if not url or not key:
        pytest.skip("SUPABASE_URL / SUPABASE_ANON_KEY not set")
    return create_client(url, key)


@pytest.fixture(scope="session")
def auth_session(real_supabase_client):
    """本物のSupabaseでログインし、セッション（JWT + ユーザー情報）を返す。

    ログイン後、real_supabase_client 自体もこのユーザーのセッションを保持する
    ため、以降 real_supabase_client.table(...) 経由のクエリはこのユーザーの
    JWTでRLSを通る（notifications への直接INSERT/UPDATE拒否の検証等で利用）。
    """
    if not TEST_USER_EMAIL or not TEST_USER_PASS:
        pytest.skip("TEST_USER_EMAIL / TEST_USER_PASS not set")
    return real_supabase_client.auth.sign_in_with_password(
        {"email": TEST_USER_EMAIL, "password": TEST_USER_PASS}
    )


@pytest.fixture(scope="session")
def auth_token(auth_session):
    """本物のSupabaseでログインし、JWTトークンを返す"""
    return auth_session.session.access_token


@pytest.fixture(scope="session")
def auth_user_id(auth_session):
    """ログインユーザーの auth.users.id。テスト用テナントへのメンバー登録に使う。"""
    return auth_session.user.id


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
