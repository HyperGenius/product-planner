# スクリプト使い方ガイド

---

## seed_gmail_drafts.py — Gmail受注下書きサンプルデータ投入

Gmail連携機能（GMAIL_ORDER_INTAKE）で生成される下書き受注（`source_type='email'`）のサンプルデータをローカル開発環境に投入します。下書き確認UI開発・動作確認用です。

### 投入されるデータ

`backend/data/gmail_drafts/orders.json` に定義された以下の3パターン × 2件、計6件の `draft` 受注が作成されます。

| パターン | `product_id` | `product_candidates` | 説明 |
|----------|-------------|----------------------|------|
| A（単一マッチ済み） | 解決済み | null | Claudeが1件に絞り込んだケース |
| B（複数候補あり） | null | JSON配列あり | 候補が複数あり、ユーザーが選択するケース |
| C（マッチなし） | null | null | 製品を特定できなかったケース |

### 前提条件

以下の環境変数が `.env` に設定されている必要があります（`seed_scenario.py` と共通）。

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `TEST_USER_EMAIL`
- `TEST_USER_PASS`
- `TEST_TENANT_ID`

> **注意:** `standard_demo` シナリオ（`seed_scenario.py standard_demo`）を先に実行して製品データが存在していること。製品コードが見つからない場合はその注文はスキップされます。

### 使い方

```bash
# backend ディレクトリで実行
python scripts/seed_gmail_drafts.py
```

### 実行例

```
============================================================
🚀 Seeding Gmail draft orders
============================================================
✅ Authenticated as admin@example.com

📦 Fetching product map...
  Found 5 products: ['PRD-A001', 'PRD-B002', 'PRD-C003', 'PRD-D004', 'PRD-E005']

📦 Inserting draft orders...
  ✓ GMAIL-SEED-A001 — パターンA（単一マッチ）
  ✓ GMAIL-SEED-A002 — パターンA（単一マッチ）
  ✓ GMAIL-SEED-B001 — パターンB（複数候補）
  ✓ GMAIL-SEED-B002 — パターンB（複数候補）
  ✓ GMAIL-SEED-C001 — パターンC（マッチなし）
  ✓ GMAIL-SEED-C002 — パターンC（マッチなし）

============================================================
✅ Done: 6 orders inserted/updated, 0 skipped
============================================================
```

冪等性が保証されているため、複数回実行しても重複インサートは発生しません。

---

## seed_scenario.py — シナリオデータ投入

このスクリプトは、指定されたシナリオに基づいてSupabaseデータベースにデモデータを投入するためのツールです。
順序依存関係を考慮して、設備、製品、工程、注文データを一括で登録します。

## 前提条件

### 1. 環境設定
以下の環境変数が `.env` ファイルに設定されている必要があります。

- `SUPABASE_URL`: SupabaseのプロジェクトURL
- `SUPABASE_API_KEY`: Supabaseのサービスロールキー（またはanonキー）
- `TEST_USER_EMAIL`: データ投入に使用するユーザーのメールアドレス
- `TEST_USER_PASS`: データ投入に使用するユーザーのパスワード
- `TEST_TENANT_ID`: データを投入するテナントのID

### 2. データファイル
データは以下のディレクトリ構成で配置されている必要があります。
`backend/data/scenarios/<シナリオ名>/` に以下のJSONファイルが必要です。

1. `01_groups.json`: 設備グループと設備の定義
2. `02_products.json`: 製品の定義
3. `03_routings.json`: 製造工程（ルーティング）の定義
4. `04_orders.json`: 注文データの定義

## 使い方

`backend` ディレクトリ直下で以下のコマンドを実行します。

```bash
# 仮想環境が有効であることを確認してください
python scripts/seed_scenario.py <シナリオ名>
```

### 実行例

`standard_demo` シナリオ（標準デモデータ）を投入する場合:

```bash
python scripts/seed_scenario.py standard_demo
```

## 処理の流れ

スクリプトは以下の順序でデータを処理・登録します。

1. **認証**: 環境変数の情報を使ってSupabaseにサインインします。
2. **設備・グループ定義 (`01_groups.json`)**: 
   - 設備グループ (`equipment_groups`) を作成
   - 設備 (`equipments`) を作成
   - グループと設備の紐付け (`equipment_group_members`) を作成
3. **製品定義 (`02_products.json`)**:
   - 製品 (`products`) を作成
4. **工程定義 (`03_routings.json`)**:
   - 製品コードと設備グループ名を解決し、工程 (`process_routings`) を登録
5. **注文定義 (`04_orders.json`)**:
   - 製品コードを解決し、注文 (`orders`) を登録

## エラーハンドリング

- 必要な環境変数が不足している場合、エラーメッセージを表示して終了します。
- 指定されたシナリオディレクトリが存在しない場合、エラーになります。
- データの整合性が取れない場合（例：存在しない製品コードを参照している等）、その項目はスキップされ警告が表示されます。
