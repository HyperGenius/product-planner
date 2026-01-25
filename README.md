# Product Planner 🏭

中小規模製造業向けの、自動化とAIを活用した生産管理・ガントチャート自動生成アプリケーション。
「経験と勘」に頼った生産計画から脱却し、即座な納期回答と最適な設備稼働を実現します。

## 📖 概要

顧客からの引き合いに対して、製品と数量を入力するだけで設備の空き状況を自動計算し、**「確約可能な納期」**を即座に回答するためのMVP（Minimum Viable Product）です。

### 主な機能

* **マスタ管理**: 製品、工程順序（ルーティング）、設備、設備グループの管理。
* **受注シミュレーション**: 注文入力時のリアルタイムな納期計算（Dry Run）。
* **自動スケジューリング**: フォワードスケジューリングによるガントチャートデータの生成。
* **マルチテナント**: Supabase RLS（Row Level Security）による堅牢なデータ分離。

## 🛠 技術スタック

### Frontend

* **Framework**: [Next.js 14+](https://nextjs.org/) (App Router)
* **Language**: TypeScript
* **Styling**: Tailwind CSS, [shadcn/ui](https://ui.shadcn.com/)
* **State Management**: TanStack Query (React Query) v5

### Backend

* **Runtime**: Python 3.11
* **Framework**: [Azure Functions](https://learn.microsoft.com/azure/azure-functions/) (v4 Programming Model), [FastAPI](https://fastapi.tiangolo.com/)
* **Architecture**: Clean Architecture / Repository Pattern

### Database & Auth

* **Platform**: [Supabase](https://supabase.com/) (Self-hosted via Docker for local dev)
* **DB**: PostgreSQL 15+
* **Auth**: Supabase Auth (JWT)

---

## 📂 ディレクトリ構成

```text
.
├── backend/            # Python Azure Functions (API)
│   ├── app/            # アプリケーションコード (Routers, Models, Logic)
│   ├── tests/          # Pytest (Unit, Integration)
│   └── scripts/        # データ投入用スクリプト
├── frontend/           # Next.js (Web UI)
├── supabase/           # DB Migrations, Seeds, Config
└── docs/               # プロジェクトドキュメント

```

---

## 🚀 開発環境のセットアップ

### 前提条件

* Node.js 18+
* Python 3.11
* Docker Desktop
* [Supabase CLI](https://supabase.com/docs/guides/cli)
* [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local)

### 1. データベース (Supabase) の起動

ローカルでSupabaseを立ち上げます。

```bash
supabase start

```

起動後、出力される `API URL` と `anon key` を控えておきます。

### 2. バックエンド (Backend) のセットアップ

```bash
cd backend

# 仮想環境の作成と有効化
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# 依存関係のインストール
pip install -r requirements-dev.txt

# 環境変数の設定 (.envを作成)
cp .env.example .env
# .env 内の SUPABASE_URL, SUPABASE_ANON_KEY などを手順1の値に設定

# サーバー起動
func host start

```

APIは `http://localhost:7071/api` で起動します。

### 3. フロントエンド (Frontend) のセットアップ

```bash
cd frontend

# 依存関係のインストール
npm install

# 環境変数の設定 (.env.localを作成)
cp .env.local.example .env.local
# NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_API_URL などを設定

# 開発サーバー起動
npm run dev

```

ブラウザで `http://localhost:3000` にアクセスします。

---

## 🧪 デモデータの投入

開発用に定義されたシナリオデータを投入するスクリプトを用意しています。
`backend/.env` に `TEST_USER_EMAIL` 等の設定が必要です。

```bash
cd backend
# "standard_demo" シナリオを投入
python scripts/seed_scenario.py standard_demo

```

これにより、製品A〜E、設備グループ、工程定義などが一括で登録されます。

---

## 📚 ドキュメント

プロジェクトの詳細な設計情報は `docs/` ディレクトリを参照してください。

* **[Product Vision](https://www.google.com/search?q=docs/product_vision.md)**: プロダクトの目的とユーザージャーニー。
* **[Roadmap](https://www.google.com/search?q=docs/roadmap.md)**: 開発フェーズと優先順位。
* **[UI Design](https://www.google.com/search?q=docs/ui_design.md)**: 画面構成とUIガイドライン。
* **[Testing Strategy](https://www.google.com/search?q=docs/testing_strategy.md)**: テストの方針と実装ルール。

---

## ✅ テストの実行

バックエンドのテスト（Unit & Integration）には `pytest` を使用します。

```bash
cd backend

# 全テスト実行
pytest

# ユニットテストのみ（高速）
pytest -m unit

# 統合テストのみ（DB接続あり・要Supabase起動）
pytest --run-integration

```

---

## 🔐 セキュリティ

本プロジェクトはマルチテナントアーキテクチャを採用しており、すべてのテーブルで **RLS (Row Level Security)** が有効化されています。アプリケーションコードではなく、データベースレベルでテナント間のデータ分離を強制しています。
