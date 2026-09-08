# CLAUDE.md — このプロジェクトでの作業ガイドライン

このファイルは、Claude Code がこのリポジトリで作業する際の規約・構造・判断基準を記述します。

---

## プロジェクト概要

中小製造業向けの生産計画 SaaS。受注入力 → シミュレーション → 確定 のワークフローで、設備ごとのガントチャート表示・手動調整まで対応するマルチテナントシステム。(詳細は[product_planner_knowledge.md](docs/product_planner_knowledge.md) 参照)

- **Backend**: FastAPI (Python) + Supabase (PostgreSQL)、Cloud Run 上で uvicorn により稼働
- **Frontend**: Next.js 14+ (App Router) + TanStack Query + shadcn/ui
- **Multi-tenancy**: Supabase Auth + Row Level Security (RLS)

詳細なシステム設計は [Agent.md](Agent.md) および [docs/](docs/) を参照してください。

---

## ディレクトリ構造

```
backend/app/
  routers/master/       # マスタデータ API (製品・設備・カレンダー等)
  routers/transaction/  # 業務データ API (注文・スケジュール)
  routers/tenant/       # テナントメンバー管理 API
  repositories/         # Supabase データアクセス層
  scheduler_logic.py    # コアスケジューリングアルゴリズム
  services/             # カレンダー・シミュレーションサービス

frontend/src/
  app/                  # Next.js App Router ページ
  components/           # React コンポーネント
  hooks/                # TanStack Query カスタムフック
  gantt/                # カスタムガントチャート実装 (gantt-task-react は削除済み)
  types/                # TypeScript 型定義

supabase/migrations/    # DB スキーマ変更は必ずここで管理
docs/                   # 設計・仕様ドキュメント
docs/features/          # 機能別ドキュメント (PR 完了後に更新)
```

---

## 主要コマンド

```bash
# Backend 起動
cd backend && uvicorn app.main:app --reload --port 8000

# Frontend 起動
cd frontend && npm run dev

# ローカル Supabase 起動
supabase start

# テスト
cd backend && pytest __tests__/unit/           # Unit (DB不要)
cd backend && pytest __tests__/api/            # API Functional (DB不要)
cd backend && pytest __tests__/integration/    # Integration (Supabase必要)

# Lint / 型チェック
cd backend && ruff check . && mypy .
```

- `ruff` / `mypy` / `pytest` は venv 前提。PATH に無い環境（新規 worktree 等）では
  `cd backend && uv pip install -q -r requirements-dev.txt` 後に `uv run --no-sync <cmd>` で実行する
- `ruff check .` はリポジトリ全体だと既存の未修正エラーが多数ある（主に `scripts/`）。
  自分の変更が増やしていないかは変更ファイルを指定して確認する（例: `uv run --no-sync ruff check path/to/file.py`）
- **ruff の実行はリポジトリルートから行う**: `cd backend` して `ruff check` すると isort の
  first-party 判定が変わり、`app` / サードパーティのインポートグループ分けが pre-commit / CI
  （どちらもルートから `ruff check --config=backend/pyproject.toml backend/` で実行）と食い違う。
  自分の変更が I001 を増やしていないかは
  `ruff check --config=backend/pyproject.toml backend/path/to/file.py` で確認する
- コミット時に pre-commit（`ruff` / `ruff-format` / `mypy`）が走り、`ruff-format` は自動整形して
  コミットを一旦中断する。整形後に `git add` して再コミットする

---

## 重要な実装ルール

- **RLS 必須**: 新規テーブルには必ず `ENABLE ROW LEVEL SECURITY` と `is_tenant_member(tenant_id)` ポリシーを設定
- **Service Role Key 禁止**: アプリコード内で `SUPABASE_SERVICE_ROLE_KEY` を使用しない。必ずユーザー JWT を使用
- **DB 変更**: `supabase/migrations/` に SQL ファイルを追加すること。直接スキーマ変更禁止
- **`upsert_order_by_dedupe_key` の再定義**: このRPCは何度も `CREATE OR REPLACE` で更新されており、
  DEFAULT 付き引数の追加でシグネチャが変わっている。**必ず最新シグネチャの本文をベースにする**
  （現在は `20260902000000_add_customer_order_extraction_prompt.sql` の11引数版＝`p_customer_order_no` 付き）。
  古いマイグレーションの本文をコピーすると廃止済みの引数少ないオーバーロードが復活し、アプリが実際に
  呼ぶ関数に変更が入らない。旧シグネチャは冒頭で `DROP FUNCTION IF EXISTS upsert_order_by_dedupe_key(...)`
  してから作り直す。ローカルで `supabase db reset` 後に `pg_proc` のオーバーロードが1つだけか確認すること
- **受注ステータス (`orders.status`)**: 取り得る値は `draft` / `pending_approval` / `confirmed` /
  `in_progress`（生産中）/ `shipped` / `completed` / `canceled`。遷移バリデーションは
  `services/order_status_service.py` の `ORDER_STATUS_TRANSITIONS`。`in_progress` は着手日
  （`scheduling_start_date` → 無ければ最早工程の `production_schedules.start_datetime`）の到来で
  cron が `confirmed ⇄ in_progress` を自動遷移させる（`GET /api/cron/advance-order-status`、
  Issue #400）。フロントの取り得る値は `frontend/src/types/order.ts` の `Order["status"]` と
  `order-utils.ts`（ラベル／バッジ／タブ）を同時に更新する。詳細は
  [docs/features/order-status-workflow.md](docs/features/order-status-workflow.md)
- **ガントチャート**: `frontend/src/gantt/` のカスタム実装を使用。`gantt-task-react` は削除済みのため参照しない
- **ダッシュボード**: `app/page.tsx` は `components/dashboard/DashboardRouter` を描画するだけ。`DashboardRouter` が
  `useCurrentMember().role` で `PresidentDashboard`（`president`）／`DefaultDashboard`（それ以外・ロール未取得中の
  フォールバック）を出し分ける。`useOrders()` / `useProducts()` / `useDashboardMetrics()` は **`DashboardRouter` で
  1回だけ**呼び、各ダッシュボードには props で渡す（ロール判明時の再マウントで再フェッチさせないため）。
  各ダッシュボード・配下のパーツ（`KpiCards` 等）は表示専用。集計は `hooks/use-dashboard-metrics.ts`。
  Epic #399（Issue #401 が基盤、KPI 差し替え #ISSUE_D／承認待ちキュー #ISSUE_B／リスクカード #ISSUE_C）。
  詳細は [docs/features/dashboard-ui-improvement.md](docs/features/dashboard-ui-improvement.md)
- **データ取得**: TanStack Query (`useQuery` / `useMutation`) で統一。`useEffect` でのフェッチ禁止
- **型安全**: Backend の Pydantic スキーマと Frontend の TypeScript interface を一致させること
  - Union 文字列型（`Order["status"]` 等）でルックアップテーブルを引くときは `Record<string, T>` ではなく
    `Record<Order["status"], T>` で全ケースを明示する。値が増えたときに型エラーで気づける（PR #409）
- **日付文字列のパース（Frontend）**: `orders` の `confirmed_deadline` / `simulated_deadline` /
  `desired_deadline` / `scheduling_start_date` / `order_date` 等は**日付のみ（`"YYYY-MM-DD"`、時刻を持たない）**。
  `new Date("2026-09-08")` は **UTC 深夜**として解釈されるため、端末のタイムゾーン次第で日付が前日にズレる
  （「今日の納期」カウントや一覧の表示日付が1日ずれる）。日付のみのフィールドは必ず
  `parseISO()`（`date-fns`、ローカル深夜として解釈）でパースする。`created_at` 等の**タイムスタンプ**
  （時刻・TZ 付き）は `new Date()` で可（PR #409）
- **受注の納期フィールド**: `orders` には完成見込み日が2本ある。`confirmed_deadline`（承認確定時＝`dry_run=False` に書き込み）と `simulated_deadline`（`POST /orders/{id}/simulate` ＝ `dry_run=True` に書き込み、承認前の「シミュ納期」表示用。Issue #394）。両者は `_deadline_from_schedules()`（`routers/transaction/orders.py`）で同一ロジック（最終工程終了日時 → date）で算出する。`PATCH /orders/{id}` で `product_id` / `quantity` / `deadline_date` / `scheduling_start_date` が変わると `simulated_deadline` と `is_scheduled` はクリアされる（`reject` / `withdraw` は据え置き）。詳細は [docs/features/simulation-engine.md](docs/features/simulation-engine.md)
- **メンバーロール**: `organization_members.role` は `president`（社長）/ `iso_officer`（ISO担当）/ `order_handler`（受注担当）/ `platform_admin`（プラットフォーム管理者）の四値（Issue #323）。旧 `admin`/`member` は廃止済み。メンバー管理系エンドポイントは `president`/`platform_admin` に開放し、承認操作（工程確定 `is_confirmed` 等）は `platform_admin` を含めず `president` 限定とする方針。詳細は [docs/features/member-roles.md](docs/features/member-roles.md) 参照

## 本番 Supabase への接続（マイグレーション適用・一時的なSQL実行）

- このプロジェクトの本番DBは **direct connection (`db.<ref>.supabase.co`) が名前解決できない**（IPv4アドオン未設定等の理由と推測）。`supabase db push --linked` は Management API 経由で一時ログインロールを作成する際に `permission denied to alter role` で失敗することがある
- 代わりに **セッションプーラー経由の `--db-url`** を使うこと。リージョンは `ap-northeast-1`（Tokyo）で、`aws-0-...` ではなく `aws-1-ap-northeast-1.pooler.supabase.com` が有効だった（`aws-0` は `tenant/user not found` で失敗）
  ```bash
  # プロジェクトref・パスワードは backend/.env の SUPABASE_PROJECT_ID / SUPABASE_DB_PASSWORD を利用
  # パスワードは percent-encode が必要
  supabase db push --db-url "postgresql://postgres.<project-ref>:<url-encoded-password>@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres"

  # 一時的なSQL実行（本番データの確認・単発の手動UPDATE等）
  supabase db query --db-url "postgresql://postgres.<project-ref>:<url-encoded-password>@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres" "SELECT ..."
  ```
- 本番への `db push` / 直接SQL実行は不可逆な操作のため、必ず `--dry-run`（push の場合）や `SELECT` での事前確認を行い、ユーザーの明示的な承認を得てから実行すること

## 定期実行（cron）

- 経路は3段: **pg_cron（Supabase、手動登録）→ Edge Function `supabase/functions/parse-order-pdfs-trigger/index.ts` → バックエンドの `GET /api/cron/*`**（`CRON_SECRET` の Bearer 認証、`routers/cron/_auth.py` の `validate_cron_secret`）。Edge Function は1回の起動で全 `/api/cron/*` を順に叩く薄いプロキシ。詳細は [docs/infra/supabase-pgcron-parse-order-pdfs.md](docs/infra/supabase-pgcron-parse-order-pdfs.md)
- **新しい定期処理を足すとき**: (1) `backend/app/routers/cron/` にルーターを追加し `cron/__init__.py` と `app/main.py` に登録、(2) `parse-order-pdfs-trigger/index.ts` に `callCronEndpoint(...)` 呼び出しを1行追加。**新しい pg_cron ジョブの登録は不要**（既存トリガーに相乗りする）
- cron は高頻度（10〜15分間隔）で回るため、処理は**冪等**に作る。全テナント横断で動くので `get_supabase_admin_client()` を使う（権限チェックは `CRON_SECRET` で代替）
- エラー時のレスポンスに例外メッセージ（`{exc}`）をそのまま入れない。詳細は `logger.error(..., exc_info=True)` でログにのみ残し、レスポンスは固定文言にする

## Git ワークフロー

### Issueの起票ルール
- Issueは必ず `.github/ISSUE_TEMPLATE/` ディレクトリにあるテンプレートを参照してから起票すること

### 実データ（PII・顧客情報）の取り扱い
- **Issue・PR・コミットメッセージ・`docs/` に実データを書かないこと。** 具体的には、実在の
  メールアドレス（例: 社長・顧客・仕入先のアドレス）、顧客企業名・担当者名・電話番号・住所、
  本番の `gmail_message_id` 等
- 調査で実データを参照する必要がある場合は、手元の作業に留め、公開物には次のように書き換える:
  - メールアドレス・氏名 → 役割で表現（「社長（社内の共通メールアカウント）」「顧客担当者」等）
  - 企業名 → 「顧客A社 / B社」等の記号
  - 例示が必要な場合は `example.com` ドメイン等のダミー値を使う
- テストのフィクスチャに実データを埋め込まないこと（ダミー値 or 匿名化した値を使う）

### Issueの作業ルール
- Issueに着手する前に必ずブランチを作成すること
- ブランチ命名規則: `feature/issue-{番号}-{概要}` または `fix/issue-{番号}-{概要}`

### Pull Requestのルール
- 作業が完了したらプルリクエストを作成すること
- プルリクエストを作成したら必ず `docs/features` ディレクトリ内の該当ドキュメントを更新すること

### ドキュメントの配置方針（`docs/features` と Wiki の使い分け）
- `docs/features/`: 開発者向けドキュメント。実装（エンドポイント・ファイルパス・データモデル等）と結びつく内容はここに書き、コード変更と同じPRでレビュー・更新する
- [Wiki](https://github.com/HyperGenius/product-planner/wiki): 顧客・現場担当者向けの運用マニュアル（操作手順書等）。`docs/features` は開発者が読むには数が多くなりすぎるため、対象読者が非エンジニアの手順書はWikiに分離する。PRレビュー対象外のため、コードと無関係に随時更新してよい
- 機能追加時に両方の対象読者向けドキュメントが必要な場合は、`docs/features/` 側に該当Wikiページへのリンクを記載すること（例: [docs/features/device-trust-pin-auth.md](docs/features/device-trust-pin-auth.md)）
