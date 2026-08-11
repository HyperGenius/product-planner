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
