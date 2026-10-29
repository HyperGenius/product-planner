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
  routers/daily_reports/  # 日報の名寄せ・別名辞書・未照合キュー・進捗参照 API（Issue #488 / #489 / #490）
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
- CI（`.github/workflows/ci-*.yml`）のキャッシュ: PR の run で保存したキャッシュはその PR からしか復元できないので、
  他の PR でも効かせたいキャッシュは `main` への push の run で作る（両ワークフローを `push: main` でも走らせているのはこのため）。
  Next.js 16 の `next build`（Turbopack）は `.next/cache` にコンパイル結果を残さないので、キャッシュしてもビルドは速くならない
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
  - **admin クライアントでセッションを作ると以降はユーザー権限になる**: `admin_client.auth.verify_otp()` 等で
    サインインすると supabase-py が `SIGNED_IN` を受けてクライアントの `Authorization` をそのユーザーのトークンに
    差し替える（2.26.0 / 2.31.0 とも。2.31.0 からは `auth` の admin API 呼び出しも同様）。同じクライアントで後から
    DB を書くと RLS が効き、ポリシーの無いテーブルでは 0件更新のまま黙って成功する。サインイン後に service role で
    書くときは `get_supabase_admin_client()` で別のクライアントを作る（Issue #430 の調査で判明）
- **supabase-py のバージョンを上げるとき（Issue #430）**: `requirements.txt` は推移的依存まで固定しているので、
  一式（`supabase`/`postgrest`/`storage3`/`realtime`/`supabase-auth`/`supabase-functions`）と、それらが要求する
  下限（例: `supabase-auth` 2.31.0 → `PyJWT>=2.12.0`）をクリーンな venv（`uv venv -p 3.14`）で解決して確かめる。
  使わなくなった依存を消すときは `uv pip tree --invert --package <name>` で他に依存元が無いか見る
  （`pyparsing` は `httplib2` 経由で必要）
- **Python のバージョンを上げるとき（Issue #570）**: 指定は `backend/Dockerfile`（Render は Dockerfile Path でこれを使う）・
  `.github/workflows/ci-backend.yml`・`backend/pyproject.toml`（mypy `python_version` / ruff `target-version`）に散っているので揃える。
  ベースイメージはタグを変えると Debian も変わるので `python:3.x-slim-<コード名>` まで固定する。互換性は、クリーンな venv に
  `uv pip install --no-build` で wheel だけで入るか（本番向けは `--python-platform x86_64-manylinux_2_28 --target <dir>`）、
  unit / api / integration を旧版と並べて結果が一致するかで確かめる。ruff の `target-version` は `UP` ルールの書き換えが
  大量に出るのでランタイムの変更と別 PR にする
- **Docker イメージに入るのは `backend/app/` と `requirements.txt` だけ**（`backend/.dockerignore` が許可リスト方式）。
  実行時に `app/` の外のファイル（`data/` 等）を読むようにしたら `.dockerignore` に `!` で追加する（しないと本番だけ
  ファイルが無くて落ちる）
- **Storage の「上書きしない」アップロード**: `upload(..., file_options={"upsert": "false"})` で既存キーに書くと
  storage3 は `StorageApiError` を投げ、実 Storage では `status == "409"`（文字列）/ `code == "Duplicate"` になる
  （ローカル Supabase で確認済み。既存オブジェクトは上書きされない）。重複を正常系として扱う場合はこれで判定し、
  それ以外の `StorageApiError` は再送出する（`daily_report_service._upload_if_absent()`、Issue #471）
- **Storage のオブジェクトキーと content-type**: 日本語ファイル名をキーに使わない場合でも、ダウンロードしてそのまま
  開けるよう元ファイル名の拡張子（ASCII 英数字のみ・小文字化）はキー末尾に付ける。content-type は `mimetypes` で
  推測しない（本番の `python:3.14-slim-trixie` は `/etc/mime.types` が無く、Python バージョンによって `.xlsx` を解決できない）。
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
  - **未照合キュー（Issue #489）**: 画面は `/master/daily-report-names`（`components/daily-report-names/`）。「対象外」は別名辞書に
    列を足さず `daily_report_ignored_names`（4種別共通、製品は (顧客先, 商品名) の組。顧客先 NULL も `UNIQUE NULLS NOT DISTINCT`）に持つ
    （製品の別名辞書 `product_name_aliases` は `product_id` NOT NULL でメール起票と共有のため）。対象外は照合結果に影響させず、
    `list_unmatched_names()` で除外するだけにする。書き込めるロールは Backend `_ALIAS_EDITOR_ROLES` と Frontend
    `DAILY_REPORT_NAME_EDITOR_ROLES` を揃える
  - 行ごとに発火するクエリ（製品の類似候補）は、ミューテーション後にまとめて無効化するクエリキー（`["daily-report-names"]`）の
    **配下に置かない**。配下に置くと登録1回ごとに行数分の pg_trgm 検索が再実行される（PR #498 Copilotレビュー）
- **日報の実績の割り付けと進捗（Issue #490）**: 計算は純粋関数 `daily_report_allocator.allocate_actuals()`、DB 入出力は
  `daily_report_allocation_service`。結果（`order_process_progress` / `daily_report_unallocated_actuals`）は**差分更新せず
  テナント単位で全量を再計算し**、RPC `replace_daily_report_allocation` で丸ごと置き換える（`p_computed_at` より新しい結果が
  あれば `'stale'`、現存する受注・工程・明細に JOIN して INSERT するので計算後に消えた行で失敗しない）。書き込みは service role
  のみなので、**別名辞書の変更 API（ユーザー JWT）から同期的に再計算しない**（cron `compute-daily-report-progress` が
  `parse-daily-reports` の直後に毎回回り、次の実行で反映される）。割り付けの候補は `confirmed` / `in_progress` の受注で、
  加工日が受注日（`order_date` の JST 暦日）より前の実績は充当しない（出荷済みで候補から外れた受注の実績が後の受注を完了に
  見せないため。未割当 `before_order_date` に残る）。詳細は [docs/features/daily-report-agent.md](docs/features/daily-report-agent.md)
  - **ガント・受注詳細への進捗表示（Issue #491）**: ガントは表示中の受注 ID をまとめて `GET /daily-reports/order-progress` で
    1リクエスト取得し (`order_id`, `process_routing_id`) で結合する（スケジュール API には混ぜない）。遅れの基準の計画終了日時は
    **バックエンドの `planned_end_datetime`（その工程の全セグメントの `end_datetime` の最大）を使う**。ガントは表示範囲の
    セグメントしか取得しないので、フロントの手元のセグメントで求めると範囲外へ続く工程を誤って遅れにする。進捗の行が無い工程
    （割り付け対象外の受注・未計算のテナント）は遅れにしない。表示規則は `lib/daily-report-progress-utils.ts` に集約し、
    `src/gantt` には汎用の `GanttTask.progress` / `isDelayed` だけを足す（ドメイン知識を入れない）
  - **照合状況の画面（Issue #542）**: 割り付け済み・未割当・未照合の内訳は、割り付けの再計算で加工月ごとに集計して
    `daily_report_allocation_runs.coverage` に**未割当と同じ RPC で保存**し、参照時に明細を照合し直さない（辞書の変更が先に反映されて
    未割当と数字が合わなくなる）。未割当の reason は工程ルートに無い工程（`no_routing_process`）を受注の有無より先に判定する。
    `no_candidate_order` の「承認前の受注のみ／出荷済みの受注のみ／受注なし」は保存せず読み出し時に `orders` から分類する。
    加工日の無い明細は期間の絞り込みにかかわらず含める
  - **作り置き（先行着手）の推定（Issue #591）**: 現場はよく出る製品を作り置きして受注に出している。受注への引き当ては
    「次の工程が始まってから」とみなし、**割り付けの規則は変えず**、純粋関数 `daily_report_stock_estimator.estimate_stock()` で
    (製品, 工程) ごとの数を推定する（正確さは求めず、現場の「違う」の指摘 `daily_report_stock_feedback` で補正する）。推定は
    割り付けの再計算で求め、**同じ RPC `replace_daily_report_allocation`（`p_stock`）で置き換える**。仕掛かりから確定済み・生産中の
    受注に割り付いた分（`AllocationResult.allocations`）を引かないと、通常の仕掛かりまで作り置きに見える。明細は良品数0（すべて不良）
    でも次の工程の消費に数えるため `processed_qty > 0` で読むので、割り付け・照合状況の集計では良品数0の明細を飛ばすこと。
    画面の呼び名は現場の呼び名に合わせる前提で `STOCK_LABEL`（`lib/daily-report-stock-utils.ts`）1か所に置く
  - **送品日時 `orders.shipped_at`** は `status` が `shipped` / `completed` になったときにトリガー `trg_set_order_shipped_at` が書く。
    送品の経路を足してもアプリから書かない
  - **`merge_products` の最新の定義は `20261029000000_add_daily_report_stock_estimates.sql`**（作り置きの指摘の付け替えを追加）。
    作り直すときはこの本文をベースにする
  - `set_updated_at()` は `updated_at` を無条件に `now()` にするので、統合などで付け替えても「最後に書いた日時」を残したいテーブル
    （`daily_report_stock_feedback`）には付けず、API で `updated_at` を書く
- **マイグレーションの CHECK 制約名**: 列の CHECK（`status text CHECK (...)`）には Postgres が `<table>_<column>_check` という名前を
  自動で付けるので、表の制約に同じ形の名前（例: `CONSTRAINT order_process_progress_completed_by_check`）を付けると
  `already exists` で失敗する。ローカル DB へ手で適用するときは `psql --single-transaction -v ON_ERROR_STOP=1` で流す
  （付けないと途中まで作られたテーブルが残る）
- **ローカル DB のマイグレーション履歴**: 通常は `supabase migration up --local` で当てる。`psql` で手で流したら
  `supabase migration repair --local --status applied <版>` で履歴（`supabase_migrations.schema_migrations`）にも記録する。
  記録しないと、以降の `migration up` が「最後の版より前に未記録のファイルがある」と止まる。そこで `--include-all` を付けると
  適用済みのものまで流し直して `already exists` で失敗するので、未記録の版は中身（列・テーブル・関数）が DB にあるかを1本ずつ確かめ、
  適用済みだけを repair してから `--include-all` で残りを当てる（PR #545 の作業時に、手動適用済み13本・未適用2本が混在していた）
- **Edge Function でリクエストを中継するとき**（`supabase/functions/agent-gateway/`、Issue #468）: エージェントは
  `agent-gateway` 経由で Render の `/api/agent/*` を叩く。独自トークンを `Authorization` に載せる関数は
  `verify_jwt = false` が必要だが、Terraform provider に属性が無いので CLI（`--no-verify-jwt`）でデプロイする。
  Edge Runtime は**クライアントのボディを読み切らずに応答すると 504（約60秒）になる**ため、ボディ付きリクエストを
  中継・拒否するときは必ず最後まで読んでから応答する（ストリーム中継すると、上流がボディを読む前に返す 401/413 で踏む）
- **画像PDF（FAX・スキャン）の受注取り込み（Issue #520）**: pdfplumber でテキストが取れない PDF（`failed_image`）は
  `extract_order_lines_from_pdf()` が PDF のまま `document` ブロックで Claude に渡す。API の失敗は**再試行で通らないもの
  （400 / 413 / 422 → `PdfDocumentRejectedError`）だけを読み取り不能（空の下書き）に落とし**、レート制限・5xx・認証エラーは
  送出してステージング行を `pending` のまま次回の cron に回す（空の下書きを作ると再処理されない）。画像から起票した受注の
  添付行は `parse_status='success_image'`。`order_attachments.parse_status` は列の CHECK（`order_attachments_parse_status_check`）
  なので値を足すときはマイグレーションで張り直す。ステージング行へ要確認のログ（`image_extracted`）を残すのは起票1件以上の
  ときだけにする（先に残すと `_notify_if_no_order_created()` が「ログあり」と判定して起票0件の通知が出ない）。
  詳細は [docs/features/pdf-order-parsing.md](docs/features/pdf-order-parsing.md)
- **社内転送者と顧客不明（Issue #521）**: `tenant_internal_senders` に登録したアドレス（社長など）からのメールは、
  差出人での顧客の突合・下書き顧客の作成をせず、本文の候補でも決まらなければ**ステージング行・受注の
  `customer_id` を NULL（顧客不明）にする**。テナント共通の「顧客不明」レコードは作らない（重複判定の UNIQUE に
  `customer_id` が含まれるので、共通レコードだと品番・納期が同じ別顧客の注文が1件に統合される。NULL 同士は一致しない）。
  そのため取り込み・パースの処理では `customer_id` が None になりうる前提で書く（顧客単位の別名辞書・内示の無効化は
  スキップ。PostgREST の `.eq("customer_id", None)` は bigint エラーになる。Issue #262）。顧客の照合は
  `match_customer_by_pdf_text()` が会社名→番号（`customers.fax_number` / `phone_number`、数字だけで比較）の順で行い、
  両者が別の顧客に当たったら確定しない。テキスト PDF の番号は見出し（FAX / TEL）の有無を問わず電話番号の形で拾う
  （FAX 送信元が見出し無しで印字される・`0480(12)3456` のような市内局番の括弧がある。Issue #524）。詳細は [docs/features/internal-senders.md](docs/features/internal-senders.md)
- **外部入力（PDF・メール本文）に当てる正規表現**: `[ \t]*-?[ \t]*` のように可変長の繰り返しを任意の記号を挟んで
  隣接させると、長い空白列の後にマッチが失敗する行で分け方を総当たりして O(N²) の後戻りになる（空白2万文字で約7秒）。
  2つ目の繰り返しは記号があるときだけ置く（`[ \t]*(?:-[ \t]*)?`）。cron が全テナント横断で回すので CPU を浪費する
  （PR #525 Copilotレビュー指摘、`customer_matching_service._PHONE_SEP`）
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
  `order-utils.ts`（ラベル／バッジ／タブ）を同時に更新する。`draft → shipped` は遷移表に無く、
  専用エンドポイントだけが例外的に行う（納期超過の一括 `ship-overdue-drafts`、Issue #367 ／ 社長が個別に行う
  工程未入力の下書き `POST /orders/{id}/ship-without-routing`＝暫定の例外処理で承認ログ
  `ship_without_routing` を残す、Issue #547）。`order_approval_log.action` を足すときは CHECK 制約の張り直しに加え、
  Backend の `OrderApprovalLogResponse.action`・CSV ラベル（`approval_logs.py`）と Frontend の
  `OrderApprovalLog["action"]`・承認ログ画面のラベルも更新する。詳細は
  [docs/features/order-status-workflow.md](docs/features/order-status-workflow.md)
- **修理注文（`orders.order_type='repair'`、Issue #493）**: 製品・工程・設備を持たない受注で、`product_id` /
  `quantity` / `extracted_product_name` は NULL（CHECK `orders_repair_without_product`）。実施開始日＝`scheduling_start_date`、
  承認前の完了予定日＝`simulated_deadline` を受注担当者が手入力し、承認で `confirmed_deadline` へコピーする
  （`schedule_order()` を呼ばず `production_schedules` も作らない）。受注を扱う処理で「`product_id` が NULL ＝製品未照合」と
  判定している箇所は、修理を先に `repair_order_service.is_repair_order()` で分岐させる（承認依頼・承認・シミュ・
  `has_no_routings`・分割で対応済み）。修理の `is_scheduled` は「実施開始日と完了予定日が両方入っている」に合わせて
  起票・PATCH のたびに書き直す（一覧の「シミュ済」タブ・承認依頼ボタンが draft の `is_scheduled` で判定するため）。
  `order_type` は作成後に変えないので `OrderUpdate` に入れない（例外は生産の draft → 修理等の専用操作
  `POST /orders/{id}/convert-to-repair`だけ。`status`/`order_type` を条件にした UPDATE で書き、承認ログ `convert_to_repair` を残す。Issue #568）。PDF 取り込みは `upsert_order_by_dedupe_key` を通さず
  直接 INSERT し、部分 UNIQUE `orders_repair_customer_order_no_key` の 23505 で再受信をスキップする。
  詳細は [docs/features/repair-orders.md](docs/features/repair-orders.md)
- **修理等の注文の画面（Issue #494）**: 修理のほかメンテナンス・洗浄など製品を持たない作業依頼も `order_type='repair'` にまとめ、
  画面では「修理等」と呼ぶ（`ORDER_TYPE_LABELS`）。受注の品名を出す箇所は `getProductName(order.product_id, ...)` ではなく
  `getOrderProductName(order, products)` / `getOrderProductDisplayParts()` を使う（修理等は `work_description` の先頭行を件名に出す。
  直接渡すと「不明」になる）。一覧の種別は `?type=`（`toValidOrderTypeFilter()` で生産にクランプ、`STATUS_TABS` には足さない）、
  詳細は別コンポーネント `RepairOrderDetail`、編集は `RepairOrderEditDialog`。修理等にシミュレーション系の操作を出さない
  （一括シミュレーションはスキップ）。詳細は [docs/features/repair-orders.md](docs/features/repair-orders.md)
- **顧客側の確度 (`orders.customer_certainty`)**: `confirmed` / `forecast` / `forecast_tentative` / NULL。
  確度を判定できない取り込み（PDFテキスト抽出失敗・抽出値が許容値外等）は `forecast_tentative`（内々示）へ
  フォールバックせず **NULL（確度不明）** で保存する（内々示と誤認させるため。Issue #474）。NULL は
  `upsert_order_by_dedupe_key` で「新規 NULL は既存 draft を上書きしない（`skipped_downgrade`）／既存 NULL は
  確度判明時に上書きされる」、`_mark_superseded_orders` では supersede 対象外。表示は受注詳細で「－」、
  一覧ではバッジ無し
- **設備台帳（`equipments.ledger_no` 等、Issue #486）**: 設備マスタは顧客の設備台帳が正典で、日報の `〇〇t N号機` の
  `N` を `ledger_no` で照合する。`equipments` の UNIQUE は `(tenant_id, ledger_no)`（部分）と表示名（後述）の2本で、
  ルーターは制約名で振り分けて 409 `duplicate_ledger_no` / `duplicate_display_name` を返す。設備ごとに表示名と同名の
  1台グループがある（初期移行で作成。以降は `equipments` の INSERT トリガー `trg_create_solo_equipment_group` が作る。Issue #512）ので、
  **設備名を一括で変えるときは同名1台グループも合わせる**。表示名・グループ名の入れ替え・玉突きは
  UNIQUE を踏むので一時名を経由する（`scripts/equipment_ledger/apply_equipment_ledger.py` の `order_renames()`）。
  台帳の実データは `scripts/equipment_ledger/_data/`（git 管理外）に置き、リポジトリ・テストに入れない
  - **設備名 `name` は一意ではない**（台帳に同名の設備がある。Issue #501）。一意なのは表示名 `COALESCE(short_name, name)`
    （式インデックス `equipments_tenant_id_display_name_key`、409 `duplicate_display_name`）で、同名の設備は呼称で区別する。
    設備を名前で引く処理（ON CONFLICT・名称→ID の辞書・対応付け）を書くときは、同名が複数ある前提で表示名で引くか、
    複数当たったら確定しない。名称と呼称を変えるときは1回の UPDATE でまとめて書く（別々に書くと途中で表示名の UNIQUE を踏みうる）
  - **呼称（`equipments.short_name`）**: `name` は台帳の正式名称で長いので、画面に設備名を出すときは
    「呼称があれば呼称、無ければ `name`」の表示名を使う（Backend `equipment_display_name()` /
    Frontend `equipmentDisplayName()`。`equipment.name` を直接描画しない）。同名の設備を見分ける補足（正式名称・メーカー・
    製造番号）は `equipmentDetailLabel()`。ガントは設備名ではなく**設備グループ名**を出すので、1台グループの名前は呼称に揃える
  - **設備マスタ画面（Issue #503）**: 用途は社長・設備管理者の棚卸し。一覧は台帳番号・呼称・正式名称・所属グループの4列に絞り、
    台帳の全項目・編集・削除・グループ設定は行クリックで開く詳細シート（`components/equipments/equipment-detail-sheet.tsx`）に置く。
    編集はシート内でフォームに切り替え、ダイアログを重ねるのは削除確認とグループ設定だけにする。一覧に列を足すときはマスタ共通の
    幅（`max-w-[860px]`）に収まるかを確認する
  - **設備グループのキャッシュ**: グループの `member_names` / `member_count` はグループ一覧（`['equipment-groups']`、
    `GET /equipment-groups`）が返すので、メンバーや設備を変えるミューテーションはメンバーのクエリだけでなくグループ一覧も
    無効化する（工程ルーティングのプルダウンのラベル・グループ管理タブの絞り込みが古いまま残る。Issue #512）
  - **1台グループの表示**: 画面では1台のグループをグループ名ではなくメンバーの設備の表示名で出す（`groupDisplayName()` /
    `formatGroupLabel()`）。1台グループの名前は設備名・呼称の変更に追従しないため。integration テストで設備を作ったら、
    テナントを消す前に `equipment_groups` も消す（トリガーが作ったグループが `equipment_groups.tenant_id` の FK で残り 23503 になる）
- **重複製品の統合（Issue #515）**: 事前チェック（受注の重複キーの衝突・工程の `sequence_order` の対応・接頭辞）は純粋関数
  `product_merge_service.plan_merge()` で行い、プレビュー API と実行 API の再検証で共有する。実行は RPC `merge_products`
  （`SECURITY INVOKER`）で、プレビュー後の変化は計画を信用せず **DB の制約違反（23505 / 23503）で全体を失敗させる**設計
  （スケジュールを付け替えられないと工程の削除が FK で落ちる）。**製品・工程を参照する FK を新しく足すときは、RPC の付け替え対象に
  入れるか CASCADE にするかを決める**（`ON DELETE` 無しだと統合が 409 になる）。品名の読み取り `product_spec_parser.parse_product_spec()`
  は #516（類似製品の警告）でも使う。`product_name_alias_history` は追記のみだが、統合のため `product_id` 列だけ列単位の
  `GRANT UPDATE (product_id)` ＋ president / platform_admin のポリシーで更新を許可している（他の列の UPDATE は 42501）。
  詳細は [docs/features/product-master.md](docs/features/product-master.md#重複製品の統合issue-515)
  - Frontend で `["products"]` と日報のクエリキーを両方無効化するフックは `use-products.ts` に置かない
    （`use-daily-report-names.ts` が `use-products.ts` を import しているので循環 import になる）。前例は `hooks/use-product-merge.ts`
  - 重い集計など「ボタンを押したときだけ」取得するクエリは `enabled: false` にして `refetch()` で取る（`useProductMergeGroups()`）。
    `invalidateQueries` は無効（disabled）なクエリを再取得しないので、配下のキーをまとめて無効化しても勝手に走らない
- **類似製品の警告（Issue #516）**: 製品の作成・編集ダイアログの警告は `GET /products/similar`（`product_similarity_service`、
  `parse_product_spec()` を #515 と共有）で、警告は登録・保存を妨げない。入力に応じて呼ぶクエリは、**問い合わせの可否・クエリキーを
  デバウンス後の値で決める**（入力中の値で `enabled` を決めると、デバウンス待ちの間に前の値で問い合わせる。`SimilarProductsWarning`）。
  `/{product_id}` と衝突する静的パスは先に登録する
- **一覧のセルを折り返さず省略するとき**: shadcn の `Table` は自動レイアウトなので、`td` の `truncate` / `max-w-*` は効かない
  （列が文字列の長さまで広がる）。`<Table className="table-fixed">` にして見出しの幅で列幅を決める（Issue #503）
- **一覧の行全体をクリック可能にするとき**: 行内の `DropdownMenu` / `Popover` の中身はポータルに描画されるが、React の合成イベントは
  ポータルからも React ツリー上の親（行）へ伝播するので、メニュー項目のクリックで行の `onClick` も発火する。行のハンドラでは
  `e.currentTarget.contains(e.target)` で DOM 上の行外（ポータル）のクリックを除外し、行内のボタン・リンク等も `closest()` で除外する
  （前例は受注一覧の `order-table-row.tsx`、Issue #527）。確定済み注文の確認モーダルは編集モーダルと外枠
  （`components/orders/order-dialog-layout.tsx`）を共有しているので、どちらかの見た目を変えるときはここを直す
- **注文の行操作・一括操作（Issue #554）**: 注文を並べる画面は、行操作を `useOrderActions()` ＋ `OrderActionDialogs`、
  一括操作を `useOrderBulkActions()` ＋ `OrderBulkActionDialogs`、表の外枠を `OrdersTable` で組み、行には
  `getRowProps(order)` を展開して渡す。画面ごとに出す操作は `OrderTableRow` の `visibleActions` で絞り、ページ側のフックに
  mutation・確認ダイアログの state を書き足さない（`use-orders-page.ts` は URL の状態・絞り込み・ページングだけ）。
  操作を足すときは `OrderRowAction` に値を足し、行の表示条件・`getRowProps()`・`OrderActionDialogs` を揃えて更新する
  - 画面固有の操作（リンク等）は `OrderRowAction` に足さず `OrderTableRow` の `leadingActions` に渡す。1画面に表を複数並べるときは
    `OrdersTable` の `totalCount` / `pageSize` を省略する（ページは URL の `?page=` 1つなので、表ごとにページングすると連動する）。
    全選択は表ごとに `useOrderBulkActions()` の `getSelectAllState()` / `handleToggleSelectAllOf()` を使う（起票の確認、Issue #555）
  - 列が注文一覧と違う画面は専用の行コンポーネントを作り、props の型に `OrderRowActionProps` / `OrderRowBulkProps` を使って
    `getRowProps()` をそのまま展開する（前例は「承認」画面の `ApprovalOrderRow`、Issue #556）。承認・差し戻し・取り下げの可否は
    行で条件を書かず `canApproveOrder()` / `canRejectOrder()` / `canWithdrawApproval()`（`order-utils.ts`）を使い、注文一覧と揃える
  - サイドバーの件数バッジは `SubMenuItem.badge`（`{ key: SidebarBadgeKey, roles }`）で、件数は `useSidebarBadgeCounts()` に集約する。
    バッジを出さないロールで注文を取得しないよう、取得は `useOrders({ enabled })` で必要なときだけにする（Epic #553）。
    注文以外のデータ（日報の進捗等）が要るバッジは、画面と同じフックで取ってクエリキーを揃え（「送品の消し込み」は
    `useShippingRows()`）、取得が終わるまでは件数を返さない（途中の件数が一瞬出る。Issue #557）
  - 「送品の消し込み」（Issue #557）の納期の基準は**希望納期 → 無ければ完成見込み**（`getShippingDeadline()`）で、
    完成見込みを基準にする現場ダッシュボードとは意図的に違う。送品は弥生が正なので、候補を示すだけで自動では送品済みにせず、
    一括の送品も作らない。送品の権限は `canShipOrder()`（`order-utils.ts`）で注文一覧と共有する
- **確認ダイアログで非同期処理の完了を待つとき**: `AlertDialogAction` はクリックした時点で閉じるので、ミューテーションの完了を待って
  閉じたい（失敗時は開いたまま残したい）場合は `AlertDialogFooter` に普通の `Button` を置き、成功時に `open` を false にする（Issue #503）
- **マスタを選ぶ検索付きコンボボックス（`Popover` + `Command`）**: 件数が増えうるマスタの選択は `Select` を使わずこちらにする
  （`SelectContent` は最大高さが無く、ダイアログ内で画面からはみ出す。Issue #509）。`CommandItem` の `value` を ID にするときは、
  表示名・略称等を `keywords` に渡して `Command` の `filter` で照合する（cmdk 既定は `value` 照合なので ID で検索されてしまう）。
  任意項目は「選択を解除」項目を `keywords` 無しで置くと検索中は自動で隠れる。分割ダイアログ等で1画面に複数並ぶ部品はラベルと
  トリガーの `id` を固定にせず `React.useId()` にする（前例は `components/customer-selector.tsx`）
- **ガントチャート**: `frontend/src/gantt/` のカスタム実装を使用。`gantt-task-react` は削除済みのため参照しない
  - 生産スケジュールの週次表示は、同じ受注・工程（`process_routing_id`）のセグメントを `GanttTask.rowId` で1行に並べ、
    バーはセグメントごとに描く。先頭〜最後の1本にまとめると、隙間に詰めて飛び飛びになった工程の空き時間まで作業中に見える（Issue #535）
  - 月次表示（オーダー別・フラット）も週次と同じく行をまとめる（Issue #537）。日次・設備グループ別は1セグメント1行のまま。均一グリッド（月次・日次）の開始列は
    **切り捨て**（開始時刻を含む列）、終了列は切り上げ。切り上げにすると月次で 09:00 開始のバーが翌日の列に描かれて1日ずれる
  - ラベル・注文行（Issue #579）: `GET /production-schedules` はレスポンスモデル `ProductionScheduleItem` で、Frontend の `Schedule` と揃える。
    **受注の希望納期の DB 列は `orders.deadline_date`**（API・画面では `desired_deadline` と呼ぶ。埋め込みの `select` に `desired_deadline` と書くと
    42703 になり、モックの unit テストでは気づけない。埋め込みを変えたら integration テスト `test_production_schedules_by_period.py` を流す）。
    API は表示期間と重なるセグメントしか返さないので、期間外へ続くかは同 API の `process_/order_start/end_datetime`（期間外を含む範囲）で判定する。
    グループ行の細いサマリーバー・子行（`parentId`）の折りたたみ・続きの印（`continuesBefore/After`）は `src/gantt` の汎用機能で、
    注文・顧客などの語は `components/schedule` 側に置く。詳細は [docs/features/production-schedule-gantt.md](docs/features/production-schedule-gantt.md)
  - バーの状態表示（Issue #580）: 色は製品ではなく工程の状態（`processDisplayState()`）を表す。**進捗の行が無い工程は「計画のみ」
    （未着手・遅れにしない）**。`src/gantt` には汎用の `appearance` / `badge` / `markers` だけを置き、状態名は `components/schedule` 側。
    凡例の見本は実際の `TaskBar` で描いて見た目と食い違わせない。納期マーカーは日付のみの値を `parseISO` で読み、**日の終わり**
    （翌日 0:00）に引く。超過判定は希望納期のときだけ（完成見込みは計画の終了から算出するので常に間に合う）。詳細は
    [docs/features/production-schedule-gantt.md](docs/features/production-schedule-gantt.md)
  - ラベル列（Issue #589）: どの行も**2行以内**に収め（3行以上は詰まって読めない）、納期・注文番号などはラベルに足さず詳細シートに置く。
    顧客は**通称**（`customers.alias`、`scheduleCustomerLabel()`）、設備は**呼称**（`short_name`）と呼び分ける（日報Excelの用語。統一しない）。
    状態・納期超過はアイコンのみで、対応表は `state-badge.tsx` の `STATE_ICONS` 1か所からラベル列・凡例・詳細シートに描く。
    凡例は常時表示せずツールバーのボタンで差し込む（**ポップオーバーにしない**: 外側のタップで閉じるのでタブレットで行と見比べられない）
  - 顧客の絞り込み（Issue #597）は API に渡さず**フロントで行う**（選択肢を表示期間の顧客から作るので、取得は全顧客分が要る）。
    詳細シートは絞り込み後、日報の進捗は絞り込み前のスケジュールから組む（絞り込みの変更で進捗を取り直さない）
  - E2E でバーの「行」を比べるときは、グリッド要素の親（行 = ラベルセル＋グリッド、#578）の並び順で見る（`gantt-segment-bars.spec.ts` の `rowOf()`）
  - タブレット対応（Issue #581）: 詳細はホバーのツールチップに頼らず、タップで開く詳細シート（モーダルにせずガントの右に並べる `aside`）に出す。
    タップは `src/gantt` の `onRowClick` / `onTaskClick` で、**スワイプの終わりのクリックを無視する判定（ポインタの移動量・スクロール量）は
    `src/gantt` 側にある**ので、ガントの中に別のクリックハンドラを足すときも `isTap()` を通す。シートの中身は表示中のスケジュールと進捗から
    `lib/schedule-detail-utils.ts` で組み立てる。スケジュールの直接編集は `president` のみ（Frontend `SCHEDULE_EDITOR_ROLES` と
    Backend `SCHEDULE_EDITOR_ROLES`（`services/schedule_shift_service.py`）を揃える）。表示の選択の保存は `useLocalStorageState()`（`useSyncExternalStore`。エフェクトで
    localStorage を読んで setState しない）で、保存値は外部入力として `parse` で検証する
  - 工程の前倒し・後ろ倒し（Issue #582）: 計算は純粋関数 `schedule_shift_service.plan_process_shift()`（元の開始から稼働日を数えた日の同じ時刻を起点に、
    稼働時間ベースの所要時間で詰め直す。前工程の終了より前には置かない）、保存は RPC `shift_order_process_schedules`（計算に使った注文の全セグメントと
    突き合わせて違えば失敗）。**RPC で「やり直して」を表すエラーに `40001` を使わない**（PostgREST が再試行対象として 504 にする。`P0001` 等にする）。
    遅れの基準 `planned_end_datetime` は `order_process_progress` の列ではなく参照 API がスケジュールから都度求めるので、スケジュールを変えたら進捗の
    クエリを無効化するだけでよい。着手日は `scheduling_start_date` を優先するので、注文の最初の工程を動かす経路は作業開始日も合わせる
    （#400 の自動遷移が追従しない）。承認時のスケジューラ `schedule_order()` は**テナントの稼働カレンダーを使っていない**（`calendar_config` 未指定＝土日のみ休み）。
    プレビューのバーは `src/gantt` の `isGhost` / `dimmed` で重ね、既存の行の rowId に並べる（ゴーストだけの行を作らない）。詳細は
    [docs/features/production-schedule-gantt.md](docs/features/production-schedule-gantt.md#工程の前倒し後ろ倒しissue-582)
  - jsdom には `PointerEvent` が無く、`fireEvent.pointerDown(el, { clientX })` の座標が入らない。座標が要るテストは、そのファイルだけ
    `MouseEvent` を継承した `PointerEvent` を `window` に当てる（前例は `gantt/components/gantt-chart.test.tsx`）。E2E でスワイプを再現するときは
    CDP の `Input.dispatchTouchEvent`（`gantt-tablet-touch.spec.ts`）
  - 稼働時間スロットの終了列は `binarySearchFirstGe`（終了時刻ちょうどのスロットは塗らない）。`FirstGt` にすると 10:00 終了のバーが
    10:00 開始の後工程と1列重なる（#163 で一度 `FirstGt` にして #535 で戻した）。詳細は [docs/features/gantt-date-math.md](docs/features/gantt-date-math.md)
  - 生産スケジュール画面は**固定ラベル列＋1つのスクロールコンテナ**（Issue #578）。ヘッダーと本体を別々の `overflow` 要素に
    分けない（両方向の sticky が効かない）。ラベルはバーの外に描かず `renderRowLabel` で列に出す（`hideLabel` は廃止）。
    ページの高さは `100dvh` からレイアウトのヘッダー・余白を引いた値で決め打ちしている。詳細は
    [docs/features/production-schedule-gantt.md](docs/features/production-schedule-gantt.md)
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
- **すべての注文（`/orders`）のフィルタ／バッジ（Issue #558）**: `/orders` は全件の検索・履歴だけを担い、作業の入口は
  「起票の確認」「承認」「送品の消し込み」に置く。**作業ボタン・一括操作・通知カード・ロール依存のタブをここへ戻さない**
  （行は `visibleActions={["view"]}` ＋ `showActionColumns={false}` で、行クリックの確認モーダルだけを全ステータスで開く）。
  `frontend/src/lib/order-utils.ts` の `STATUS_TABS` は **`orders.status` の値だけ**（`StatusFilter = "" | Order["status"]`、#215）で、
  既定は「すべて」。シミュ済みの下書きは「下書き」タブに含める。「情報不足」「工程未入力」など `orders.status` と直交する概念は
  タブを増やさず、一覧行のバッジ（`order-table-row.tsx`）と「起票の確認」の区分（`getIntakeCategory()`）で認知させる。
  廃止した `?status=` の値（`simulated` → 下書き、`action_required` / `incomplete` → すべて）は `toValidStatusFilter()` で寄せる。
  「工程未入力・起票不可」（`has_no_routings`）判定は `isNoRoutingOrder()` に集約し、受注詳細（`orders/[id]/page.tsx` の
  `hasNoRouting`）と条件を揃える。詳細は [docs/features/order-management-ui-design.md](docs/features/order-management-ui-design.md) /
  [docs/features/process-routing-confirmation.md](docs/features/process-routing-confirmation.md)
- **URL クエリを Union 型にキャストするとき（`?status=` 等）**: `searchParams.get(...) as StatusFilter`
  のように無検証で `as` キャストすると、URL 直接編集・ブックマーク由来の未知の値で「該当なし」の誤表示や
  タブの選択状態不整合を起こす（Issue #460 PR #465 Copilotレビュー指摘）。既知の値の集合
  （`STATUS_TABS` の値＋タブ非表示の派生フィルタ等）と照合し、外れていたらデフォルト値へクランプする
  ヘルパー関数を挟むこと（`use-orders-page.ts` の `toValidStatusFilter()` が実装例。廃止した値を別の値へ寄せるのもここで行う）。同様に、ロール等の
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
  - Radix の Popover / Popper 系（コンボボックス等）を開くテストが 1 回 10〜20 秒かかってタイムアウトするときは、
    jsdom の依存 `nwsapi` が 2.2.27 になっていないか確認する（`matches(":modal")` の再帰バグ。2.2.28 以上で解消、Issue #489）
  - 詳細・基盤メンテ時の注意（`@testing-library/dom` を明示 devDep 化、`export *` 禁止、`vite-tsconfig-paths` 不使用の理由）は
    [docs/features/frontend-unit-testing.md](docs/features/frontend-unit-testing.md)
- **型安全**: Backend の Pydantic スキーマと Frontend の TypeScript interface を一致させること
  - Union 文字列型（`Order["status"]` 等）でルックアップテーブルを引くときは `Record<string, T>` ではなく
    `Record<Order["status"], T>` で全ケースを明示する。値が増えたときに型エラーで気づける（PR #409）
- **PATCH で任意項目を空欄にして消すとき**: 更新系のルーターは `model_dump(exclude_unset=True)` で送られたキーだけを
  更新するので、フロントで `value || undefined` と組むと空欄のキーが `JSON.stringify` で落ち、**更新されないまま 200（成功トースト）**
  になる。編集フォームの任意項目は `value.trim() || null` で送り、更新用の型も `string | null` にする（作成時の `undefined` は可）。
  顧客マスタ（Issue #517）・受注の編集ダイアログ（Issue #518）で修正済み。受注側は `desired_deadline` /
  `customer_id`（`orders_dedupe_key` の列）も含め3項目とも空に戻せる方針（DB列がNOT NULLでなく、
  メール起票の下書き等で元々未設定の受注があり既存の「情報不足」運用と整合するため）。
  詳細は [docs/features/order-edit-clear-optional-fields.md](docs/features/order-edit-clear-optional-fields.md)
- **日付文字列のパース（Frontend）**: `orders` の `confirmed_deadline` / `simulated_deadline` /
  `desired_deadline` / `scheduling_start_date` / `order_date` 等は**日付のみ（`"YYYY-MM-DD"`、時刻を持たない）**。
  `new Date("2026-09-08")` は **UTC 深夜**として解釈されるため、端末のタイムゾーン次第で日付が前日にズレる
  （「今日の納期」カウントや一覧の表示日付が1日ずれる）。日付のみのフィールドは必ず
  `parseISO()`（`date-fns`、ローカル深夜として解釈）でパースする。`created_at` 等の**タイムスタンプ**
  （時刻・TZ 付き）は `new Date()` で可（PR #409）
- **受注の納期フィールド**: `orders` には完成見込み日が2本ある。`confirmed_deadline`（承認確定時＝`dry_run=False` に書き込み）と `simulated_deadline`（`POST /orders/{id}/simulate` ＝ `dry_run=True` に書き込み、承認前の「シミュ納期」表示用。Issue #394）。両者は `deadline_from_schedules()`（`services/order_simulation_service.py`）で同一ロジック（最終工程終了日時 → date）で算出する。`PATCH /orders/{id}` で `product_id` / `quantity` / `deadline_date` / `scheduling_start_date` が変わると `simulated_deadline` と `is_scheduled` はクリアされる（`reject` / `withdraw` は据え置き）。詳細は [docs/features/simulation-engine.md](docs/features/simulation-engine.md)
  - 既存受注のシミュ実行＋永続化は `simulate_and_persist()`（同サービス）に集約し、手動シミュ `POST /orders/{id}/simulate` と cron 自動起票（`auto_simulate_intake_order()`）で共有する（Issue #477）。`schedule_order` をテストで差し替えるときは**このサービスモジュール**を `monkeypatch` する（ルーター側には名前が無い）
  - シミュの工程スケジュールは dry_run なので `production_schedules` に残らない。受注詳細で再表示するため、`simulate_and_persist()` が整形済みレスポンスを `order_simulation_results`（1受注1行）に保存し、`GET /orders/{id}/simulation` が**受注が `is_scheduled` かつ `simulated_deadline` ありのときだけ**返す（シミュ納期の無効化で行を消さずに寿命をそろえる）。`orders` の列にしないのは一覧が `select("*")` のため。テストでは工程名・設備名の参照も同じモッククライアントの `select().eq()` を通るので、受注の SELECT の検証は `call_args_list[0]` で見る
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
- **`parse-order-pdfs-trigger/index.ts` を変えたら、マージ後に手で再デプロイする**。マイグレーションは GitHub Actions で自動適用されるが、
  この Edge Function は `infra/terraform` の `terraform apply` でしか本番に出ない。漏れると、バックエンドに cron を足しても本番では
  一度も呼ばれない（#400 の `advance-order-status`、#487 / #490 の日報パース・進捗が本番で動いていなかった）。デプロイ済みの中身は
  `supabase functions download parse-order-pdfs-trigger --project-ref <ref> --use-api` で取得して確認できる
  - GCS の state を読むので先に `gcloud auth application-default login`（VS Code タスク「GCloud Auth Application Login Product Planner」。
    `backend/.env` の `PRODUCT_PLANNER_GCP_PJ_ID` を使う）。Supabase provider は `SUPABASE_ACCESS_TOKEN` が必要で、
    ログイン済みの CLI のトークンは `security find-generic-password -s 'Supabase CLI' -w`（`sbp_...` の平文。base64 デコードしない）で取れる
  - apply で `Provider produced inconsistent result after apply`（`version` / `checksum` / `updated_at`）が出るが provider の不具合で、
    デプロイ自体は成功している。もう一度 `terraform plan` して `No changes` なら state も一致している
- cron は高頻度（10〜15分間隔）で回るため、処理は**冪等**に作る。全テナント横断で動くので `get_supabase_admin_client()` を使う（権限チェックは `CRON_SECRET` で代替）
- エラー時のレスポンスに例外メッセージ（`{exc}`）をそのまま入れない。詳細は `logger.error(..., exc_info=True)` でログにのみ残し、レスポンスは固定文言にする
- **外部へ通知する cron（Slack、Issue #574）**: 通知済みは送信に成功してから行に記録し（失敗時は次回に再送）、通知の判定は
  画面と同じ関数を使う（メール起票は `services/email_intake_outcome.derive_email_intake_outcome()`。`order_parse_log.reason` を
  足したらここの分類集合に登録すると画面と Slack の両方に効く）。httpx の例外文言には送信先 URL（webhook のトークン）が入るので、
  ステータスコードだけをログに残し、独自の例外を `from None` で送出する（ルーターの `exc_info=True` に連鎖させない）。
  受信メールのステージング行のうち、Gmail から来たものは `gmail_message_id` あり、手入力の「メール起票」は NULL で見分ける

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
