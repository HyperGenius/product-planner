# シナリオデータ投入スクリプト (seed_scenario.py)

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
