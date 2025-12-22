# scripts/get_token.py
import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()


def get_supabase_client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_API_KEY")
    if not url or not key:
        raise ValueError("SUPABASE_URL or SUPABASE_API_KEY is not set")

    supabase = create_client(url, key)
    return supabase


def get_access_token(email: str, password: str):
    try:
        # Supabase Authでログインしてトークンを取得
        res = get_supabase_client().auth.sign_in_with_password(
            {"email": email, "password": password}
        )
        print(f"\n✅ Access Token for {email}:")
        print(f"{res.session.access_token}")
        return res.session.access_token
    except Exception as e:
        print("email: ", email)
        print("password: ", password)
        print(f"❌ Error: {e}")


if __name__ == "__main__":
    # 事前にSupabaseで作成しておいたユーザー情報
    test_user_email = os.environ.get("TEST_USER_EMAIL")
    test_user_pass = os.environ.get("TEST_USER_PASS")
    if not test_user_email or not test_user_pass:
        raise ValueError("TEST_USER_EMAIL or TEST_USER_PASS is not set")

    get_access_token(test_user_email, test_user_pass)
