# 承認依頼送信・承認・差し戻しワークフロー (Issue #325)

## 概要

[受注ステータス遷移](order-status-workflow.md)（Issue #324）で用意した `draft → pending_approval →
confirmed` の土台に対し、実際に状態を遷移させるAPI/UIを実装した。表記揺れ確認・修正は
order_handler へディスパッチし、president は最終承認（および差し戻し）のみを行うという業務分担を実現する。

> **用語について**: `pending_approval → draft` への逆遷移を業務上「差し戻し」と呼ぶ。
> 内部実装（DBのaction値・エンドポイントパス・関数名等）では最初に実装した際の名残で `reject` を
> 使っているが、UI上のラベル・トースト・監査ログ表示はすべて「差し戻し」に統一している
> （Issue #326 のE2Eフィードバックで「却下」という強い語感が実態と合わないため改称）。

## ステータス遷移とAPIエンドポイント

| 遷移 | エンドポイント | 許可ロール |
|---|---|---|
| `draft → pending_approval` | `POST /orders/{id}/request-approval` | `order_handler` |
| `pending_approval → confirmed` | `POST /orders/{id}/confirm` | `president` |
| `pending_approval → confirmed`（複数件） | `POST /orders/approve-bulk`（body: `order_ids`） | `president` |
| `pending_approval → draft`（差し戻し／内部名`reject`） | `POST /orders/{id}/reject`（body: `reason`、任意） | `president` |
| `pending_approval → draft`（取り下げ） | `POST /orders/{id}/withdraw-approval` | `order_handler` |

いずれも `backend/app/routers/transaction/orders.py` の
[order_status_service.py](../../backend/app/services/order_status_service.py) 経由の遷移バリデーションと、
`app.dependencies.get_current_user_role()` によるロールチェック（`_require_role` ヘルパー）を通す。
対象ロール以外からのリクエストは403で拒否される。

`request-approval` は `confirm` 同様、`product_id` が未確定（`None`）の場合は422
（`{"error": "product_unmatched"}`）で拒否する。

`POST /orders/{id}/confirm` は既存のスケジュール確定ロジック（`_confirm_single_order`）をそのまま使う。
`approve-bulk` は同じヘルパーをループで呼び出し、1件ごとの成否を `results` 配列で返す
（1件が404/422/400等で失敗しても他の注文の処理は継続する）。

### 取り下げ（`withdraw-approval`） (Issue #326 フォローアップ)

order_handler が誤って承認依頼を送信してしまった場合、president による差し戻しを待たずに
自分自身で `pending_approval → draft` に戻せる。president の差し戻しとは異なり理由の入力欄は無く、
`orders.rejection_reason` も変更しない（業務上の指摘ではなく単なる取り消しのため）。
監査ログ上は `reject` とは別の `withdraw` actionとして記録し、「業務判断としての差し戻し」と
「送信者本人による取り消し」を区別できるようにしている。

## 差し戻し理由

`orders.rejection_reason`（nullable text、
[20260810000003_add_orders_rejection_reason.sql](../../supabase/migrations/20260810000003_add_orders_rejection_reason.sql)）
に任意入力の差し戻し理由を保存する。`request-approval` で再度承認依頼を送信した時点で `NULL` にクリアされる。

`order_handler` から理由が見えず、内容を直さないまま再送信できてしまう問題（Issue #326 のE2E
フィードバック）に対応するため、フロントエンドでは以下の2段構えで可視化・注意喚起している。

1. **常時表示**: `draft` ステータスかつ `rejection_reason` が設定されている注文には、受注一覧の
   ステータスバッジ横にアイコン＋ツールチップ（`order-table-row.tsx`）、受注詳細ページには
   理由全文を表示するアラートパネル（`orders/[id]/page.tsx`）を表示する。閲覧はロール制限なし
   （order_handler含め誰でも見える）。
2. **再送信前の確認**: `rejection_reason` が設定されたままの注文に対して「承認依頼を送信」を押すと、
   理由を表示する確認ダイアログを挟んでから送信する（一覧・詳細どちらも同様）。
   実際に内容を修正したかどうかまでは検証しない（ソフトな注意喚起であり、ハードなブロックではない）。
   Issue #338 でこのダイアログは通常の承認依頼確認モーダル（下記）に統合された。

## Frontend

- `frontend/src/hooks/use-orders.ts`: `useRequestApproval` / `useRejectOrder` /
  `useWithdrawApproval` / `useApproveOrdersBulk` を追加
- ロール判定は `useCurrentMember()`（`frontend/src/hooks/use-tenant-members.ts`）の `role` を使用
- 受注一覧（`frontend/src/app/orders/page.tsx`, `order-table-row.tsx`）:
  - `draft` かつシミュレーション済みの注文には、`order_handler` にのみ「承認依頼を送信」ボタンを表示
    （旧「確定」ボタンを置き換え。`draft → confirmed` の直接遷移は #324 時点で既に不可になっているため）
  - `pending_approval` の注文には、`president` にのみ「承認」「差し戻し」ボタン、`order_handler`
    にのみ「取り下げ」ボタンを表示（president/order_handlerで排他、同時には出ない）
  - 「承認待ち」ステータスタブ（`STATUS_TABS`）を追加
  - `president` は「承認待ち」タブでチェックボックス選択→一括承認バーから `approve-bulk` を呼び出せる
- 受注詳細（`frontend/src/app/orders/[id]/page.tsx`）: 一覧と同様に承認依頼送信／承認／差し戻し／
  取り下げボタンを表示。「承認依頼を送信」ボタンはクリック後もページ遷移せずその場に留まる
  （送信直後に一覧へ強制遷移されて混乱するというIssue #326のE2Eフィードバックに対応。
  「承認」ボタンは対象注文がその場では操作不要になるため、従来通り一覧へ遷移する）
- シミュレーション結果サイドシート・一括シミュレーション結果ダイアログの「確定」系ボタンも
  「承認依頼を送信」に統一（シミュレーション自体は `draft` 状態の注文に対して行うため、確定ではなく
  承認依頼送信が正しい遷移になる）
- 差し戻しダイアログ（`frontend/src/components/orders/reject-order-dialog.tsx`、コンポーネント名は
  実装当初の名残で `RejectOrderDialog` のまま）: 差し戻し理由を任意入力できるシンプルなダイアログ

## テスト

- `backend/__tests__/api/routers/transaction/test_orders.py`: 各エンドポイントのロール別403、
  ステータス遷移バリデーション違反、`request-approval` の `product_unmatched`、`approve-bulk` の
  部分失敗（1件成功・1件404）、`withdraw-approval` の成功/403/400/404を検証

## 操作主体の記録（監査ログ基盤） (Issue #326)

共有端末での操作であっても、承認依頼送信・承認・差し戻し・取り下げの各操作を実行したユーザーと日時を
アプリ層で記録し、ISO要件である承認プロセスの証跡を残す。

### データモデル

- `order_approval_log`
  （[20260811000000_add_order_approval_log.sql](../../supabase/migrations/20260811000000_add_order_approval_log.sql)、
  action追加は
  [20260811000001_add_withdraw_action_to_order_approval_log.sql](../../supabase/migrations/20260811000001_add_withdraw_action_to_order_approval_log.sql)）
  - `id, tenant_id, order_id, action(request_approval/approve/reject/withdraw), actor_user_id, reason, created_at`
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
| `POST /orders/{id}/reject` | `reject`（UI表示は「差し戻し」） | 差し戻し理由（任意） |
| `POST /orders/{id}/withdraw-approval` | `withdraw`（UI表示は「取り下げ」） | なし |

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
- サイドバー（`frontend/src/components/layout/app-sidebar.tsx`）に「承認監査ログ」リンクを追加。
  当初はページ側のロールチェックのみに依存し、リンク自体は全ロールに表示していたが、
  `order_handler` にもクリックできてしまいアクセス拒否画面が出る体験だったため、
  Issue #337 で表示自体もロール制御するよう変更（defense in depth）。
  `frontend/src/types/member.ts` の `ORDER_APPROVAL_LOG_VIEWER_ROLES`（`iso_officer` / `president` /
  `platform_admin`）を `page.tsx` の `canView` 判定とサイドバーの両方から共通参照する。
  `MenuItem` 型に `allowedRoles?: MemberRole[]` を追加し、指定された項目のみ `useCurrentMember()` の
  ロールでフィルタする。ロール未確定（`isMemberLoading`）の間は `allowedRoles` 付き項目を表示しない。

### テスト

- `backend/__tests__/api/routers/transaction/test_orders.py`:
  各操作エンドポイントで監査ログが正しい引数で記録されること、`GET /orders/approval-logs` /
  `/export` が `iso_officer`/`president` では成功し `order_handler` では403になること、
  CSVレスポンスの内容を検証

## 承認依頼・承認の事前確認モーダル (Issue #338)

「承認依頼を送信」「承認」は受注ステータスを不可逆に進める操作だが、従来は（差し戻し理由が
残っている場合を除き）確認なしのワンクリックで即実行されていた。誤クリックによる意図しない
実行を防ぐため、実行前に対象注文の主要項目（注文番号・製品・数量・希望納期、承認確認では
確定納期も）と、送信先（承認依頼では「承認者（president）に通知が送信されます」）を表示する
確認モーダルを一覧・詳細ページの両方に追加した。

- `frontend/src/components/orders/request-approval-confirm-dialog.tsx`
  （`RequestApprovalConfirmDialog`）: 承認依頼送信の確認モーダル。`order.rejection_reason` が
  設定されている場合は差し戻し理由も同じモーダル内に表示し、Issue #326
  の再送信確認ダイアログと二重表示にならないよう統合した。
- `frontend/src/components/orders/approve-confirm-dialog.tsx`（`ApproveConfirmDialog`）:
  承認（確定）の確認モーダル。
- どちらも `reject-order-dialog.tsx` / `delete-order-dialog.tsx` と同じ `AlertDialog` ベースの
  トンマナで統一。キャンセル時はAPIを呼ばずモーダルを閉じるのみ。
- 一覧ページの行内アクション（`handleApproveFromRow` / `handleRequestApprovalFromRow`、
  `use-orders-page.ts`）と詳細ページのボタン（`handleApproveClick` / `handleRequestApprovalClick`、
  `orders/[id]/page.tsx`）は、いずれも直接APIを呼ばず対象注文をモーダル用stateにセットするだけに
  変更し、実際の実行はモーダルの確定コールバック（`handleConfirmApprove` /
  `handleConfirmRequestApproval`）に一本化した。
- `OrderTableRow` の `onApprove` は `(orderId, orderNo)` から `(order: Order)` に変更し、
  `onRequestApproval` / `onReject` と同じシグネチャに揃えた。
- 一括承認依頼（`BulkActionBar` → `handleBulkRequestApprovalRequest`）・一括承認
  （`handleBulkApproveRequest`）も、実行前に対象注文一覧を表示する確認モーダル
  （`bulk-request-approval-confirm-dialog.tsx` / `bulk-approve-confirm-dialog.tsx`、
  `bulk-simulate-confirm-dialog.tsx` と同じ一覧表示パターン）を挟むようにした。
  ただし `BulkSimulateSummaryDialog` からの一括承認依頼（`handleBulkRequestApprovalFromSummary`）は、
  シミュレーション結果画面で既に対象一覧を確認済みの導線のため対象外とした。

## 承認依頼のアプリ内通知 (Issue #327)

`request-approval`（`draft → pending_approval`）成功時、president 向けに `notifications`
テーブルへ `approval_requested` 通知を書き込む。メール確認依頼で発生していた「返信が来ない」
問題の代替として、アプリ内で完結させる狙い。`approve-bulk` からの一括承認時は既存の通知に
対する操作（既読化等）のみで、新規通知の書き込みは発生しない
（一括承認対象はいずれも `request-approval` 送信時に既に通知済みのため）。

社長ダッシュボード（ホーム画面）には `pending_approval` 件数が1件以上あれば目立つバナーを表示し、
`/orders?status=pending_approval`（本ページの一括承認UI）へ直接遷移できる。

詳細な通知テーブル設計・RLS・フロントエンド実装は [notifications.md](notifications.md) を参照。
