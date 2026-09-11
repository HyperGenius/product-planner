# 受注ステータス遷移 (Issue #324)

## 概要

受注確認・承認ワークフロー（Issue #322）の土台として、`orders.status` に承認待ち状態
`pending_approval` を追加し、順方向のみのステータス遷移バリデーションを実装した。

## 背景

過去に顧客側の確度（`forecast`/`forecast_tentative`）を `status` に混在させ、後に
`customer_certainty` カラムへ分離し直した経緯がある
（[20260705000000_separate_customer_certainty_from_status.sql](../../supabase/migrations/20260705000000_separate_customer_certainty_from_status.sql)、Issue #267）。
本Issueでは「受注担当者の修正完了から社長承認まで」の状態を、`customer_certainty` の
どちらの軸にも混在させず、独立した `status` の一段階として追加する。

## ステータス遷移

```
draft ──────────▶ pending_approval ──────────▶ confirmed ◀──(巻き戻し)──┐
                        │                          │ │ │               │
                        │           (着手日到来)   │ │ └──▶ in_progress ─┘
                        │                          │ │         │ │ │
                        │                          │ ├─────────┘ │ ├──▶ completed
                        │                          │ └───────────┼──▶ canceled
                        │                          └─────────────┴──▶ shipped
                        └──(差し戻し)──▶ draft
```

| 状態 | 意味 |
|---|---|
| `draft` | 下書き（メール自動作成 or 手動作成） |
| `pending_approval` | 受注担当者による修正完了、社長承認待ち |
| `confirmed` | 社長による承認済み（`POST /orders/{id}/confirm` 実行済み） |
| `in_progress` | 生産中（着手日が到来。cron が自動付与。詳細は下記「着手日到来による生産中への自動遷移」） |
| `shipped` | 送品済み（出荷・納品済み。`POST /orders/{id}/ship` 実行済み、実質的な終端） |
| `completed` | 完了 |
| `canceled` | キャンセル |

> 注: 上記に加えて、管理者による後片付け操作のみ `draft → shipped` を例外的に許可する
> （納期超過の下書き限定。詳細は下記「納期超過の下書きの一括送品済み化」）。

順方向遷移のみを許可し、差し戻し `pending_approval → draft` のみ例外的に許可する。
バリデーションは
[order_status_service.py](../../backend/app/services/order_status_service.py) の
`validate_order_status_transition()` が担い、`POST /orders/{id}/confirm`
（[approval_workflow.py](../../backend/app/routers/transaction/orders/approval_workflow.py)）はこれを経由して
`pending_approval → confirmed` の遷移のみを許可するよう変更した
（それ以前は無条件にステータスを上書きしていた）。

`draft → pending_approval`（承認依頼送信）、`pending_approval → draft`（却下・差し戻し）を
実行するAPIエンドポイントは Issue #325 で実装した。詳細は
[approval-workflow.md](approval-workflow.md) を参照。

### 着手日到来による生産中への自動遷移 (`confirmed ⇄ in_progress`、Issue #400)

現場メンバーはアプリを操作する余裕がないため、「生産に着手した」ことを手動で
記録できない。そこで**着手日**を基準に cron が `confirmed ⇄ in_progress` を
自動遷移させる。ダッシュボードの「納期リスク注文」カード（Epic #399）が
「生産中の注文」を対象にできるようにするための土台でもある。

- **着手日の解決順**: `orders.scheduling_start_date`（明示指定の作業開始日、Issue #372）
  → 未指定なら紐づく `production_schedules.start_datetime` の最小値の日付。どちらも
  無ければ対象外（動かさない）。
- **遷移ルール**（双方向・冪等）:
  - `status == 'confirmed'` かつ 着手日 ≤ today → `in_progress`
  - `status == 'in_progress'` かつ 着手日 > today → `confirmed`（着手日が未来へ
    戻った／スケジュール再生成で開始日がずれたケースの巻き戻し）
- **エンドポイント**: `GET /api/cron/advance-order-status`
  （[advance_order_status.py](../../backend/app/routers/cron/advance_order_status.py)、
  `CRON_SECRET` 認証、`get_supabase_admin_client()` で全テナント横断バルク更新）。
  ロジックは [order_auto_transition_service.py](../../backend/app/services/order_auto_transition_service.py)。
- **スケジューリング**: 既存の Supabase Edge Function `parse-order-pdfs-trigger` に
  3本目の呼び出しとして相乗り（[supabase-pgcron-parse-order-pdfs.md](../infra/supabase-pgcron-parse-order-pdfs.md)）。
  着手日は date 粒度のため日次相当で十分だが、冪等なので高頻度で叩いても副作用はない。
- **証跡ログ**: 残さない（承認ワークフローではないため `order_approval_log` には
  混ぜない。必要になったら専用テーブルを追加する）。
- **自動処理との整合**: `upsert_order_by_dedupe_key`
  （[20260908000000_add_in_progress_order_status.sql](../../supabase/migrations/20260908000000_add_in_progress_order_status.sql)）
  の保護対象 status に `in_progress` を追加し、メール/PDF自動取込が生産中の受注を
  上書き・降格しないようにしている。
- **フロントエンド**: `Order["status"]` に `in_progress` を追加。ラベル「生産中」・
  バッジ配色 sky、受注一覧のフィルタタブ「生産中」を追加
  （[order-utils.ts](../../frontend/src/lib/order-utils.ts)）。

### 送品済み (`shipped`)

`confirmed → shipped` / `in_progress → shipped` の遷移は `POST /orders/{id}/ship` が担う。
ロールは `president` / `order_handler` に開放している（出荷実務は受注担当も行うため）。
`shipped` は実質的な終端状態で、以降の順方向遷移は無い。フロントエンドでは
受注一覧・受注詳細に「送品済みにする」ボタンを表示する
（`confirmed` / `in_progress` かつ上記ロールのときのみ。[order-table-row.tsx](../../frontend/src/components/orders/order-table-row.tsx) /
[orders/[id]/page.tsx](../../frontend/src/app/orders/[id]/page.tsx)、フックは
`useShipOrder`（[use-orders.ts](../../frontend/src/hooks/use-orders.ts)））。

### 納期超過の下書きの一括送品済み化 (`draft → shipped`、Issue #367)

トライアル運用中に作成され、下書きのまま希望納期を過ぎて放置された受注を
後片付けするための管理者操作。`POST /orders/ship-overdue-drafts`
（[approval_workflow.py](../../backend/app/routers/transaction/orders/approval_workflow.py)）が担う。

- **ロール**: `president` / `platform_admin` 限定（`_require_any_role`）。承認操作
  （工程確定等）は `president` 限定だが、本操作は「承認を通さず終端へ寄せる後片付け」
  であり、閲覧・管理サポートを担う `platform_admin` にも開放する。`order_handler` /
  `iso_officer` は実行不可（403）。
- **対象**: テナント内の「`status == "draft"` かつ 希望納期が設定済み かつ 希望納期 < 今日」
  の受注のみ。`pending_approval` / `confirmed` / 納期未設定 / 納期未超過は対象外。
  判定は [order_status_service.py](../../backend/app/services/order_status_service.py) の
  `is_overdue_draft()`。
- **遷移バリデーション**: グローバルな `ORDER_STATUS_TRANSITIONS` は `draft → shipped` を
  許可しない（単体の `POST /orders/{id}/ship` は従来どおり `confirmed` からのみ）。
  この一括エンドポイントだけが `is_overdue_draft()` で対象を絞ったうえで例外的に
  `draft → shipped` を行う。
- **レスポンス**: `{ "shipped_count": N, "order_ids": [...] }`。対象0件でも 200。
- **フロントエンド**: 受注一覧ヘッダ（[orders/page.tsx](../../frontend/src/app/orders/page.tsx)）の
  3点リーダに「納期超過の下書きを送品済みにする（N件）」を表示する（`president` /
  `platform_admin` のときのみ。対象0件のときは disabled）。確認ダイアログ
  （`ShipOverdueDraftsConfirmDialog`）で対象一覧を確認してから実行。フックは
  `useShipOverdueDrafts`（[use-orders.ts](../../frontend/src/hooks/use-orders.ts)）。
  行チェックボックスによる個別選択は用いない。

## フロントエンド表示: 「シミュ済」派生ステータス (Issue #392)

「シミュレーション完了・未確定」は `orders.status` の値**ではない**。`draft` のまま
`POST /orders/{id}/simulate`（dry-run。`schedules` テーブルへは保存しない）が成功すると
`orders.is_scheduled = true` が立つ（[simulation.py](../../backend/app/routers/transaction/orders/simulation.py) の
`mark_as_scheduled()`）。これを**フロントエンドだけで** `status='draft' && is_scheduled` として
判定し、一覧上の表示ステータスを分ける。DB スキーマ・API・`Order["status"]` 型は変更しない。

- **派生ロジック**: [order-utils.ts](../../frontend/src/lib/order-utils.ts) の
  `getEffectiveOrderStatus(order)` が `EffectiveOrderStatus`（`Order["status"] | "simulated"`）を返す。
  `getStatusLabel` / `getStatusBadgeClass` はこの派生型を受け取る。
- **バッジ**: ラベルは「シミュ済」（正式名称「シミュレーション完了（未確定）」はレイアウト崩れ防止のため
  バッジには出さず、ツールチップで表示）。配色は indigo（`confirmed` の緑・確度バッジ `forecast_tentative`
  の purple と区別）。描画は [order-table-row.tsx](../../frontend/src/components/orders/order-table-row.tsx)。
  受注一覧のみが対象で、受注詳細画面は従来どおり「下書き」表示。
- **フィルタタブ**: `STATUS_TABS` に「シミュ済」(`value: "simulated"`) を追加。`filterOrder()` で
  `simulated` = `draft && is_scheduled`、`draft` タブは `draft && !is_scheduled` として両者を排他にする。
  フィルタ・ページングはクライアント側（[use-orders-page.ts](../../frontend/src/hooks/use-orders-page.ts)）
  のため API 追加は不要。
- **「未確定」通知カード**: `draftCount` もシミュ済を除外し、「下書き」タブと件数を揃える。
- **「シミュ納期」カラム (Issue #394-B)**: 一覧の納期カラムはタブ依存で「シミュ納期」
  (`simulated_deadline`) と「確定納期」(`confirmed_deadline`) を出し分ける。`is_scheduled` と
  `simulated_deadline` は #394-A 以降スケジュール条件の編集で一緒にクリアされるため、
  `filterOrder()` の `simulated` 判定（`is_scheduled` ベース）と表示値（`simulated_deadline`）は
  draft では整合が取れる。詳細は
  [order-management-ui-design.md](order-management-ui-design.md#テーブル設計)。
- **編集時の無効化 (Issue #394-A)**: `PATCH /orders/{id}` で `product_id` / `quantity` /
  `desired_deadline` / `scheduling_start_date` が変わると、`is_scheduled` は `false` に、
  `simulated_deadline` は `NULL` に戻る。これにより「工程・数量変更後も `is_scheduled` が
  立ったまま陳腐化する」問題は解消済み（PR #393 が課題として挙げていたもの）。
- **残る制約**: マスタ（工程・カレンダー・設備）側の変更では `simulated_deadline` /
  `is_scheduled` は自動更新されない（受注自体の編集時クリアのみで対応）。運用で不都合が
  出たら別 Issue で対応する。シミュレーション実施日時は保持していない。

## 自動処理（メール/PDF取込）との整合

`upsert_order_by_dedupe_key`（[20260908000000_add_in_progress_order_status.sql](../../supabase/migrations/20260908000000_add_in_progress_order_status.sql)）
は、既存の `pending_approval`/`confirmed`/`shipped`/`completed`/`canceled` 保護に加えて
`in_progress`（生産中）状態の受注も自動処理から保護し、誤って上書き・降格させないように
している。

