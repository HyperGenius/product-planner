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
| `reset_dev_db.py` | ローカルSupabaseのリセット・起動・デモデータ投入を一括実行 | `python scripts/reset_dev_db.py [シナリオ名]` |
| `seed_scenario.py` | シナリオ単位のデモデータ一括投入 | `python scripts/seed_scenario.py <シナリオ名>` |
| `seed_gmail_drafts.py` | Gmail受注下書きサンプルデータ投入 | `python scripts/seed_gmail_drafts.py` |

---

## reset_dev_db.py — 開発用ローカルDBのリセット＆デモデータ投入

ローカル開発環境をクリーンな状態にしてデモデータ投入まで一括で行うラッパースクリプトです。以下を順に実行します。

1. `supabase db reset` — ローカルDBをマイグレーション済みのクリーンな状態にリセット
2. `supabase start` — ローカルSupabaseスタックを起動（起動済みの場合はそのまま）
3. `seed_scenario.py <シナリオ名>` — シナリオデータを投入（省略時は `standard_demo`）

### 使い方

```bash
# standard_demo を投入する場合
python scripts/reset_dev_db.py

# 任意のシナリオを指定する場合
python scripts/reset_dev_db.py <シナリオ名>
```

### 前提条件

- ローカルに `supabase` CLI がインストールされ、PATH が通っていること
- 上記「共通前提条件」の環境変数（`.env`）が設定されていること

### 安全チェック

`supabase db reset` を実行する前に `.env` の `SUPABASE_URL` を出力し、ホスト名が
`localhost` / `127.0.0.1` 以外の場合はエラーで中断します。誤って本番/ステージング
向けの設定のまま実行してしまう事故を早期に検知するためのものです。

> ただし `supabase db reset`（`--linked` 等を付けない実行）は元々ローカルの
> Docker上のPostgresしか対象にしないため、このチェックが直接「本番を壊す」のを
> 防ぐわけではありません。あくまで `.env` の設定ミスに早期に気付くための保険です。

### 注意事項

- `supabase db reset` はローカルDBの全データを消去します。本番/開発共有環境では絶対に使用しないでください（あくまでローカル開発専用）
- 内部的に `seed_scenario.py` の `seed_scenario()` 関数を直接呼び出しているため、投入処理自体の仕様は `seed_scenario.py` セクションを参照してください

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

バックエンドAPIを経由してデータを登録します（直接DBアクセスなし）。

### 追加の前提条件

- バックエンドが起動していること（`uvicorn app.main:app --reload --port 8000`）
- `SUPABASE_API_KEY`（`get_token.py` が参照するキー）
- `BACKEND_URL`（省略時: `http://localhost:8000`）

> **注意:** 先に `seed_scenario.py standard_demo` を実行して製品データを用意してください。`orders.json` 内の製品コードが見つからない場合はその注文はスキップされます。

### 投入されるデータ

`backend/data/gmail_drafts/orders.json` に定義された3パターン × 2件、計6件の `draft` 受注を作成します。

| パターン | `product_id` | `product_candidates` | 説明 |
|----------|-------------|----------------------|------|
| A（単一マッチ済み） | 解決済み | null | Claudeが1件に絞り込んだケース |
| B（複数候補あり） | null | JSON配列あり | 候補が複数あり、ユーザーが選択するケース |
| C（マッチなし） | null | null | 製品を特定できなかったケース |

### 使い方

```bash
# 実際に投入する
python scripts/seed_gmail_drafts.py

# DBに書き込まず投入予定内容を確認する（ドライラン）
python scripts/seed_gmail_drafts.py --dry-run
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
