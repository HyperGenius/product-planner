# スクリプト使い方ガイド

## 共通前提条件

`backend/scripts/` 配下のスクリプトはすべて以下の前提を共有しています。

### 環境変数

`backend/.env` に以下を設定してください。

| 変数名 | 説明 |
|--------|------|
| `SUPABASE_URL` | ローカル Supabase の URL（`supabase start` で表示される `API URL`） |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase の anon/publishable キー |
| `TEST_USER_EMAIL` | データ投入に使うユーザーのメールアドレス |
| `TEST_USER_PASS` | 同パスワード |
| `TEST_TENANT_ID` | データを投入するテナントの UUID |

### 実行環境

```bash
# backend ディレクトリで仮想環境を有効にしてから実行
cd backend
source .venv/bin/activate   # または Windows: .venv\Scripts\activate
```

### ローカル Supabase の起動

```bash
supabase start
```

---

## スクリプト一覧

| スクリプト | 用途 | 実行コマンド |
|-----------|------|-------------|
| `seed_scenario.py` | シナリオ単位のデモデータ一括投入 | `python scripts/seed_scenario.py <シナリオ名>` |
| `seed_gmail_drafts.py` | Gmail受注下書きサンプルデータ投入 | `python scripts/seed_gmail_drafts.py` |

---

## seed_scenario.py — シナリオデータ投入

指定されたシナリオに基づいて Supabase にデモデータを投入します。設備・製品・工程・注文の順序依存関係を考慮して一括登録します。

### データファイル構成

`backend/data/scenarios/<シナリオ名>/` に以下の JSON を配置します。

| ファイル | 内容 |
|----------|------|
| `01_groups.json` | 設備グループと設備の定義 |
| `02_products.json` | 製品の定義 |
| `03_routings.json` | 製造工程（ルーティング）の定義 |
| `04_orders.json` | 注文データの定義 |

### 使い方

```bash
python scripts/seed_scenario.py <シナリオ名>

# 例: 標準デモデータ
python scripts/seed_scenario.py standard_demo
```

### 処理の流れ

1. **認証** — 環境変数でサインインし JWT を取得
2. **設備・グループ** — `equipment_groups` / `equipments` / `equipment_group_members` を作成
3. **製品** — `products` を作成
4. **工程** — 製品コード・グループ名を解決し `process_routings` を登録
5. **注文** — 製品コードを解決し `orders` を登録

各ステップは UPSERT のため、複数回実行しても安全です。

### エラーハンドリング

- 環境変数不足 → エラーメッセージを表示して終了
- シナリオディレクトリ不在 → エラー終了
- 参照先コードが見つからない場合 → 該当行をスキップして警告表示

---

## seed_gmail_drafts.py — Gmail受注下書きサンプルデータ投入

Gmail連携機能（GMAIL_ORDER_INTAKE）で生成される下書き受注（`source_type='email'`）のサンプルをローカルに投入します。下書き確認UI（フェーズ7）の開発・動作確認用です。

> **注意:** 製品データが必要なため、先に `seed_scenario.py standard_demo` を実行してください。

### 投入されるデータ

`backend/data/gmail_drafts/orders.json` に定義された3パターン × 2件、計6件の `draft` 受注を作成します。

| パターン | `product_id` | `product_candidates` | 説明 |
|----------|-------------|----------------------|------|
| A（単一マッチ済み） | 解決済み | null | Claudeが1件に絞り込んだケース |
| B（複数候補あり） | null | JSON配列あり | 候補が複数あり、ユーザーが選択するケース |
| C（マッチなし） | null | null | 製品を特定できなかったケース |

### 使い方

```bash
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
