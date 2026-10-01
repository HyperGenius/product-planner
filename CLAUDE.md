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
    orders/             # 受注 API はパッケージ化済み（責務別ファイル、Issue #376）
  routers/tenant/       # テナントメンバー管理 API
  routers/daily_reports/  # 日報の名寄せ・別名辞書 API（Issue #488）
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
tools/daily-report-agent/  # 共有PC上で動く日報取り込みエージェント (PowerShell 5.1、Issue #472)
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
cd frontend && npm run test                    # Frontend Unit (Vitest, DB/サーバー不要)
cd frontend && npm run test:e2e                # Frontend E2E (Playwright, Supabase+両サーバー必要)

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
  - **例外**: ユーザー JWT を持たないリクエストだけは `get_supabase_admin_client()`（service role）を使う。
    cron（`CRON_SECRET` で認可）、共有端末の PIN ログイン（`routers/auth/device.py`）、日報取り込みエージェント
    （`routers/agent/`、Issue #470）が該当する。service role は RLS をバイパスするため、**`tenant_id` は必ずサーバー側で
    検証済みの値（エージェントならトークン → `agent_tokens` の行）から解決し、リクエストのボディ・ヘッダ・クエリの
    `tenant_id` は使わない**。以降のクエリはすべて `.eq("tenant_id", tenant_id)` でアプリ側から明示的に絞り込む。
    エージェント API は `Depends(get_agent_context)` で `AgentContext` を受け取り、その値だけを使うこと。
    詳細は [docs/features/daily-report-agent.md](docs/features/daily-report-agent.md)
- **Storage の「上書きしない」アップロード**: `upload(..., file_options={"upsert": "false"})` で既存キーに書くと
  storage3 は `StorageApiError` を投げ、実 Storage では `status == "409"`（文字列）/ `code == "Duplicate"` になる
  （ローカル Supabase で確認済み。既存オブジェクトは上書きされない）。重複を正常系として扱う場合はこれで判定し、
  それ以外の `StorageApiError` は再送出する（`daily_report_service._upload_if_absent()`、Issue #471）
- **Storage のオブジェクトキーと content-type**: 日本語ファイル名をキーに使わない場合でも、ダウンロードしてそのまま
  開けるよう元ファイル名の拡張子（ASCII 英数字のみ・小文字化）はキー末尾に付ける。content-type は `mimetypes` で
  推測しない（本番の `python:3.11-slim` は `/etc/mime.types` が無く、Python バージョンによって `.xlsx` を解決できない）。
  扱う拡張子を明示した対応表で持つ（`daily_report_service.storage_extension()` / `content_type_for()`）
- **raw body（octet-stream）を受けるエンドポイント**: `UploadFile` を使わずボディを直接受ける場合は
  `async def` にして `request.stream()` で読みながらサイズ上限（`Content-Length` 省略のチャンク転送に備えて
  宣言値と実測値の両方）とハッシュを検証し、同期の supabase-py 呼び出しは `run_in_threadpool` で実行する。
  認証 dependency（同期 `def`）はボディを読む前に走るので、未認証リクエストで上限まで読むことはない。
  前例は `routers/agent/daily_reports.py`。上限定数はルーターが `from ... import` しているため、テストでは
  ルーターモジュール側を `monkeypatch.setattr()` する。API テストでチャンク転送を再現するには
  `TestClient.post(..., content=iter([...]))`（httpx が `Content-Length` 無しで送る）
- **共有PC用の PowerShell スクリプト（`tools/`）**: 顧客の Windows PC で動かすため **PowerShell 5.1・追加モジュール無し**で
  動くように書く（`??`・三項演算子・`-SkipHttpErrorCheck` 等の PS 7 専用構文は使わない）。日本語を含む `.ps1` は
  **BOM 付き UTF-8** で保存する（PS 5.1 は BOM 無しを Shift-JIS として読み文字化けする）。.NET メソッドの string 引数に
  `$null` を渡すと PowerShell が `""` に変換するので `[NullString]::Value` を使う（`File.Replace` の第3引数で踏んだ）。
  ローカルに PowerShell が無い場合は `mcr.microsoft.com/dotnet/sdk:8.0`（arm64 あり・pwsh 同梱）のコンテナで動かし、
  バックエンドへは `host.docker.internal` で接続する（`mcr.microsoft.com/powershell` は arm64 が無く Apple Silicon ではクラッシュする）。
  トークンを含む `config.json`・状態・ログはコミットしない。詳細は
  [tools/daily-report-agent/README.md](tools/daily-report-agent/README.md)
  - タスクスケジューラ登録（`Install-DailyReportAgentTask.ps1`、Issue #478）: 「管理者として実行」で別の管理者アカウントに
    昇格すると `$env:USERNAME` は管理者になるので、実行アカウントの既定は `Win32_ComputerSystem.UserName`（コンソールの
    ログオンユーザー）から取る。UNC を読むため `SYSTEM`・S4U は使わない。パスワードは `Get-Credential` 以外で受け取らない。
    コンテナの `pwsh` には `ScheduledTasks` が無いので、ロジックの確認は `New-ScheduledTask*` / `Register-ScheduledTask` を
    スタブ関数で差し替えて実行し、PS 5.1 互換性は PSScriptAnalyzer の `PSUseCompatibleSyntax`（TargetVersions 5.1）で見る
- **日報Excelのパースと明細（`daily_report_entries`、Issue #487）**: 同じブックが保存のたびに別ファイルとして届くので、
  明細は**足し込まず (テナント, シート名) 単位で最新版に丸ごと置き換える**（RPC `replace_daily_report_sheet_entries`。
  版の新旧は RPC が `daily_report_files` から引いた `file_modified_at`→`received_at` で判定）。明細を読む後続処理（名寄せ・割り付け）は
  ファイル単位ではなくこのテーブルを入力にする。パーサー（`services/daily_report_parser.py`）は Storage・DB から切り離した純粋関数に保つ。
  `openpyxl` の `read_only=True` はファイルに記録された使用範囲しか読まないので `reset_dimensions()` してから読む。数式セル
  （`不適合合計数`）は `data_only=True` でキャッシュ値を読み、openpyxl 等 Excel 以外で保存されたファイルではキャッシュが無い（None）
  前提で代替値を持つ。テナントのメンバーが参照できる列（`parse_error` 等）に例外文言を入れない。
  詳細は [docs/features/daily-report-agent.md](docs/features/daily-report-agent.md)
- **日報の名寄せ（Issue #488）**: 明細の設備・工程・顧客・製品の照合結果は `daily_report_entries` に**保存せず**、
  `daily_report_name_matching_service.load_matcher(db, tenant_id).match_entry(entry)` で都度解決する（辞書・マスタの変更を
  再照合なしで過去の明細へ反映するため）。照合は表記単位で決まるので、表記の一覧は RPC `daily_report_name_stats` で集計して
  から照合する。どの種別も**別名辞書が最優先**、候補が複数なら照合しない、**pg_trgm の類似候補で自動確定しない**
  （`match_products()` は未照合キューの候補表示専用）。日報の商品名の別名は既存の `product_name_aliases`（顧客単位）に
  `source='daily_report'` で登録する（確認済みの由来として `auto_match_unreviewed` に格下げされない）。
  マスタ・辞書を全件読むときは PostgREST の `max_rows`（1000）で切られないよう `fetch_all_rows()`（`.range()` でページング）を使う
- **Edge Function でリクエストを中継するとき**（`supabase/functions/agent-gateway/`、Issue #468）: エージェントは
  `agent-gateway` 経由で Render の `/api/agent/*` を叩く。独自トークンを `Authorization` に載せる関数は
  `verify_jwt = false` が必要だが、Terraform provider に属性が無いので CLI（`--no-verify-jwt`）でデプロイする。
  Edge Runtime は**クライアントのボディを読み切らずに応答すると 504（約60秒）になる**ため、ボディ付きリクエストを
  中継・拒否するときは必ず最後まで読んでから応答する（ストリーム中継すると、上流がボディを読む前に返す 401/413 で踏む）
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
- **顧客側の確度 (`orders.customer_certainty`)**: `confirmed` / `forecast` / `forecast_tentative` / NULL。
  確度を判定できない取り込み（PDFテキスト抽出失敗・抽出値が許容値外等）は `forecast_tentative`（内々示）へ
  フォールバックせず **NULL（確度不明）** で保存する（内々示と誤認させるため。Issue #474）。NULL は
  `upsert_order_by_dedupe_key` で「新規 NULL は既存 draft を上書きしない（`skipped_downgrade`）／既存 NULL は
  確度判明時に上書きされる」、`_mark_superseded_orders` では supersede 対象外。表示は受注詳細で「－」、
  一覧ではバッジ無し
- **設備台帳（`equipments.ledger_no` 等、Issue #486）**: 設備マスタは顧客の設備台帳が正典で、日報の `〇〇t N号機` の
  `N` を `ledger_no` で照合する。`equipments` の UNIQUE は `(tenant_id, name)` と `(tenant_id, ledger_no)`（部分）の2本で、
  ルーターは制約名で振り分けて 409 `duplicate_equipment_name` / `duplicate_ledger_no` を返す。設備と同名の1台グループが
  初期移行で作られているので、**設備名を一括で変えるときは同名1台グループも合わせる**。名称の入れ替え・玉突きは UNIQUE を
  踏むので一時名を経由する（`scripts/equipment_ledger/apply_equipment_ledger.py` の `order_renames()`）。
  台帳の実データは `scripts/equipment_ledger/_data/`（git 管理外）に置き、リポジトリ・テストに入れない
  - **呼称（`equipments.short_name`）**: `name` は台帳の正式名称で長いので、画面に設備名を出すときは
    「呼称があれば呼称、無ければ `name`」の表示名を使う（Backend `equipment_display_name()` /
    Frontend `equipmentDisplayName()`。`equipment.name` を直接描画しない）。呼称も `(tenant_id, short_name)` の部分
    UNIQUE（409 `duplicate_short_name`）。ガントは設備名ではなく**設備グループ名**を出すので、1台グループの名前は呼称に揃える
- **ガントチャート**: `frontend/src/gantt/` のカスタム実装を使用。`gantt-task-react` は削除済みのため参照しない
- **Tailwind クラス文字列から特定のクラスを抽出するとき**: `"bg-red-600 text-white hover:bg-red-600"` のような
  複数クラスをまとめて持つ定数（例: `DeadlineBadge.tsx` の `STATUS_CLASS`）から特定の役割のクラス（背景色等）
  だけを取り出して別の要素（凡例のスウォッチ等）に使い回す場合、`.split(" ")[0]` のような**位置依存**の抽出は
  クラスの並び順を変えただけで壊れる。`.split(" ").find((c) => c.startsWith("bg-"))` のように**接頭辞で検索**
  する（Issue #444 の凡例実装、PR #449 Copilotレビュー指摘）
- **ダッシュボード**: `app/page.tsx` は `components/dashboard/DashboardRouter` を描画するだけ。`DashboardRouter` が
  `useCurrentMember().role` で `PresidentDashboard`（`president`）／`DefaultDashboard`（それ以外・ロール未取得中の
  フォールバック）を出し分ける。`useOrders()` / `useProducts()` / `useDashboardMetrics()` は **`DashboardRouter` で
  1回だけ**呼び、各ダッシュボードには props で渡す（ロール判明時の再マウントで再フェッチさせないため）。
  各ダッシュボード・配下のパーツ（`KpiCards` 等）は表示専用。集計は `hooks/use-dashboard-metrics.ts`。
  Epic #399（Issue #401 が基盤、KPI 差し替え #ISSUE_D／承認待ちキュー #ISSUE_B／リスクカード #ISSUE_C）。
  詳細は [docs/features/dashboard-ui-improvement.md](docs/features/dashboard-ui-improvement.md)
- **受注一覧のフィルタ／バッジ**: `frontend/src/lib/order-utils.ts` の `STATUS_TABS` に**表示するタブは
  `orders.status`（＋ draft を分割した `simulated`）に限定する方針（#215）**。「情報不足」「工程未入力」など
  `orders.status` と直交する概念は**タブを増やさず**、通知カード（`order-notification-cards.tsx`）＋一覧行の
  バッジ（`order-table-row.tsx`）で認知させる。`filterOrder()` はタブ非表示の派生フィルタ（`incomplete` ＝
  顧客/希望納期未設定、Issue #406 で導線復旧）も URL `?status=` から受けるので、`STATUS_TABS` に無い値でも
  分岐を必ず用意する。「工程未入力・起票不可」（`has_no_routings`）判定は `isNoRoutingOrder()` に集約し、
  受注詳細（`orders/[id]/page.tsx` の `hasNoRouting`）と条件を揃える。一覧のデフォルトフィルタは
  「対応が必要」（`action_required`、Issue #460）＝ロール別に自分がアクションすべき注文
  （`order_handler`/`iso_officer`: 下書き全般、`president`: 承認待ち、`platform_admin`: 確定済み）で、
  `?status=` 未指定時のみ適用する（明示指定は尊重）。詳細は
  [docs/features/order-management-ui-design.md](docs/features/order-management-ui-design.md) /
  [docs/features/process-routing-confirmation.md](docs/features/process-routing-confirmation.md)
- **URL クエリを Union 型にキャストするとき（`?status=` 等）**: `searchParams.get(...) as StatusFilter`
  のように無検証で `as` キャストすると、URL 直接編集・ブックマーク由来の未知の値で「該当なし」の誤表示や
  タブの選択状態不整合を起こす（Issue #460 PR #465 Copilotレビュー指摘）。既知の値の集合
  （`STATUS_TABS` の値＋タブ非表示の派生フィルタ等）と照合し、外れていたらデフォルト値へクランプする
  ヘルパー関数を挟むこと（`use-orders-page.ts` の `toValidStatusFilter()` が実装例）。同様に、ロール等の
  Union 型を受け取る関数は引数を `Role | string` のように広げず `Role | null` のまま保つ（`string` を混ぜると
  呼び出し側のタイプミスをコンパイル時に検知できなくなる）
- **データ取得**: TanStack Query (`useQuery` / `useMutation`) で統一。`useEffect` でのフェッチ禁止
- **フロントエンド単体テスト**: Vitest + React Testing Library + MSW（`frontend/vitest.config.ts`）。
  Playwright（`frontend/e2e/`）とは物理的に分離し、テストは対象コードにコロケーション配置（`Foo.tsx` の隣に `Foo.test.tsx`）。
  - HTTP は必ず MSW 経由。TanStack Query を使うフック／コンポーネントは `@/test-utils/render` の
    `render` / `renderHook`（`retry: false` 済み。生 RTL を直接使うと失敗クエリでテストがハングする）を使う
  - 認証（`@/utils/supabase/client`）は `vitest.setup.ts` で全テスト共通モック済み。セッション状態は
    `@/test-utils/supabase` の `setSupabaseSession()` で制御する（各テストで `vi.mock` し直さない）
  - `NEXT_PUBLIC_API_URL` / MSW の `API_BASE` は `.env.local.sample`・CI と同じ `http://localhost:8000`
    （`/api` を付けない。`apiClient` が `NEXT_PUBLIC_API_URL + endpoint` で組む）
  - 日付ロジックのテストは端末 TZ 非依存に書く（`new Date(y, m, d)` でローカル深夜を作る等）
  - 詳細・基盤メンテ時の注意（`@testing-library/dom` を明示 devDep 化、`export *` 禁止、`vite-tsconfig-paths` 不使用の理由）は
    [docs/features/frontend-unit-testing.md](docs/features/frontend-unit-testing.md)
- **型安全**: Backend の Pydantic スキーマと Frontend の TypeScript interface を一致させること
  - Union 文字列型（`Order["status"]` 等）でルックアップテーブルを引くときは `Record<string, T>` ではなく
    `Record<Order["status"], T>` で全ケースを明示する。値が増えたときに型エラーで気づける（PR #409）
- **日付文字列のパース（Frontend）**: `orders` の `confirmed_deadline` / `simulated_deadline` /
  `desired_deadline` / `scheduling_start_date` / `order_date` 等は**日付のみ（`"YYYY-MM-DD"`、時刻を持たない）**。
  `new Date("2026-09-08")` は **UTC 深夜**として解釈されるため、端末のタイムゾーン次第で日付が前日にズレる
  （「今日の納期」カウントや一覧の表示日付が1日ずれる）。日付のみのフィールドは必ず
  `parseISO()`（`date-fns`、ローカル深夜として解釈）でパースする。`created_at` 等の**タイムスタンプ**
  （時刻・TZ 付き）は `new Date()` で可（PR #409）
- **受注の納期フィールド**: `orders` には完成見込み日が2本ある。`confirmed_deadline`（承認確定時＝`dry_run=False` に書き込み）と `simulated_deadline`（`POST /orders/{id}/simulate` ＝ `dry_run=True` に書き込み、承認前の「シミュ納期」表示用。Issue #394）。両者は `deadline_from_schedules()`（`services/order_simulation_service.py`）で同一ロジック（最終工程終了日時 → date）で算出する。`PATCH /orders/{id}` で `product_id` / `quantity` / `deadline_date` / `scheduling_start_date` が変わると `simulated_deadline` と `is_scheduled` はクリアされる（`reject` / `withdraw` は据え置き）。詳細は [docs/features/simulation-engine.md](docs/features/simulation-engine.md)
  - 既存受注のシミュ実行＋永続化は `simulate_and_persist()`（同サービス）に集約し、手動シミュ `POST /orders/{id}/simulate` と cron 自動起票（`auto_simulate_intake_order()`）で共有する（Issue #477）。`schedule_order` をテストで差し替えるときは**このサービスモジュール**を `monkeypatch` する（ルーター側には名前が無い）
  - 作業開始日（`scheduling_start_date`）が未設定ならシミュ時に **JST の翌日**（`default_scheduling_start_date()`）を補完・保存し、`scheduling_start_date_auto=true` を立てる。手動設定（`PATCH` で `scheduling_start_date` を送る）で false に戻る。承認（`_confirm_single_order()`）は **auto=true かつ過去日のときだけ**承認日 JST の翌日へ繰り上げる（手動の過去日＝Issue #372 の救済は据え置く）。作業開始日を書き込む新しい経路を足すときは、このフラグを自動／手動のどちらにするか必ず決める
- **受注の重複（UNIQUE 衝突）ハンドリング**: `orders` には UNIQUE が2本ある。`orders_dedupe_key`（`(tenant_id, customer_id, product_id, deadline_date)`）と `orders_tenant_id_order_number_idx`（`(tenant_id, order_number)` の部分 UNIQUE。`order_number IS NOT NULL` のみ）。加えて `product_id IS NULL` 用の部分 UNIQUE `orders_dedupe_key_unmatched_product`（`(tenant_id, customer_id, deadline_date, extracted_product_name)`）。編集ダイアログはどの列も変更できるため、重複時はどの制約に当たったかを判別する必要がある。`BaseRepository.update()` は Postgres の unique_violation（`23505`）を `DuplicateRecordError`（`.constraint` に生の例外文言＝制約名を保持）へ変換する（`create()` は歴史的経緯で `ValueError` を投げるが、`update()` はルーターで 409 に正規化しやすいよう専用例外）。ルーター（`update_order` 等）は `DuplicateRecordError.constraint` に `order_number` が含まれるかで振り分け、**409 Conflict** ＋ 構造化 detail（`{"error": "duplicate_order" | "duplicate_order_number", "message": <固定文言>, "conflicting_order"?: {...}}`）を返す。**レスポンスに生の DB 制約名・例外文言を載せない**（cron エラー規約と同方針）。4 経路（`PATCH /orders/{id}` / `POST /orders` / `POST /orders/email-intake` / `POST /orders/{id}/split`）共通で `_duplicate_order_conflict_exception()`（`routers/transaction/orders/_shared.py`）が 409 化・衝突先レコード（`conflicting_order`）の付与を行う（`email-intake` のみ明細単位のため `line_item_index` も付与）。Issue #415 は PR1（`update` 経路の 409 化）→ PR2（4経路共通の 409 構造化・`conflicting_order` 付与）→ PR3（フロントの通知モーダル）で完了。
  - フロント: `ApiError`（`api-client.ts`）は `errorCode`（`detail.error`）に加え `conflictingOrder` / `lineItemIndex` の getter を持つ。**バックエンドが返す `detail` の中身は「別サービス（API）からの外部入力」として扱い、`as` で無検証キャストしない**（Copilot レビュー指摘。PR #432）。`conflictingOrder` は `id: number` / `status: string` を、`lineItemIndex` は整数の `number` であることを確認してから返し、不正な形なら `undefined`（呼び出し側は固定文言のみ表示にフォールバック）。`duplicate_order`（衝突先あり）は共通コンポーネント `DuplicateOrderDialog`（`components/orders/duplicate-order-dialog.tsx`）へ、`duplicate_order_number`（衝突先なし）は従来通りトーストへ振り分ける。4 呼び出し元（`EditOrderDialog` / `SplitOrderDialog` / `orders/new/page.tsx` の起票・確定・メール起票）はこの振り分けパターンを踏襲すること
  - 詳細は [docs/features/order-management-ui-design.md](docs/features/order-management-ui-design.md)
- **メンバーロール**: `organization_members.role` は `president`（社長）/ `iso_officer`（ISO担当）/ `order_handler`（受注担当）/ `platform_admin`（プラットフォーム管理者）の四値（Issue #323）。旧 `admin`/`member` は廃止済み。メンバー管理系エンドポイントは `president`/`platform_admin` に開放し、承認操作（工程確定 `is_confirmed` 等）は `platform_admin` を含めず `president` 限定とする方針。詳細は [docs/features/member-roles.md](docs/features/member-roles.md) 参照
- **日付の「今日」判定（Backend）**: `date.today()` / `datetime.now()` は**実行ホストのTZ依存**（Cloud Run は UTC 想定）で、JST日付境界（深夜〜朝9時頃）付近で「今日」が1日ずれうる。納期超過判定・残バッファ計算・着手日判定など、業務上の暦日はすべて JST 基準で判定する方針のため、`app/utils/calendar.py` の `JST`（`ZoneInfo("Asia/Tokyo")`）を使って `datetime.now(JST).date()` を使うこと（`date.today()` 単体は使わない）。既存の踏襲元は `scheduling_start_service` / `order_auto_transition_service.py`。Issue #376 PR (#431) の Copilot レビューで `routers/transaction/orders/routing_queue.py` と `approval_workflow.py` の2箇所がこれで指摘・修正された
- **FastAPI ルーターのパッケージ分割**: `routers/transaction/orders/`（Issue #376）を前例とする。分割時の注意点:
  - `parent_router.include_router(child_router)` は **`include_router()` に渡した `prefix` 引数のみ**を子ルーターへ適用する。親の `APIRouter(prefix=...)` コンストラクタ引数は、親に直接登録したルートにしか効かず、`include_router()` 経由で足したルートには自動で乗らない（乗ると誤解して素朴に分割すると `FastAPIError: Prefix and path cannot be both empty` になる）。必要な prefix は毎回明示的に `include_router(child, prefix="/orders")` のように渡す
  - `/{id}` のような単一動的セグメントの静的パス（例: `/unconfirmed-routing-queue`）は、Starlette がパステンプレートを**登録順**に評価するため、動的ルートを持つサブルーターより**先に** `include_router()` すること。route 衝突は HTTP メソッド・パスのセグメント数が同じ場合のみ起こるので、全組み合わせを気にする必要はない
  - 上記の回帰はテストで担保する（`test_orders.py` の `test_unconfirmed_routing_queue_route_resolves_before_order_id` 参照）
  - サブモジュールを跨いで `monkeypatch.setattr()` する既存テストがある場合、パッチ対象は**実際にその関数を呼び出しているモジュール**を import すること。パッケージの `__init__.py` で再エクスポートした名前をパッチしても、各サブモジュール自身の名前空間で解決される呼び出しには影響しない

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
- PR作成後・Copilotレビュー対応後は、その作業で得た再利用可能な知見（設計判断・落とし穴・レビュー指摘とその対応方針等）を、該当する階層の `CLAUDE.md`（リポジトリ直下、または `frontend/`・`backend/` 配下等より近い階層のもの）に追記すること。`docs/features` は機能仕様・実装詳細の置き場、`CLAUDE.md` は「次にこの領域で作業する Claude が踏まえるべき規約・注意点」の置き場という役割分担を意識し、コード自体から読み取れる内容や一時的な作業メモは書かない

### ドキュメントの配置方針（`docs/features` と Wiki の使い分け）
- `docs/features/`: 開発者向けドキュメント。実装（エンドポイント・ファイルパス・データモデル等）と結びつく内容はここに書き、コード変更と同じPRでレビュー・更新する
- [Wiki](https://github.com/HyperGenius/product-planner/wiki): 顧客・現場担当者向けの運用マニュアル（操作手順書等）。`docs/features` は開発者が読むには数が多くなりすぎるため、対象読者が非エンジニアの手順書はWikiに分離する。PRレビュー対象外のため、コードと無関係に随時更新してよい
- 機能追加時に両方の対象読者向けドキュメントが必要な場合は、`docs/features/` 側に該当Wikiページへのリンクを記載すること（例: [docs/features/device-trust-pin-auth.md](docs/features/device-trust-pin-auth.md)）
