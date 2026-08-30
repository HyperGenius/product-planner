# 自動処理パイプラインの通知UI（Issue #254）

[pdf-order-parsing.md](pdf-order-parsing.md)（Issue #249, #252）・
[email-order-intake.md](email-order-intake.md) の自動処理パイプラインは複数箇所で
ログのみを記録しており、担当者が気づく手段がなかった。これらのイベントを
アプリ内通知（通知ベル＋一覧）として可視化する。

---

## 背景と目的

照合失敗・格下げスキップ・重複競合スキップ・読み取り不可（暗号化/画像PDF）・
対象外メールの6種類のイベントを、担当者がアプリ内でリアルタイムに把握できるようにする。

`order_parse_log` / `order_attachments.parse_status` は詳細の一次情報として残したまま、
`notifications` は「担当者に見せる通知」専用の薄いテーブルとして横断的に記録する
（`order_parse_log` の1:1ミラーではない）。

---

## DBスキーマ変更

`supabase/migrations/20260703000000_add_notifications.sql`:

```sql
CREATE TABLE notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  notif_type   text NOT NULL CHECK (notif_type IN (
                 'no_product_match', 'downgrade_skipped', 'draft_conflict_skipped',
                 'failed_encrypted', 'failed_image', 'non_order_email'
               )),
  source_table text NOT NULL,   -- 'order_parse_log' | 'order_attachments' | 'gmail_message'
  source_id    text,            -- 参照元IDの型がuuid/bigint/文字列と混在するためtext
  detail       jsonb,
  read_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

- 既読管理は `is_read boolean` ではなく `read_at timestamptz` とし、いつ既読になったか
  追跡可能にする。
- RLSポリシーは CLAUDE.md の規約に従い `is_tenant_member(tenant_id)` を使用する。
  Issue起票時点の下書きでは既存 `order_parse_log` の `auth.jwt() ->> 'tenant_id'` ポリシーに
  倣う想定だったが、このパターンは `organization_members` を経由しないため実際のJWTクレーム
  と一致せず機能しない（`order_parse_log` は現状どこからも読み取られていないため顕在化して
  いなかった）。ローカルSupabaseで実際にログインしたユーザーで疎通確認し、`notifications`
  では `is_tenant_member(tenant_id)` に置き換えて動作を確認済み。

### notif_type と発生箇所の対応

| notif_type | 発生箇所 | source_table | source_id |
|---|---|---|---|
| `no_product_match` | `pdf_order_parsing_service._process_line_item` | `order_parse_log` | `order_parse_log.id` |
| `downgrade_skipped` | 同上 | `order_parse_log` | 同上 |
| `draft_conflict_skipped` | 同上 | `order_parse_log` | 同上 |
| `failed_encrypted` | `pdf_order_parsing_service._parse_one` | `order_attachments` | `attachment_id` |
| `failed_image` | 同上 | `order_attachments` | `attachment_id` |
| `non_order_email` | `gmail_service._process_message` | `gmail_message` | Gmail `msg_id` |
| `customer_draft_created` | `resolve_or_create_customer` 呼び出し元（`gmail_service._process_message`）| `gmail_message` | Gmail `msg_id` |
| `approval_requested` | `orders.request_order_approval`（`POST /orders/{id}/request-approval`）| `orders` | `order_id` |
| `no_order_created` | `pdf_order_parsing_service._notify_if_no_order_created`（`_parse_one` 末尾）| `order_parse_log` | `order_parse_log.id` |

### `no_order_created`（パース成功・起票0件の可視化, Issue #357）

自動抽出は成功したのに全明細が既存の内示注文と重複（`upsert_order_by_dedupe_key` が
`skipped_no_change`）し、`order` が1件も生成されず `order_parse_log` も `notifications` も
残らないケースを可視化する。従来は `order_attachments.parse_status='success'` だけが
記録され、運用側から「起票0件」に気づけなかった。

- 書き込み元は `pdf_order_parsing_service._notify_if_no_order_created()`。`_parse_one` の
  末尾（`parse_status='success'` 更新の直前）で `created_count == 0` かつ その attachment に
  紐づく `order_parse_log` が皆無のときだけ、`reason='no_order_created'` の parse_log と
  この通知を記録する（`non_order_email` 等、既に別理由のログがあれば二重通知しない）
- `link_url` は他の `order_parse_log` 経由通知と同じく、`order_attachment_id` を引いて
  元PDFの署名付きURLに解決する（`_PARSE_LOG_NOTIF_TYPES` に追加）
- 一覧ビューは [受信受注メールの処理結果一覧](email-order-intake.md#受信受注メールの処理結果一覧issue-357)
  （`GET /orders/email-intake-results`）。`parse_status='success'` は変更しない（無限再処理を避ける）
- フロント: `NotificationType` / `NOTIF_TYPE_LABELS`（`notification-bell.tsx`）に
  `no_order_created`（「起票0件（全明細が重複）」）を追加

### `approval_requested`（承認依頼のアプリ内通知, Issue #327）

社長（president）向けに、[承認ワークフロー](approval-workflow.md)（Issue #325）の承認依頼送信
（`draft → pending_approval`）を通知する。メール確認依頼で発生していた「返信が来ない」問題の
代替として、アプリ内で完結させる。

- 書き込み元は `orders.py` の `request_order_approval`。既存の `create_notification()` を
  ユーザーJWTクライアント（`client`、`get_supabase_client`）で呼び出す。監査ログ記録
  （`_log_approval_action_safely`）と同様、通知の記録失敗は承認依頼送信自体を失敗させない
  ベストエフォート（`_notify_approval_requested_safely`）
- `detail` には `{"order_no": ...}` のみを保存する
- `link_url` は `_resolve_link_urls()` で `/orders/{order_id}`（アプリ内相対パス）に解決する
  （他のnotif_typeのような署名付きURL生成や外部リンク組み立ては不要）。`source_id` が数値
  文字列でない場合は `link_url: null` とする（下記のPRレビュー指摘対応）

#### 書き込み経路の追加（RLS）

これまで `notifications` への書き込みは cron/Service Role Key 経由（admin_client, RLSバイパス）に
限定され、ユーザーJWTからの書き込みは default deny だった。承認依頼はユーザー操作起点のため、
[order_approval_log](approval-workflow.md) と同じ考え方で、ユーザーJWT経由の書き込みを
`notif_type = 'approval_requested' AND source_table = 'orders'` に限定した INSERT ポリシーを
新設した（`supabase/migrations/20260812000000_add_approval_requested_notif_type.sql`）。
他のnotif_type（PDF解析ログ等、cron専用）はこれまで通りユーザーJWT経由での偽装挿入を防ぐ。

`source_id` はアプリ層が渡す値をそのまま信頼せず、RLS側でも検証する（PRレビュー指摘対応）。
INSERTポリシーの `WITH CHECK` に `source_id ~ '^[0-9]+$'`（数値形式）と
`EXISTS (... orders o WHERE o.id = source_id::bigint AND o.tenant_id = notifications.tenant_id)`
（同一テナントに実在する注文であること）を追加し、任意文字列や他テナントの注文IDを
`source_id` に持つ通知の作成を防ぐ。アプリ側（`_resolve_link_urls`）でも `source_id.isdigit()`
を確認してから `link_url` を組み立てる二重防御にしている。

#### フロントエンド

- `NotificationType` / `NOTIF_TYPE_LABELS`（`notification-bell.tsx`）に `approval_requested`（「承認依頼」）
  を追加。`formatDetail()` で `detail.order_no` から「注文「ORD-xxx」の承認依頼」を表示する
- ホームダッシュボード（`frontend/src/app/page.tsx`）: president がログインした際、
  `pending_approval` 件数が1件以上あればページ上部に目立つバナーを表示し、
  クリックで `/orders?status=pending_approval`（[承認ワークフロー](approval-workflow.md)の
  一括承認UI）へ遷移する。メール確認依頼と同じ「後回しにされる」問題の再発を防ぐため、
  通知ベルの未読バッジだけでなく能動的に表示する設計とした
  （バナーは `orders` の現在ステータス集計ベースで、通知イベントの既読/未読とは独立して表示する）

---

## バックエンド設計

### `notification_service.create_notification()`

`backend/app/services/notification_service.py` に共通ヘルパー
`create_notification(db, tenant_id, notif_type, source_table, source_id, detail)` を新設し、
`pdf_order_parsing_service.py` と `gmail_service.py` の両方から呼び出す。

`pdf_order_parsing_service._log_parse_event()` の戻り値を `None` から挿入行の `id` に変更し、
`no_product_match` / `downgrade_skipped` / `draft_conflict_skipped` の3箇所の呼び出し元で
`log_id` を `notifications.source_id` として渡す。

### 対象外メール検知（`gmail_service.py`）

本文テキスト抽出ルート（PDF添付なし）で `extract_email_fields` の結果が
`product_name` / `quantity` / `deadline_date` / `order_number` すべて `None`（`<UNKNOWN>`）の場合、
挙動を変更し **order作成自体をスキップして通知のみ記録する**。

- 判定ゲートは `fields` 正規化直後、製品マッチングより前に配置（`_process_message`）
- この場合、顧客レコード（`resolve_or_create_customer`）も作成しない
  （迷惑メール送信元で顧客テーブルを汚染しないため）
- `_move_label` で処理済みラベルへ移動して return する

### APIエンドポイント

`backend/app/routers/transaction/notifications.py`:

- `GET /notifications` — 新着順に全件取得。各通知に `link_url`（遷移先）を解決して付与する
  - `non_order_email`: Gmail permalink（`https://mail.google.com/mail/u/0/#all/{msg_id}`）
  - `failed_encrypted` / `failed_image`: `order_attachments.storage_path` から署名付きURLを生成
  - `no_product_match` / `downgrade_skipped` / `draft_conflict_skipped`: `order_parse_log` から
    `order_attachment_id` を引き、対応する添付の署名付きURLを生成
  - 参照先が見つからない場合は `link_url: null`
- `PATCH /notifications/read` — 未読（`read_at IS NULL`）全件を `read_at = now()` で一括既読化

`GET /notifications` はユーザーJWTクライアント（RLSでテナント絞り込み）、`link_url` 解決は
署名付きURL生成のため admin クライアント（Service Role Key）を使用する
（既存 `/orders/{order_id}/attachments` と同じパターン）。

RLSの `is_tenant_member(tenant_id)` は所属する全テナントの行を許可するため、
複数テナントに所属するユーザーの場合に他テナントの通知が混ざらないよう
`x-tenant-id` ヘッダーの tenant_id で明示的に絞り込む（`PATCH /notifications/read`
と同じ絞り込みに揃えている）。

#### `link_url` 解決のバッチ化（Issue #302）

当初の実装は `link_url` を通知1件ごとに解決しており、`order_parse_log` /
`order_attachments` への問い合わせと署名付きURL生成APIを通知件数分だけ同期的に
呼び出すN+1になっていた（通知が多いテナントで `GET /notifications` が15〜30秒かかり、
単一ワーカー構成のRenderインスタンスがヘルスチェック不応答で再起動する事象につながった）。

`_resolve_link_urls()`（`notifications.py`）で以下のようにバッチ化した。

1. `order_parse_log` を参照すべき通知の `source_id` を集約し `.in_()` で1回だけ取得
2. `order_attachments` を参照すべき `attachment_id` を集約し `.in_()` で1回だけ取得
3. 署名付きURLは `attachment_service.create_signed_urls()`（storage3の
   `create_signed_urls` バッチAPI）で `storage_path` をまとめて1回だけ生成

テナント絞り込み（IDOR対策）は個別解決版と同様、各バッチクエリに
`.eq("tenant_id", tenant_id)` を必ず含めている。

---

## フロントエンド設計

- `frontend/src/types/notification.ts`: `Notification` / `NotificationType` 型
- `frontend/src/hooks/use-notifications.ts`:
  - `useNotifications()` — `useQuery` + `refetchInterval`（30秒間隔ポーリング。push基盤がないため）
  - `useMarkNotificationsRead()` — `useMutation`。成功時に `notifications` クエリを invalidate
- `frontend/src/components/layout/notification-bell.tsx`:
  - ベルアイコン＋未読件数バッジ（`Popover` で一覧表示、`notif_type` ごとにグルーピング）
  - 各通知は `link_url` があればクリックで新規タブ遷移、なければテキスト表示のみ
  - `Popover` の `onOpenChange(true)` タイミングで未読があれば既読化 mutation を発火
    （mount時の `useEffect` では発火させない。ユーザーが見る前にバッジが消えるのを防ぐため）
  - ベルボタンはアイコンのみのため `aria-label`（未読件数を含む）でスクリーンリーダー向けに補足
- マウント位置: `frontend/src/components/layout/authenticated-layout.tsx` のheader内
  （ページタイトルと同じ行、右端）

---

## 受け入れ条件

- [x] `notifications` テーブルが作成されている（マイグレーション済み、ローカルSupabaseで疎通確認済み）
- [x] `no_product_match` / `downgrade_skipped` / `draft_conflict_skipped` / `failed_encrypted` /
      `failed_image` が通知として記録される（単体テストで検証）
- [x] 本文テキストルートで抽出結果が空の場合、order作成をスキップし `non_order_email` として
      通知記録される（顧客レコードも作成しない）
- [x] 通知ベル＋未読バッジがUIに表示される（ブラウザで実際にログインし目視確認済み）
- [x] 通知一覧から各詳細（PDF/添付ファイル/Gmailメール）へ遷移できる（`link_url` 経由）
- [x] 一覧表示（オープン時）で既読化される
- [x] 承認依頼送信時に president へアプリ内通知（`approval_requested`）が届く（Issue #327）
- [x] 社長ダッシュボードで承認待ち件数・一覧が確認できる（Issue #327、ホーム画面の目立つバナー）
- [x] 一覧から一括承認ができる（Issue #325 で実装済みの `/orders?status=pending_approval` 経由）

---

## スコープ外（このIssueではやらない）

- PDF添付ルートで「明細抽出結果が空配列」の場合の `non_order_email` 検知
- メール通知・Slack通知などアプリ外への通知連携
- `non_order_email` 判定の精度改善（ラベルルーティング自体の見直し等）
- 通知からの一括操作（一括既読以外のアクション）
- 通知の長期集計・ダッシュボード
- `order_parse_log` / `order_attachments` 自体のスキーマ変更

---

## テスト（Issue #256）

単体テストのみでカバーできなかった、実際のPostgres（RLS込み）でしか検証できない挙動を
`backend/__tests__/integration/test_notifications_rls.py` に追加した。

- `notifications` の RLSポリシー（SELECTのみ許可、INSERT/UPDATE/DELETEはデフォルト拒否）
  — 自テナント/他テナントの可視性、ユーザーJWT経由の直接書き込みが拒否されること
- `GET /notifications` の `_resolve_link_url` におけるIDOR修正（commit 868a45f）の回帰テスト
  — `order_attachments` / `order_parse_log` いずれの経路でも、`source_id` が他テナントの行を
  指していても `link_url` が `None` になること
- `PATCH /notifications/read` が自テナントの未読分のみを対象にすること、既読済み行への
  再実行が冪等であること
- ユーザーが複数テナント（own/other）に所属する場合、`GET /notifications` が
  `x-tenant-id` で選択したテナント以外の通知を混ぜないこと（Copilotレビュー指摘の回帰テスト。
  `is_tenant_member(tenant_id)` だけでは所属する全テナントの行を許可してしまうため、
  ルータ側で明示的に `tenant_id` を絞り込む必要がある）

あわせて、`backend/__tests__/integration/conftest.py` の `TEST_USER_EMAIL` / `TEST_USER_PASS` /
`TEST_TENANT_ID` が `.env` の実際のシード値と乖離したハードコード値（`user_a@example.com` 等）
になっており、ログイン自体に失敗する状態だったため `.env` の値を読むよう修正した
（`real_supabase_client` の `SUPABASE_KEY` → `SUPABASE_ANON_KEY` の誤りも合わせて修正）。
必須環境変数（`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `TEST_USER_EMAIL` / `TEST_USER_PASS`）が
未設定の場合は `KeyError` や分かりにくいログイン失敗ではなく `pytest.skip` で明示的にスキップする。
`test_rls_scenarios.py` は本Issueのスコープ外のため未着手（`/api/products/` という誤った
パスを使っており引き続き失敗する既知の問題）。

実行:
```bash
supabase start
cd backend && pytest __tests__/integration/test_notifications_rls.py -v --run-integration
```

### Issue #327 で追加したテスト

- `backend/__tests__/api/routers/transaction/test_orders.py::test_request_order_approval_notifies_approval_requested`
  — `request-approval` 成功時に `notifications` へ `approval_requested` がinsertされること（モック）
- `backend/__tests__/api/routers/transaction/test_notifications.py` — `approval_requested` の
  `link_url` が `/orders/{order_id}` に解決されること（数値以外の `source_id` では `null` になること含む）
- `backend/__tests__/integration/test_notifications_rls.py`
  - `test_insert_approval_requested_via_user_jwt_succeeds_for_own_tenant` — ユーザーJWT経由で
    自テナントの実在する注文を指す `approval_requested` はINSERTできる
  - `test_insert_approval_requested_via_user_jwt_rejected_for_other_tenant` — 他テナント宛は拒否される
  - `test_insert_approval_requested_via_user_jwt_rejected_for_non_numeric_source_id` —
    `source_id` が数値でない場合はRLSで拒否される（PRレビュー指摘対応）
  - `test_insert_approval_requested_via_user_jwt_rejected_for_other_tenant_order_id` —
    `source_id` が数値でも他テナントの注文を指す場合はRLSで拒否される（IDOR対策、PRレビュー指摘対応）
  - 既存 `test_direct_insert_via_user_jwt_is_rejected`（`non_order_email`）で、新設ポリシーが
    `approval_requested` 以外には影響しないことを回帰確認

## 関連

- [pdf-order-parsing.md](pdf-order-parsing.md): PDF自動パース処理（Issue #249, #252、通知発生元）
- [email-order-intake.md](email-order-intake.md): メール起票の基盤設計
- [order-attachments.md](order-attachments.md): `order_attachments` テーブル・`parse_status`
  の定義（`failed_encrypted` / `failed_image` の発生元、対象外メール検知時の挙動変更）
- [customer-draft-auto-create.md](customer-draft-auto-create.md): `customer_draft_created`
  の追加（Issue #263）
- [approval-workflow.md](approval-workflow.md): 承認ワークフロー本体（Issue #325）。
  `approval_requested` 通知（Issue #327）はこのワークフローの `request-approval` に連動する
- Issue #249, #252: `order_parse_log` への記録処理（本Issueの通知発生元）
- Issue #256: integrationテスト追加（RLS/IDOR回帰）
- Issue #327: 承認依頼のアプリ内通知（`approval_requested`）
