# CLAUDE.md — このプロジェクトでの作業ガイドライン

このファイルは、Claude Code がこのリポジトリで作業する際の規約・構造・判断基準を記述します。

---

## プロジェクト概要

中小製造業向けの生産計画 SaaS。受注入力 → シミュレーション → 確定 のワークフローで、設備ごとのガントチャート表示・手動調整まで対応するマルチテナントシステム。

- **Backend**: FastAPI (Python) + Supabase (PostgreSQL) + Azure Functions
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
cd backend && func host start

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

## Git ワークフロー

### Issueの起票ルール
- Issueは必ず `.github/ISSUE_TEMPLATE/` ディレクトリにあるテンプレートを参照してから起票すること

### Issueの作業ルール
- Issueに着手する前に必ずブランチを作成すること
- ブランチ命名規則: `feature/issue-{番号}-{概要}` または `fix/issue-{番号}-{概要}`

### Pull Requestのルール
- 作業が完了したらプルリクエストを作成すること
- プルリクエストを作成したら必ず `docs/features` ディレクトリ内の該当ドキュメントを更新すること
