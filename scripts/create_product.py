# scripts/create_product.py
from dotenv import load_dotenv
from get_token import get_access_token
import os
import requests

load_dotenv()


def create_product():
    """APIにPOSTリクエストを送って製品を新規作成する"""
    test_user_email = os.environ.get("TEST_USER_EMAIL")
    test_user_pass = os.environ.get("TEST_USER_PASS")
    tenant_id = os.environ.get("TEST_TENANT_ID")

    if not test_user_email or not test_user_pass or not tenant_id:
        # 環境変数が設定されていない場合は、エラーを投げて終了
        print(f"{test_user_email=}, {test_user_pass=}, {tenant_id=}")
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
        "code": "TP-002",
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
