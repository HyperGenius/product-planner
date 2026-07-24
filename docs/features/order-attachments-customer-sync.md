# 注文の顧客変更時に order_attachments.customer_id を同期する（Issue #315）

注文詳細ページで注文の顧客を変更しても `order_attachments.customer_id` が追従せず、
メール取込時に自動作成された「不明な顧客」(draft) への参照が残り続けて削除できない
問題を解消する。

---

## 背景

- `order_attachments.customer_id` は [gmail_service.py](../../backend/app/services/gmail_service.py)
  でステージング行を作成する際に、`resolve_or_create_customer` が解決/自動作成した
  customer_id を一度だけ設定する。以後この値を更新する処理は存在しなかった
- `orders.customer_id` と `order_attachments.customer_id` はどちらも `customers(id)` を
  参照する独立した外部キーであり（`ON DELETE` 句なし）、注文の編集ダイアログで
  `PATCH /orders/{id}` により `orders.customer_id` を変更しても
  `order_attachments.customer_id` には反映されなかった
- 結果として、注文の顧客を正しい既存顧客に変更しても、元の「不明な顧客」への参照が
  `order_attachments` に残り続け、[customer-delete-error-handling.md](customer-delete-error-handling.md)
  （Issue #312）で追加された 409 エラー（「他のデータから参照されているため削除できません」）
  が解消しない。`order_attachments` を直接操作するフロントエンドUIも存在せず、
  ユーザー側で解消する手段がなかった

## 修正内容

- `update_order`（`backend/app/routers/transaction/orders.py`）で、リクエストに
  `customer_id` が含まれる場合、`orders` の更新に加えて同じ `order_id` を持つ
  `order_attachments.customer_id` も同じ値に更新する

## スコープ外

- `order_id IS NULL` のステージング行（PDF解析待ちで注文にまだ紐づいていない添付）は
  対象外。これらは注文と直接紐づいていないため、本修正の対象外とする
- 顧客削除時の `order_attachments` 側の自動NULL化・カスケード削除は引き続き対象外

## 受け入れ条件

- [x] 注文の顧客を変更すると、紐づく `order_attachments.customer_id` も更新される
- [x] `customer_id` を含まない更新では `order_attachments` に触れない
- [x] 既存のテストをパスすること
- [x] 型・Lint エラーが出ていないこと

## 関連

- Issue #315: 注文の顧客変更時にorder_attachments.customer_idが更新されず不明な顧客を削除できない
- Issue #312 / [customer-delete-error-handling.md](customer-delete-error-handling.md):
  外部キー制約エラーの理由表示
