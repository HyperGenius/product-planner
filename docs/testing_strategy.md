# テスト戦略 (Testing Strategy)

## 1. 概要
本プロジェクトでは、品質担保と開発速度のバランスを保つため、**「テストのピラミッド」** の概念に基づいた3層のテスト戦略を採用します。特にマルチテナント環境における**データ漏洩（RLS不備）**を防ぐため、層ごとの責務を明確にします。

## 2. ディレクトリ構成
`__tests__/` ディレクトリ配下をテストの種類ごとに分割して管理します。

```text
__tests__/
├── unit/              # 1. 単体テスト (ロジック・計算)
├── api/               # 2. 機能テスト (APIルーター・バリデーション)
└── integration/       # 3. 統合テスト (DB接続・RLS検証)

```

---

## 3. テストの分類と実装方針

### Layer 1: 単体テスト (Unit Tests)

ビジネスロジックそのものが正しく動作するかを検証します。

* **対象:** `scheduler_logic.py`, 複雑なユーティリティ関数
* **特徴:**
* **DB接続なし:** リポジトリをMock化する。
* **高速:** 外部通信を行わないため、数ミリ秒で完了する。


* **検証内容:**
* 計算結果が正しいか。
* 異常な入力値に対して適切な例外を投げるか。



**実装例 (`__tests__/unit/test_scheduler.py`):**

```python
from unittest.mock import MagicMock
from scheduler_logic import run_scheduler

def test_scheduler_logic():
    mock_repo = MagicMock()
    mock_repo.get_data.return_value = [...]
    
    result = run_scheduler(..., repo=mock_repo)
    assert result["status"] == "success"

```

---

### Layer 2: API機能テスト (Functional Tests)

APIエンドポイントがHTTPリクエストを正しく処理するかを検証します。開発中に最も頻繁に実行されるテストです。

* **対象:** `routers/` 配下の各エンドポイント
* **特徴:**
* **DB接続なし:** `dependency_overrides` を使用してリポジトリと認証をMock化する。
* **FastAPI TestClient:** 実際にサーバーを起動せずにリクエストをシミュレーションする。


* **検証内容:**
* Pydanticによる入力データのバリデーション（型チェック、必須項目）。
* HTTPステータスコード（200, 201, 400, 401, 403, 404）。
* 認証ヘッダーの有無による挙動。
* レスポンスのJSON構造。



**実装例 (`__tests__/api/test_equipment_groups.py`):**

```python
from fastapi.testclient import TestClient
from function_app import prod_planner_api
from dependencies import get_equipment_repo

client = TestClient(prod_planner_api)

def test_create_group():
    # 1. Mockの準備
    mock_repo = MagicMock()
    mock_repo.create.return_value = {"id": 1, "name": "Test Group"}
    
    # 2. 依存関係の差し替え (DB接続防止)
    prod_planner_api.dependency_overrides[get_equipment_repo] = lambda: mock_repo
    
    # 3. 実行
    res = client.post("/api/equipment-groups/", json={"name": "Test Group"})
    
    assert res.status_code == 200
    mock_repo.create.assert_called_once()
    
    # 4. 後始末
    prod_planner_api.dependency_overrides = {}

```

---

### Layer 3: 統合/セキュリティテスト (Integration & RLS Tests)

実際のデータベース（ローカルSupabase）に対してクエリを発行し、セキュリティ設定（RLS）が正しく機能しているかを検証します。

* **対象:** `repositories/` + PostgreSQL (Docker)
* **特徴:**
* **DB接続あり:** ローカルのSupabaseコンテナを使用する。
* **RLS検証:** 「Tenant A」のユーザーでログインし、「Tenant B」のデータが見えないことを確認する。


* **検証内容:**
* 正しいSQLが発行されているか。
* 他テナントのデータアクセスがブロックされるか。
* ユニーク制約などのDB制約が機能しているか。



**実装方針:**

* テスト実行前に `supabase db reset` でDBをクリーンな状態にする。
* テスト用ユーザーのJWTを発行してリクエストを行う（または `set local role` を使用）。

---

## 4. CI/CDパイプラインでの運用

GitHub Actionsにおいて、以下の順序で実行・判定を行います。

1. **Unit & API Tests:**
* プルリクエスト作成時およびマージ時に毎回実行。
* ここが失敗した場合、デプロイは行わない。


2. **Integration Tests (Future):**
* 開発の進捗に合わせて、ローカルSupabaseをCI上で立ち上げて実行するように構成する。



## 5. 開発時のルール

* **DBには繋がない:** Unit/APIテストでは必ず `MagicMock` や `dependency_overrides` を使用し、テスト実行時に本物のDBへアクセスしないこと。
* **認証エラーの確認:** 「正常系」だけでなく、「トークンがない」「権限がない」場合のテストケースも必ず作成すること。
