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
| `seed_split_demo.py` | 手動分割機能（Issue #280）確認用の下書き注文投入 | `python scripts/seed_split_demo.py` |
| `issue_agent_token.py` | 日報取り込みエージェント用トークンの発行・一覧・失効（Issue #469） | `python scripts/issue_agent_token.py <issue\|list\|revoke> ...` |
| `equipment_ledger/apply_equipment_ledger.py` | 設備台帳 CSV を設備マスタに反映（Issue #486） | `python scripts/equipment_ledger/apply_equipment_ledger.py --tenant-id ... --csv ... [--mapping ...] [--dry-run]` |

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

## seed_split_demo.py — 手動分割機能（Issue #280）確認用データ投入

`POST /orders/{order_id}/split`（1件の下書き注文を複数の下書き注文に手動分割する機能）を
手元のブラウザで確認するためのデモデータを投入します。実際のメール受信・抽出パイプラインは
通さず、「1通のメールに複数月分の内示数量が誤って1件にマージされてしまった」想定の
draft注文と、その起票元となる `order_attachments` のステージング行を直接投入します。

### 追加の前提条件

- `.env` に共通の環境変数（`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `TEST_USER_EMAIL`,
  `TEST_USER_PASS`, `TEST_TENANT_ID`）が設定されていること（`seed_scenario.py` と共通）
- `order_attachments` のRLSポリシーは他テーブルと同じ `is_tenant_member(tenant_id)` に
  統一済み（Issue #280 Phase3、`20260710000000_fix_order_attachments_rls_tenant_member.sql`）
  のため、通常の認証済みクライアントのみで投入できる（service role key は不要）

### 使い方

```bash
python scripts/seed_split_demo.py
```

冪等性: 固定の `gmail_message_id`（`seed-split-demo-b115105`）で検索するため、複数回実行しても
重複しない。実行後に表示される `orders.id` を使い、フロントエンドで `/orders/{id}` を開くと
「分割」ボタンが表示される。

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

---

## issue_agent_token.py — 日報取り込みエージェント用トークンの発行・一覧・失効

共有PCで動く日報取り込みエージェント（Issue #468）がバックエンドに送信するときに使う、テナント単位の
Bearer トークンを管理します。仕様は [docs/features/daily-report-agent.md](../../docs/features/daily-report-agent.md) を参照してください。

### 追加の前提条件

共通前提条件とは異なり、**service role で `agent_tokens` を直接読み書きする**運用スクリプトです
（`create_tenant.py` と同じ扱い）。`--env-file` で指定した .env（省略時は `scripts/.env`）に以下を設定してください。

| 変数名 | 説明 |
|--------|------|
| `SUPABASE_URL` | 発行先の Supabase の URL（本番に発行する場合は本番の URL） |
| `SUPABASE_SERVICE_ROLE_KEY` | 同 service role キー |

### 使い方

```bash
cd backend

# 発行: 平文トークンはこの1回しか表示されない（DB には SHA-256 ハッシュのみ保存）
python scripts/issue_agent_token.py issue --tenant-id <tenant_uuid> --name "工場1F 共有PC"

# 一覧: 有効/失効済み・最終利用日時を確認する（ハッシュは表示しない）
python scripts/issue_agent_token.py list --tenant-id <tenant_uuid>

# 失効: 共有PCの入れ替え・漏洩時に使う。失効後は新しいトークンを issue し直す
python scripts/issue_agent_token.py revoke --token-id <token_uuid>
```

### 注意事項

- 表示された平文トークンは共有PCのエージェント設定に登録したら、端末のスクロールバック等に残さないこと。
  紛失した場合は再表示できないため、`revoke` して `issue` し直す
- `--name` には設置場所など識別用の名前を入れる。顧客の実名や端末の実ホスト名をリポジトリ・Issue に書かないこと

---

## equipment_ledger/apply_equipment_ledger.py — 設備台帳の反映（Issue #486）

顧客の設備台帳（正典）を設備マスタ `equipments` に反映する。既存の設備は `id` を維持したまま
名称を台帳に合わせ、台帳の列（台帳番号・メーカー・型式・製造年月・製造番号・備考）を埋める。
名称が変わる設備は旧名称を呼称（`short_name`、画面表示に使う短い名前）として残す。
台帳にあってマスタに無い設備は新規登録する。仕様は
[docs/features/equipment-master-ux-design.md](../../docs/features/equipment-master-ux-design.md#設備台帳との対応issue-486) を参照。

### 追加の前提条件

- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`（運用スクリプトのため service role で接続し、`--tenant-id` で絞り込む）
- **台帳の実データはリポジトリに含めない。** CSV は `backend/scripts/equipment_ledger/_data/`（git 管理外）に置く

### CSV の形式（UTF-8。Excel の BOM 付きも可）

| ファイル | 列 |
|---|---|
| 台帳（`--csv`） | `ledger_no,name,maker,model,manufactured_on,serial_no,note[,short_name]`（`ledger_no` / `name` 必須。空欄は NULL。`name` は重複してよい） |
| 対応表（`--mapping`） | `current_name,ledger_no`（既存設備の現在の名称 → 台帳番号。`current_name` は呼称として残る） |

対応表に無い台帳の行は、同名の既存設備（台帳番号未設定）が1台だけあればそれに対応付け、無ければ新規登録する
（同名の既存設備が複数ある・台帳に同名の行が複数ある場合はエラーにするので、対応表で指定する）。

`short_name`（呼称、任意）は呼称が未設定の設備にだけ設定する。設備名は一意ではなく、一意なのは表示名（呼称、無ければ設備名。
Issue #501）なので、**台帳に同名の設備があって新規登録する場合は `short_name` で区別できる呼称を指定する**
（指定しないと表示名の重複でエラーになる）。

### 使い方

```bash
cd backend

# 1. 変更内容を確認する（DB には書き込まない）
python scripts/equipment_ledger/apply_equipment_ledger.py \
    --tenant-id <tenant_uuid> \
    --csv scripts/equipment_ledger/_data/ledger.csv \
    --mapping scripts/equipment_ledger/_data/mapping.csv \
    --dry-run

# 2. 問題なければ --dry-run を外して反映する
python scripts/equipment_ledger/apply_equipment_ledger.py --tenant-id <tenant_uuid> \
    --csv scripts/equipment_ledger/_data/ledger.csv --mapping scripts/equipment_ledger/_data/mapping.csv
```

### 注意事項

- 呼称が設定済みの設備は呼称を上書きしない
- 設備と同名でメンバーがその設備1台だけの設備グループは、設備の表示名（呼称、無ければ台帳の名称）に名称を揃える
  （ガントチャートはグループ名を表示するため）。グループ構成は変えない
- 呼称導入前の版で反映済みの環境は、同じ台帳・対応表で再実行すると対応表の `current_name` から呼称を復元し、
  台帳の名称に変わった1台グループを呼称に戻す（マイグレーション `20261002000000_add_short_name_to_equipments.sql` の適用が先に必要）
- 新規登録した設備はどの設備グループにも属さない。工程で使う場合は設備マスタ画面でグループに追加する
- PostgREST 経由のためトランザクションにはならない。途中で失敗した場合はそのまま再実行すれば続きから反映される
  （台帳番号を先に書き込み、再実行時は台帳番号で同じ設備に当たる）。反映済みの状態で再実行しても変更は出ない
- 対応表・台帳の不整合（対応表の設備が無い、反映後に設備名が重複する等）があると、何も書き込まずにエラーで終了する
