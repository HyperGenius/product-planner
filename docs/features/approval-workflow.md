# 承認依頼送信・承認・却下ワークフロー (Issue #325)

## 概要

[受注ステータス遷移](order-status-workflow.md)（Issue #324）で用意した `draft → pending_approval →
confirmed` の土台に対し、実際に状態を遷移させるAPI/UIを実装した。表記揺れ確認・修正は
order_handler へディスパッチし、president は最終承認（および却下）のみを行うという業務分担を実現する。

## ステータス遷移とAPIエンドポイント

| 遷移 | エンドポイント | 許可ロール |
|---|---|---|
| `draft → pending_approval` | `POST /orders/{id}/request-approval` | `order_handler` |
| `pending_approval → confirmed` | `POST /orders/{id}/confirm` | `president` |
| `pending_approval → confirmed`（複数件） | `POST /orders/approve-bulk`（body: `order_ids`） | `president` |
| `pending_approval → draft`（却下） | `POST /orders/{id}/reject`（body: `reason`、任意） | `president` |

いずれも `backend/app/routers/transaction/orders.py` の
[order_status_service.py](../../backend/app/services/order_status_service.py) 経由の遷移バリデーションと、
`app.dependencies.get_current_user_role()` によるロールチェック（`_require_role` ヘルパー）を通す。
対象ロール以外からのリクエストは403で拒否される。

`request-approval` は `confirm` 同様、`product_id` が未確定（`None`）の場合は422
（`{"error": "product_unmatched"}`）で拒否する。

`POST /orders/{id}/confirm` は既存のスケジュール確定ロジック（`_confirm_single_order`）をそのまま使う。
`approve-bulk` は同じヘルパーをループで呼び出し、1件ごとの成否を `results` 配列で返す
（1件が404/422/400等で失敗しても他の注文の処理は継続する）。

## 却下理由

`orders.rejection_reason`（nullable text、
[20260810000003_add_orders_rejection_reason.sql](../../supabase/migrations/20260810000003_add_orders_rejection_reason.sql)）
に任意入力の却下理由を保存する。`request-approval` で再度承認依頼を送信した時点で `NULL` にクリアされる。

## Frontend

- `frontend/src/hooks/use-orders.ts`: `useRequestApproval` / `useRejectOrder` / `useApproveOrdersBulk` を追加
- ロール判定は `useCurrentMember()`（`frontend/src/hooks/use-tenant-members.ts`）の `role` を使用
- 受注一覧（`frontend/src/app/orders/page.tsx`, `order-table-row.tsx`）:
  - `draft` かつシミュレーション済みの注文には、`order_handler` にのみ「承認依頼を送信」ボタンを表示
    （旧「確定」ボタンを置き換え。`draft → confirmed` の直接遷移は #324 時点で既に不可になっているため）
  - `pending_approval` の注文には、`president` にのみ「承認」「却下」ボタンを表示
  - 「承認待ち」ステータスタブ（`STATUS_TABS`）を追加
  - `president` は「承認待ち」タブでチェックボックス選択→一括承認バーから `approve-bulk` を呼び出せる
- 受注詳細（`frontend/src/app/orders/[id]/page.tsx`）: 一覧と同様に承認依頼送信／承認／却下ボタンを表示
- シミュレーション結果サイドシート・一括シミュレーション結果ダイアログの「確定」系ボタンも
  「承認依頼を送信」に統一（シミュレーション自体は `draft` 状態の注文に対して行うため、確定ではなく
  承認依頼送信が正しい遷移になる）
- 却下ダイアログ（`frontend/src/components/orders/reject-order-dialog.tsx`）: 却下理由を任意入力できる
  シンプルなダイアログ

## テスト

- `backend/__tests__/api/routers/transaction/test_orders.py`: 各エンドポイントのロール別403、
  ステータス遷移バリデーション違反、`request-approval` の `product_unmatched`、`approve-bulk` の
  部分失敗（1件成功・1件404）を検証

## 操作主体の記録（監査ログ基盤） (Issue #326)

共有端末での操作であっても、承認依頼送信・承認・却下の各操作を実行したユーザーと日時をアプリ層で記録し、
ISO要件である承認プロセスの証跡を残す。

### データモデル

- `order_approval_log`
  （[20260811000000_add_order_approval_log.sql](../../supabase/migrations/20260811000000_add_order_approval_log.sql)）
  - `id, tenant_id, order_id, action(request_approval/approve/reject), actor_user_id, reason, created_at`
  - RLS: `is_tenant_member(tenant_id)` に加え、SELECTは `organization_members.role` が
    `iso_officer` / `president` / `platform_admin` のいずれかであることを要求（`order_handler` は
    自身の操作ログであっても閲覧不可とし、監査ログとしての独立性を保つ）。INSERTは
    `actor_user_id = auth.uid()` を要求し、なりすまし記録を防ぐ。
- `backend/app/repositories/supa_infra/transaction/order_approval_log_repo.py`:
  `OrderApprovalLogRepository.log_action()` / `get_all()` / `get_by_order_id()`

### 記録タイミング

`backend/app/routers/transaction/orders.py` の各エンドポイントで、状態遷移の更新が成功した直後に
`_log_approval_action_safely()`（内部で `approval_log_repo.log_action(...)` を呼ぶ）を実行する。

| エンドポイント | action | reason |
|---|---|---|
| `POST /orders/{id}/request-approval` | `request_approval` | なし |
| `POST /orders/{id}/confirm` | `approve` | なし |
| `POST /orders/approve-bulk` | `approve`（成功した注文ごと） | なし |
| `POST /orders/{id}/reject` | `reject` | 却下理由（任意） |

監査ログの記録はベストエフォートとする（`_log_approval_action_safely`
が例外を捕捉してログ出力のみ行う）。状態遷移自体は既にDB更新が成功しているため、
監査ログ書き込みの失敗（一時的なDB不調等）で業務上成功した操作をエラー扱いにしない。
特に `approve-bulk` は複数注文をループ処理するため、1件のログ記録失敗で他の注文の
確定結果まで失われて500になることを避ける。

`OrderApprovalLogRepository.log_action()` はINSERT時に `returning=ReturnMethod.minimal`
を指定する。デフォルトの `returning=representation`（`BaseRepository.create()` の挙動）のままだと、
PostgRESTがINSERT結果を返す際にSELECT用RLSポリシー（`iso_officer`/`president`/`platform_admin`限定）
を評価してしまい、閲覧権限を持たない `order_handler` からの書き込みそのものが失敗する
（`42501 new row violates row-level security policy` で500になる不具合があった）。

### 閲覧・出力API

- `GET /orders/approval-logs`（`iso_officer` / `president` / `platform_admin` のみ）: 監査ログ一覧を
  新しい順に返す。`order_number` と操作者の `actor_full_name` / `actor_email` を
  `orders` / `profiles` テーブルから補完して返す（`_fetch_enriched_approval_logs`）。
  補完クエリは呼び出し元ユーザー自身のJWTクライアント（`get_supabase_client`）で行い、
  Service Role Key（`get_supabase_admin_client`）は使わない。`orders`・`profiles` はいずれも
  「同一テナントのメンバーなら閲覧可」というRLSを既に持つため、`_require_any_role` で
  閲覧許可ロールであることを検証済みのユーザーであれば、RLSをバイパスせず素通しで参照できる。
- `GET /orders/approval-logs/export`（同ロール限定）: 同内容をCSV（BOM付きUTF-8、Excel向け）で
  ダウンロードする。
- ルーティング順序の都合上、`/orders/{order_id}` より前に定義する必要がある
  （`{order_id}: int` へのパス変換失敗で `/approval-logs` が誤って先にマッチするのを防ぐため）。

### Frontend

- `frontend/src/hooks/use-orders.ts`: `useApprovalLogs({ enabled })`（一覧取得。閲覧不可ロールで
  無駄な403リクエストを飛ばさないよう、呼び出し側がロール確定後にのみ `enabled: true` を渡す設計）、
  `downloadApprovalLogsCsv()`（CSVダウンロード、JSON以外を返すため `apiClient` を使わず直接 `fetch`）
- `frontend/src/app/orders/approval-logs/page.tsx`: 監査ログ一覧画面。
  `useCurrentMember()` の `role` が `iso_officer` / `president` / `platform_admin` 以外の場合は
  アクセス不可メッセージを表示し、編集・承認操作用のUIは一切持たない（閲覧・出力のみ）。
  `useApprovalLogs({ enabled: !isMemberLoading && canView })` として、ロール確定前・閲覧不可ロールでは
  一覧取得APIを呼び出さない。
- サイドバー（`frontend/src/components/layout/app-sidebar.tsx`）に「承認監査ログ」リンクを追加
  （ページ側でロールチェックするため、リンク自体は全ロールに表示）。

### テスト

- `backend/__tests__/api/routers/transaction/test_orders.py`:
  各操作エンドポイントで監査ログが正しい引数で記録されること、`GET /orders/approval-logs` /
  `/export` が `iso_officer`/`president` では成功し `order_handler` では403になること、
  CSVレスポンスの内容を検証
