# 通知ベル（`notifications`）— 廃止済み（Issue #621）

ヘッダー右上の通知ベルと `notifications` テーブルは Issue #621 で廃止した。
このページは経緯の記録として残す。

---

## 何だったか

- Issue #254 で、メール・PDF 取り込みの `order_parse_log` の理由（照合失敗・重複スキップ・読み取り不可・
  対象外メールなど）を担当者に見せるために導入した。
- 後から `customer_draft_created`（#263、#609 で発行停止）・`multi_order_suspected`（#280）・
  `approval_requested`（#327、承認依頼。ユーザーJWTから書く唯一の種別）・`no_order_created`（#357）を足した。
- `GET /notifications` が全件を返してベルのポップオーバーに種別ごとに並べ、開くと `PATCH /notifications/read` で
  テナントの未読を一括で既読にしていた。

## 廃止した理由

- **既読がテナント共通**: `read_at` の1列だけで、誰か1人がベルを開くと全員分が既読になった。
- **ロールで出し分けていない**: 社長に PDF の読み取り失敗、受注担当に承認依頼が届いた。
- **サイドバーの件数バッジ（Epic #553）と重複**: バッジは作業を片付けると減るが、ベルは開いただけで消えた。
- **追従できていない**: 後から足した `order_parse_log.reason`（`image_extracted` / `invalid_quantity` /
  `resent_document` / `delivery_request` など）は通知にならず、受信メール処理結果・Slack にしか出なかった。
- **負荷**: 件数の上限なしの全件取得と署名付き URL の生成を、全ユーザーの画面が30秒ごとにポーリングしていた（#302）。
- 実際に使われていなかった。

## 廃止後の置き場所

方針: **出来事の通知は Slack、今やるべき作業はサイドバーのバッジ、取り込みの結果は受信メール処理結果**。

| 旧 notif_type | 廃止後に気づける場所 |
|---|---|
| `approval_requested` | 「承認」のバッジ（社長）、社長ダッシュボード |
| `no_product_match` | 「起票の確認」のバッジと区分、受信メール処理結果（要確認）、Slack |
| `multi_order_suspected` | 受信メール処理結果（要確認）、Slack |
| `failed_encrypted` / `failed_image` | 「起票の確認」（下書きと直近7日の失敗件数）、受信メール処理結果（失敗）、Slack |
| `downgrade_skipped` / `draft_conflict_skipped` / `no_order_created` / `non_order_email` | 受信メール処理結果（スキップ） |
| `customer_draft_created` | #609 以降は発行されていなかった |

督促・分割納入の依頼（#619）の未対応に気づく手段は Issue #622 で扱う。

## 削除したもの

- DB: `notifications` テーブル（`supabase/migrations/20261104000000_drop_notifications.sql`。過去の通知も含めて削除。
  承認依頼用の INSERT ポリシー・インデックスもテーブルと一緒に消える）
- Backend: `services/notification_service.py`、`routers/transaction/notifications.py`、
  `models/transaction/notification_schema.py`、`SupabaseTableName.NOTIFICATIONS`、
  承認依頼の `_notify_approval_requested_safely()`、`pdf_order_parsing_service` の `create_notification()` 呼び出し
- Frontend: `components/layout/notification-bell.tsx`、`hooks/use-notifications.ts`、`types/notification.ts`
- テスト: `test_notifications.py`（api）、`test_notifications_rls.py`（integration）

## 残したもの

- `order_parse_log` への記録（`pdf_order_parsing_service._log_parse_event()`）は理由・条件とも変えていない。
  受信メール処理結果と Slack の分類（`email_intake_outcome.derive_email_intake_outcome()`）の入力になっている。
- 起票0件の記録は `_log_if_no_order_created()`（旧 `_notify_if_no_order_created()`）に改名して残した。
  別の理由の parse_log が既にあれば記録しない条件も同じ。
- 承認依頼の承認ログ（`order_approval_log`）。

## 関連

- [email-order-intake.md](email-order-intake.md): 受信メール処理結果・Slack 通知（#574）
- [pdf-order-parsing.md](pdf-order-parsing.md): `order_parse_log` の理由
- [order-management-ui-design.md](order-management-ui-design.md): サイドバーの作業メニューと件数バッジ
