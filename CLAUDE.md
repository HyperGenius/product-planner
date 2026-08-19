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

---

## 重要な実装ルール

- **RLS 必須**: 新規テーブルには必ず `ENABLE ROW LEVEL SECURITY` と `is_tenant_member(tenant_id)` ポリシーを設定
- **Service Role Key 禁止**: アプリコード内で `SUPABASE_SERVICE_ROLE_KEY` を使用しない。必ずユーザー JWT を使用
- **DB 変更**: `supabase/migrations/` に SQL ファイルを追加すること。直接スキーマ変更禁止
- **ガントチャート**: `frontend/src/gantt/` のカスタム実装を使用。`gantt-task-react` は削除済みのため参照しない
- **データ取得**: TanStack Query (`useQuery` / `useMutation`) で統一。`useEffect` でのフェッチ禁止
- **型安全**: Backend の Pydantic スキーマと Frontend の TypeScript interface を一致させること
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

## Git ワークフロー

### Issueの起票ルール
- Issueは必ず `.github/ISSUE_TEMPLATE/` ディレクトリにあるテンプレートを参照してから起票すること

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
