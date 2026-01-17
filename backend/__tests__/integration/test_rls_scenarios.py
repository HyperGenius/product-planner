# __tests__/integration/test_rls_scenarios.py
import uuid

import pytest
from fastapi.testclient import TestClient
from function_app import prod_planner_api

# 本物のAPIサーバーとして動作させる（Dependency Overrideしない）
client = TestClient(prod_planner_api)


@pytest.mark.integration
def test_create_and_read_own_data(auth_token):
    """自分のテナントのデータを作成・参照できる"""

    tenant_id = "uuid-of-tenant-a"  # ログインユーザーの所属テナント

    # 1. データ作成 (Bearer Token付き)
    payload = {
        "name": "My Tenant Product",
        "code": "MTP-001",
        "tenant_id": tenant_id,
        "type": "standard",
    }
    headers = {"Authorization": f"Bearer {auth_token}"}

    create_res = client.post("/api/products/", json=payload, headers=headers)
    assert create_res.status_code == 200
    created_id = create_res.json()["id"]

    # 2. データ参照
    get_res = client.get(f"/api/products/{created_id}", headers=headers)
    assert get_res.status_code == 200
    assert get_res.json()["name"] == "My Tenant Product"


@pytest.mark.integration
def test_cannot_access_other_tenant_data(auth_token):
    """他人のテナントのデータは見えない (RLS検証)"""

    # 前提: DBに「別のテナント(Tenant B)」のデータがあるとする
    # あるいは、ここで管理者権限などで無理やりTenant Bのデータを作る

    headers = {"Authorization": f"Bearer {auth_token}"}

    # Tenant B のIDを指定して作成しようとしても...
    other_tenant_id = str(uuid.uuid4())  # 適当な別テナント
    payload = {
        "name": "Spy Product",
        "code": "SPY-001",
        "tenant_id": other_tenant_id,
        "type": "standard",
    }

    # RLSポリシー (Check) により、作成自体が拒否されるはず (403 or 500)
    # または作成できても、その後のSelectで見えない
    res = client.post("/api/products/", json=payload, headers=headers)

    # RLSの設定次第ですが、Supabaseは権限がないInsertに対してエラーを返します
    assert res.status_code != 200
