# __tests__/integration/test_rls_scenarios.py
import uuid

import pytest
from app.main import app
from fastapi.testclient import TestClient

# 本物のAPIサーバーとして動作させる（Dependency Overrideしない）
client = TestClient(app)

# RLS違反時、repo層は例外をキャッチせず素通しするため、TestClientのデフォルト設定
# (raise_server_exceptions=True) だと HTTPレスポンスではなく例外として伝播してしまう。
# RLS拒否を「レスポンスのステータスコード」として検証するテストではこちらを使う。
client_no_raise = TestClient(app, raise_server_exceptions=False)


@pytest.mark.integration
def test_create_and_read_own_data(auth_token, tenant_id, admin_db):
    """自分のテナントのデータを作成・参照できる"""

    # 1. データ作成 (Bearer Token + テナントIDヘッダ付き)
    unique_code = f"MTP-{uuid.uuid4().hex[:8]}"
    payload = {
        "name": "My Tenant Product",
        "code": unique_code,
    }
    headers = {"Authorization": f"Bearer {auth_token}", "x-tenant-id": tenant_id}

    created_id = None
    try:
        create_res = client.post("/products", json=payload, headers=headers)
        assert create_res.status_code == 200
        created_id = create_res.json()["id"]

        # 2. データ参照
        get_res = client.get(f"/products/{created_id}", headers=headers)
        assert get_res.status_code == 200
        assert get_res.json()["name"] == "My Tenant Product"
    finally:
        if created_id is not None:
            admin_db.table("products").delete().eq("id", created_id).execute()


@pytest.mark.integration
def test_cannot_access_other_tenant_data(auth_token):
    """他人のテナントのデータは見えない (RLS検証)"""

    # 前提: DBに「別のテナント(Tenant B)」のデータがあるとする
    # あるいは、ここで管理者権限などで無理やりTenant Bのデータを作る

    # Tenant B のIDを指定して作成しようとしても...
    other_tenant_id = str(uuid.uuid4())  # 適当な別テナント
    headers = {
        "Authorization": f"Bearer {auth_token}",
        "x-tenant-id": other_tenant_id,
    }
    payload = {
        "name": "Spy Product",
        "code": f"SPY-{uuid.uuid4().hex[:8]}",
    }

    # RLSポリシー (Check) により、作成自体が拒否されるはず (403 or 500)
    # または作成できても、その後のSelectで見えない
    res = client_no_raise.post("/products", json=payload, headers=headers)

    # RLSの設定次第ですが、Supabaseは権限がないInsertに対してエラーを返します
    assert res.status_code != 200
