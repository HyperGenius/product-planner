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
draft ──────────▶ pending_approval ──────────▶ confirmed ──┬──▶ completed
                        │                                    ├──▶ canceled
                        │                                    └──▶ shipped
                        └──(差し戻し)──▶ draft
```

| 状態 | 意味 |
|---|---|
| `draft` | 下書き（メール自動作成 or 手動作成） |
| `pending_approval` | 受注担当者による修正完了、社長承認待ち |
| `confirmed` | 社長による承認済み（`POST /orders/{id}/confirm` 実行済み） |
| `shipped` | 送品済み（出荷・納品済み。`POST /orders/{id}/ship` 実行済み、実質的な終端） |
| `completed` | 完了 |
| `canceled` | キャンセル |

> 注: 上記に加えて、管理者による後片付け操作のみ `draft → shipped` を例外的に許可する
> （納期超過の下書き限定。詳細は下記「納期超過の下書きの一括送品済み化」）。

順方向遷移のみを許可し、差し戻し `pending_approval → draft` のみ例外的に許可する。
バリデーションは
[order_status_service.py](../../backend/app/services/order_status_service.py) の
`validate_order_status_transition()` が担い、`POST /orders/{id}/confirm`
（[orders.py](../../backend/app/routers/transaction/orders.py)）はこれを経由して
`pending_approval → confirmed` の遷移のみを許可するよう変更した
（それ以前は無条件にステータスを上書きしていた）。

`draft → pending_approval`（承認依頼送信）、`pending_approval → draft`（却下・差し戻し）を
実行するAPIエンドポイントは Issue #325 で実装した。詳細は
[approval-workflow.md](approval-workflow.md) を参照。

### 送品済み (`shipped`)

`confirmed → shipped` の遷移は `POST /orders/{id}/ship` が担う。ロールは
`president` / `order_handler` に開放している（出荷実務は受注担当も行うため）。
`shipped` は実質的な終端状態で、以降の順方向遷移は無い。フロントエンドでは
受注一覧・受注詳細に「送品済みにする」ボタンを表示する
（`confirmed` かつ上記ロールのときのみ。[order-table-row.tsx](../../frontend/src/components/orders/order-table-row.tsx) /
[orders/[id]/page.tsx](../../frontend/src/app/orders/[id]/page.tsx)、フックは
`useShipOrder`（[use-orders.ts](../../frontend/src/hooks/use-orders.ts)））。

### 納期超過の下書きの一括送品済み化 (`draft → shipped`、Issue #367)

トライアル運用中に作成され、下書きのまま希望納期を過ぎて放置された受注を
後片付けするための管理者操作。`POST /orders/ship-overdue-drafts`
（[orders.py](../../backend/app/routers/transaction/orders.py)）が担う。

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

## 自動処理（メール/PDF取込）との整合

`upsert_order_by_dedupe_key`（[20260830150000_add_shipped_order_status.sql](../../supabase/migrations/20260830150000_add_shipped_order_status.sql)）
は、既存の `confirmed`/`completed`/`canceled`/`pending_approval` 保護に加えて `shipped` 状態の
受注も自動処理から保護し、誤って上書き・降格させないようにしている。

