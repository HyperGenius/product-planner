# シナリオベースデータ投入スクリプト

## 概要

このディレクトリには、デモデータやテストデータを「シナリオ」単位で管理し、JSONファイルから柔軟に投入できる仕組みが実装されています。

## ディレクトリ構造

```text
data/
└── scenarios/
    └── standard_demo/           # シナリオ名（例）
        ├── 01_groups.json       # 設備グループ・設備定義
        ├── 02_products.json     # 製品定義
        ├── 03_routings.json     # 工程定義
        └── 04_orders.json       # 注文データ
```

## 使用方法

### 前提条件

以下の環境変数が `.env` ファイルまたは環境に設定されている必要があります：

- `SUPABASE_URL`: Supabase プロジェクトの URL
- `SUPABASE_API_KEY`: Supabase の API キー（service_role または anon key）
- `TEST_USER_EMAIL`: テストユーザーのメールアドレス
- `TEST_USER_PASS`: テストユーザーのパスワード
- `TEST_TENANT_ID`: テナント ID（RLS で使用）

### スクリプトの実行

```bash
# プロジェクトルートから実行
python scripts/seed_scenario.py standard_demo
```

### 実行結果の例

```
============================================================
🚀 Seeding scenario: standard_demo
============================================================
✅ Authenticated as test@example.com
📂 Scenario path: /path/to/data/scenarios/standard_demo

📦 Importing equipment groups and machines...
  ✓ Created group: 切断グループ (ID: 1)
    ✓ Created equipment: 切断機A (ID: 1)
    ✓ Added 切断機A to 切断グループ
    ✓ Created equipment: 切断機B (ID: 2)
    ✓ Added 切断機B to 切断グループ
  ✓ Created group: 組立グループ (ID: 2)
    ✓ Created equipment: 組立ロボット1 (ID: 3)
    ✓ Added 組立ロボット1 to 組立グループ
...
✅ Imported 3 groups and 5 machines

📦 Importing products...
  ✓ Created product: 製品A (PROD-A, ID: 1)
  ✓ Created product: 製品B (PROD-B, ID: 2)
  ✓ Created product: 製品C (PROD-C, ID: 3)
✅ Imported 3 products

📦 Importing process routings...
  ✓ Created routing: PROD-A -> 切断工程 (Seq: 1)
  ✓ Created routing: PROD-A -> 組立工程 (Seq: 2)
  ✓ Created routing: PROD-A -> 検査工程 (Seq: 3)
...
✅ Imported 8 process routings

📦 Importing orders...
  ✓ Created order: ORD-001 (PROD-A x 100)
  ✓ Created order: ORD-002 (PROD-B x 50)
  ✓ Created order: ORD-003 (PROD-C x 75)
  ✓ Created order: ORD-004 (PROD-A x 150)
✅ Imported 4 orders

============================================================
✅ Scenario seeding completed!
============================================================
```

## JSONファイルフォーマット

### 01_groups.json - 設備グループと設備

```json
[
  {
    "name": "切断グループ",
    "machines": ["切断機A", "切断機B"]
  }
]
```

- `name`: 設備グループ名
- `machines`: グループに所属する設備名の配列

### 02_products.json - 製品定義

```json
[
  {
    "name": "製品A",
    "code": "PROD-A",
    "type": "standard"
  }
]
```

- `name`: 製品名
- `code`: 製品コード（他のJSONファイルでの参照に使用）
- `type`: 製品種別（例: "standard", "custom"）

### 03_routings.json - 工程定義

```json
[
  {
    "product_code": "PROD-A",
    "routings": [
      {
        "process_name": "切断工程",
        "group_name": "切断グループ",
        "sequence_order": 1,
        "unit_time_seconds": 600,
        "setup_time_seconds": 1800
      }
    ]
  }
]
```

- `product_code`: 製品コード（`02_products.json` で定義したコードを参照）
- `routings`: 工程の配列
  - `process_name`: 工程名
  - `group_name`: 設備グループ名（`01_groups.json` で定義した名前を参照）
  - `sequence_order`: 工程の順序（1から始まる連番）
  - `unit_time_seconds`: 単位時間（秒）
  - `setup_time_seconds`: セットアップ時間（秒）

### 04_orders.json - 注文データ

```json
[
  {
    "order_number": "ORD-001",
    "product_code": "PROD-A",
    "quantity": 100,
    "deadline_date": "2025-01-15"
  }
]
```

- `order_number`: 注文番号
- `product_code`: 製品コード（`02_products.json` で定義したコードを参照）
- `quantity`: 数量
- `deadline_date`: 納期（YYYY-MM-DD形式、オプション）

## 新しいシナリオの作成

1. `data/scenarios/` 配下に新しいディレクトリを作成
2. 上記フォーマットに従って JSON ファイルを作成
3. スクリプトを実行: `python scripts/seed_scenario.py <シナリオ名>`

例：

```bash
mkdir -p data/scenarios/test_scenario
# JSONファイルを作成...
python scripts/seed_scenario.py test_scenario
```

## 注意事項

- データ投入順序は `01_`, `02_`, `03_`, `04_` のファイル名プレフィックスで制御されます
- 工程や注文の定義では、「名前/コード」でリレーションを記述し、スクリプトが自動的にIDに解決します
- 既存のデータは削除されません（追加のみ）
- 同じシナリオを複数回実行すると、データが重複登録されます
- RLS（Row Level Security）が有効なため、認証されたユーザーのテナントIDに紐づいてデータが登録されます

## トラブルシューティング

### 環境変数が設定されていない

```
❌ Error: Required environment variables are missing: ...
```

→ `.env` ファイルに必要な環境変数が設定されているか確認してください。

### 認証に失敗する

```
❌ Error: Failed to get access token
```

→ `TEST_USER_EMAIL` と `TEST_USER_PASS` が正しいか、Supabase でユーザーが作成されているか確認してください。

### シナリオディレクトリが見つからない

```
❌ Error: Scenario directory not found: ...
```

→ `data/scenarios/<シナリオ名>` ディレクトリが存在するか確認してください。

### データの参照エラー

```
⚠️  Product code not found: PROD-X, skipping...
```

→ JSON ファイル内で参照している `product_code` や `group_name` が、前のステップで定義されているか確認してください。
