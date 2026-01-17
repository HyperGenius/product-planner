# scripts/create_product.py
import os

import requests
from dotenv import load_dotenv
from get_token import get_access_token

load_dotenv()


def create_product():
    """APIにPOSTリクエストを送って製品を新規作成する"""
    test_user_email = os.environ.get("TEST_USER_EMAIL")
    test_user_pass = os.environ.get("TEST_USER_PASS")
    tenant_id = os.environ.get("TEST_TENANT_ID")

    if not test_user_email or not test_user_pass or not tenant_id:
        # 環境変数が設定されていない場合は、エラーを投げて終了（値はログに出さない）
        missing_vars = []
        if not test_user_email:
            missing_vars.append("TEST_USER_EMAIL")
        if not test_user_pass:
            missing_vars.append("TEST_USER_PASS")
        if not tenant_id:
            missing_vars.append("TEST_TENANT_ID")
        print(f"Missing environment variables: {', '.join(missing_vars)}")
        raise ValueError(
            "TEST_USER_EMAIL or TEST_USER_PASS or TEST_TENANT_ID is not set"
        )

    token = get_access_token(test_user_email, test_user_pass)
    if not token:
        # アクセストークンを取得できなかった場合は、エラーを投げて終了
        raise ValueError("Failed to get access token")

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
        "x-tenant-id": tenant_id,
    }

    data = {
        "name": "Test Product",
        "code": "TP-003",
        "type": "standard",
    }

    response = requests.post(
        "http://localhost:7071/api/products/", headers=headers, json=data
    )
    if response.status_code != 200:
        # APIリクエストが失敗した場合は、エラーを投げて終了
        raise Exception(f"Failed to create product: {response.text}")

    print(f"Product created: {response.json()}")


if __name__ == "__main__":
    create_product()
