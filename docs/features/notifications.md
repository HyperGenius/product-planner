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

---

## スコープ外（このIssueではやらない）

- PDF添付ルートで「明細抽出結果が空配列」の場合の `non_order_email` 検知
- メール通知・Slack通知などアプリ外への通知連携
- `non_order_email` 判定の精度改善（ラベルルーティング自体の見直し等）
- 通知からの一括操作（一括既読以外のアクション）
- 通知の長期集計・ダッシュボード
- `order_parse_log` / `order_attachments` 自体のスキーマ変更

---

## 関連

- [pdf-order-parsing.md](pdf-order-parsing.md): PDF自動パース処理（Issue #249, #252、通知発生元）
- [email-order-intake.md](email-order-intake.md): メール起票の基盤設計
- Issue #249, #252: `order_parse_log` への記録処理（本Issueの通知発生元）
