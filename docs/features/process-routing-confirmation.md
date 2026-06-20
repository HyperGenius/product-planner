# 工程確定UI（is_confirmed）

Issue #197 / #199 で実装。

## 概要

工程ルーティング（`process_routings`）に確定フラグを追加し、`admin` ロールのみが確定操作を行えるよう制限する機能。

## DB スキーマ変更

`supabase/migrations/20260620000000_add_confirmed_fields_to_process_routings.sql` にて追加:

| カラム | 型 | デフォルト | 説明 |
|---|---|---|---|
| `is_confirmed` | boolean NOT NULL | false | 確定フラグ |
| `confirmed_by` | uuid (FK auth.users) | NULL | 確定操作を行ったユーザーID |
| `confirmed_at` | timestamptz | NULL | 確定日時 |

## Backend

### ロール取得ヘルパー

`backend/app/dependencies.py` に `get_current_user_role(tenant_id, user_id, client) -> str` を追加。`organization_members` テーブルから `role` を取得する。

### PATCH エンドポイントのガード

`PATCH /process-routings/{id}` で `is_confirmed` を含むリクエストの場合:
- 呼び出し元ユーザーのロールを確認
- `admin` でなければ HTTP 403 を返す
- `is_confirmed=true` の場合、`confirmed_by` と `confirmed_at` を自動セット
- `is_confirmed=false`（取消）の場合、両フィールドを NULL にリセット

## Frontend

### 型定義

`frontend/src/types/process-routing.ts` の `ProcessRouting` に `is_confirmed`, `confirmed_by`, `confirmed_at` を追加。`ProcessRoutingUpdate` に `is_confirmed?: boolean` を追加。

### UI（`product-routings-dialog.tsx`）

- 工程リストに「確定」列を追加
  - `admin` ユーザー: チェックボックス形式のトグルボタンを表示。クリックで確定/取消
  - `member` ユーザー: 鍵アイコン（`Lock`）を表示し操作不可
- 確定済み工程の工程名に緑色バッジ（「確定済み」）を表示
- 確定取消時は AlertDialog で「確定を取り消しますか？」確認ダイアログを表示
- `useCurrentMember()` フックでロールを判定
