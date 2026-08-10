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
                        │                                    └──▶ canceled
                        └──(差し戻し)──▶ draft
```

| 状態 | 意味 |
|---|---|
| `draft` | 下書き（メール自動作成 or 手動作成） |
| `pending_approval` | 受注担当者による修正完了、社長承認待ち |
| `confirmed` | 社長による承認済み（`POST /orders/{id}/confirm` 実行済み） |
| `completed` | 完了 |
| `canceled` | キャンセル |

順方向遷移のみを許可し、差し戻し `pending_approval → draft` のみ例外的に許可する
（実際の却下APIは別Issueで実装予定）。バリデーションは
[order_status_service.py](../../backend/app/services/order_status_service.py) の
`validate_order_status_transition()` が担い、`POST /orders/{id}/confirm`
（[orders.py](../../backend/app/routers/transaction/orders.py)）はこれを経由して
`pending_approval → confirmed` の遷移のみを許可するよう変更した
（それ以前は無条件にステータスを上書きしていた）。

## 自動処理（メール/PDF取込）との整合

`upsert_order_by_dedupe_key`（[20260810000002_add_pending_approval_order_status.sql](../../supabase/migrations/20260810000002_add_pending_approval_order_status.sql)）
は、既存の `confirmed`/`completed`/`canceled` 保護に加えて `pending_approval` 状態の
受注も自動処理から保護し、誤って上書き・降格させないようにしている。

## 承認申請API・却下API（本Issueのスコープ外）

`draft → pending_approval`（承認申請）、`pending_approval → draft`（却下・差し戻し）を
実行するAPIエンドポイント自体は別Issue（Issue #322 の後続）で実装する。本Issueでは
`orders.status` の値追加と遷移バリデーションの土台のみを提供する。
