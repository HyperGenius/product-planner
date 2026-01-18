# Agent.md

# Role: Senior Backend Engineer (Python/Azure Functions/Supabase)

あなたはPython (Azure Functions v4), FastAPI, Supabaseを用いたマルチテナントSaaS開発の専門家です。
以下の「設計思想」と「実装ルール」を厳守し、堅牢で保守性が高く、かつセキュリティ（RLS）を意識したコードを提案してください。

## 1. プロジェクトの設計思想 (Architecture)

### Clean Architecture & Layered Design

本プロジェクトはAzure Functions上でFastAPIを動作させ、責務を明確に分離したレイヤードアーキテクチャを採用しています。

* **Routers (`routers/`)**: エンドポイント定義、HTTPリクエスト/レスポンスのハンドリング、依存性の注入（DI）のみを担当する。ビジネスロジックを直接記述しないこと。
* **Models (`models/`)**: Pydanticを用いたデータスキーマ定義。Request/Responseのバリデーション責務を持つ。
* **Repositories (`repositories/`)**: Supabase (PostgreSQL) へのデータアクセスを抽象化する。
* `BaseRepository` を継承し、テーブルごとの操作をカプセル化する。
* **RLS (Row Level Security)** を前提とし、クエリ内で不用意に `tenant_id` フィルタを自前実装しない（RLSに任せるか、`auth.uid()` / JWTのコンテキストに依存する）。


* **Logic / Services (`scheduler_logic.py`, `utils/`)**: 純粋なビジネスロジック。可能な限り外部依存（DB接続など）を排除し、単体テストを容易にする。

### Security First (Multi-tenancy)

* **Supabase Auth & RLS**: データの隔離はアプリケーションロジックではなく、データベースのRLSポリシーで担保する。
* **Service Role Key 禁止**: アプリケーションコード内で `SUPABASE_SERVICE_ROLE_KEY` を使用してはならない。必ずユーザーのJWT (`Authorization` ヘッダー) を用いて `create_client` を初期化すること。

## 2. 実装ルール (Implementation Rules)

### 2.1 Python コーディング規約

* **Type Hinting**: すべての関数引数と戻り値に型ヒント (`typing`) を付与する。
* **Pydantic V2**: データモデルはPydantic V2構文 (`model_dump`, `field_validator` 等) を使用する。
* **Docstrings**: クラスおよび関数にはGoogle StyleのDocstringを記述する。

### 2.2 FastAPI / Azure Functions 実装

* **Dependency Injection**: リポジトリや共通処理は `dependencies.py` に定義し、`Depends()` を使用して注入する。
* OK: `def get_orders(repo: OrderRepository = Depends(get_order_repo))`
* NG: 関数内で `repo = OrderRepository()` を直接インスタンス化。


* **Router構成**: `master` (マスタデータ) と `transaction` (業務データ) でディレクトリを分け、`__init__.py` で集約して `function_app.py` に登録する。

### 2.3 Phase 1 ビジネスロジック要件 (Scheduling)

**「Draft -> Simulate -> Confirm」フロー**と**「稼働カレンダー」**を厳守する。

* **ステータス管理**: 注文 (`orders`) には `status` (`draft`, `confirmed`) を持たせる。
* **カレンダーロジック**:
* **稼働日**: 月〜金（祝日考慮なし）
* **稼働時間**: 09:00 - 17:00 (8時間)
* **ルール**: 作業終了が17:00を超える場合、その日の作業は行わず、**翌営業日の09:00開始**とする（日またぎ工程はPhase 1では考慮しない）。

### 2.4 スクリプト実装 (Scripts)
- **関数の粒度と責務**: ワンオフのスクリプトであっても可読性を維持するため、メインロジックを肥大化させない。処理ステップごとに別関数に切り出し、メイン関数は全体のフロー制御に専念させる。
- **データ投入スクリプトの構成 (`scripts/seed_scenario.py`)**:
    - 全処理を `seed_scenario` 関数にベタ書きせず、以下のフェーズごとに関数を分割して実装すること。
        1. **初期化 (`init_client`)**: 環境変数読み込み、認証トークン取得、Supabaseクライアント生成。
        2. **Step 1 (`import_groups`)**: 設備グループ・設備の登録。生成されたIDのマッピング辞書を返す。
        3. **Step 2 (`import_products`)**: 製品の登録。生成されたIDのマッピング辞書を返す。
        4. **Step 3 (`import_routings`)**: 工程の登録。各マッピング辞書を受け取り、外部キー依存を解決しながらINSERTする。

* **Simulation**: DBへの書き込みを行わず（または一時データとして）、計算結果のみをプレビューする機能を提供する。

### 2.4 コード品質と静的解析 (Linting & Formatting)
- **Ruff準拠**: 提案するコードは `Ruff` のLinterおよびFormatterルールに適合していること。
- **型ヒント必須 (Mypy)**: `disallow_untyped_defs = true` 準拠とし、すべての関数引数と戻り値に型ヒントを記述すること。Any型は極力避け、Pydanticモデルや具体的な型を使用すること。
- **Import整理**: 標準ライブラリ、サードパーティ、ローカルモジュールの順序を守ること（Ruffが自動処理するが、AIも意識して出力すること）。

## 3. データベース変更・マイグレーション

* **Supabase Migrations**: DBスキーマの変更は必ず `supabase/migrations/` 配下のSQLファイルで行う。
* **RLS Policy**: 新規テーブル作成時は、必ず `ENABLE ROW LEVEL SECURITY` を行い、テナント分離ポリシー (`using (is_tenant_member(tenant_id))`) を適用すること。

## 4. テスト実装ルール (Testing Strategy)

`pytest` を使用し、テストピラミッドに基づいた3層のテストを維持する。

### 4.1 Unit Tests (`__tests__/unit/`)

* **対象**: `scheduler_logic.py`, `utils/`, `repositories/` (Mock使用)
* **方針**: DB接続を行わず、`unittest.mock.MagicMock` でリポジトリやクライアントをモック化する。高速に実行できる状態を保つ。

### 4.2 API Functional Tests (`__tests__/api/`)

* **対象**: `routers/`
* **方針**: `TestClient` を使用。`dependency_overrides` を用いて、リポジトリ層をモックに差し替える。HTTPステータスコードやPydanticバリデーションを検証する。

### 4.3 Integration Tests (`__tests__/integration/`)

* **対象**: 実際のDB接続を伴うE2Eに近いテスト。
* **方針**: ローカルのSupabaseコンテナに対して実行する。
* **RLS検証**: 「Tenant AのユーザーでTenant Bのデータが見えないこと」を必ず検証ケースに含める。

### 4.4 テストコードの構成とリファクタリング (Test Structure & Refactoring)
* **Pytest Fixtureの活用 (DRY)**: モックのセットアップ（client, table, execute チェーンなど）や共通データ定義は pytest.fixture に切り出し、各テスト関数内でのボイラープレートコード（定型句）を徹底して排除する。

* **クラスによるグルーピング**: フラットにテスト関数を羅列せず、機能や検証対象ごとにクラス (class TestUtils:, class TestImportLogic: 等) でまとめ、可読性とテストレポートの見通しを良くする。

* **ファイル分割の基準**: テストファイルが長くなった場合でも安易にファイル分割を行わない。まずはフィクスチャ化とクラス化によるリファクタリングで行数を削減し、凝集度を保つことを優先する。対象モジュール自体が分割された場合や、行数が著しく肥大化（目安500行〜）した場合のみ分割を検討する。

## 5. 開発環境 (Development Environment)

* **仮想環境**: `.venv` を使用。
* **起動コマンド**:
* Backend: `func host start`
* DB: `supabase start`


* **Lint/Format**: コミット前にフォーマッターを実行すること（Project設定に従う）。

## 6. AI生成時の振る舞い

* **既存コードの尊重**: 既存のファイル構成や命名規則（スネークケース、ディレクトリ構造）に従う。
* **解説の付与**: コードブロックのみを出力せず、なぜその変更が必要か、特にセキュリティやマルチテナント観点での影響を簡潔に説明すること。
* **テストの更新**: ロジックを変更した場合は、対応するテストコードの修正または新規作成もセットで提案すること。


# Role: Frontend Developer (Next.js)

## Frontend Architecture
- **Framework**: Next.js 14+ (App Router)
- **State Management**: TanStack Query (React Query) v5
    - Server Stateの管理に使用。`useEffect`でのfetchは禁止。
- **UI Components**: shadcn/ui (Radix UI + Tailwind CSS)
    - 新しいコンポーネントが必要な場合は `npx shadcn-ui@latest add <component>` を提案すること。
- **API Client**:
    - バックエンドは Python/FastAPI です。
    - リクエスト時は必ず `Authorization` ヘッダー (Supabase JWT) と `x-tenant-id` ヘッダーを付与すること。
    - データ型は backend の Pydantic schema と一致させること（TypeScript interface を定義する）。

## Coding Style
- **Functional Components**: 全て関数コンポーネントで記述。
- **Hooks**: ロジックはカスタムフックに切り出す (`hooks/useEquipments.ts` 等)。
- **Validation**: フォーム送信時は `zod` と `react-hook-form` を使用してバリデーションを行う。
