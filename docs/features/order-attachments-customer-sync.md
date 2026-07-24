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

`orders.customer_id` の UPDATE と同一トランザクションで実行される DB トリガー
`sync_order_attachments_customer_id`（`supabase/migrations/20260724000000_sync_order_attachments_customer_id_trigger.sql`）
で同期する。

- 当初はアプリ層（`update_order`, `backend/app/routers/transaction/orders.py`）で
  `orders` 更新後に別クエリで `order_attachments` を更新する実装にしていたが、
  レビューで「後続の更新が失敗した場合に `orders` と `order_attachments` の
  `customer_id` が不整合のまま残る」指摘を受け、DBトリガーに変更した。
  アプリ層は `repo.update` を呼ぶだけのシンプルな実装に戻している
- 同じ `order_id` を持つ `order_attachments.customer_id` を同じ値に更新する
- メール/PDF起票の注文は、実際に添付ファイルを保持する行（`order_id` 設定済み）とは別に、
  パース元となった「ステージング行」（`order_attachments.order_id IS NULL`、
  `orders.source_attachment_id` が指す1ソース）を持つ。1ソース:N受注（Issue #280）に
  対応するため、このステージング行には `order_id` が存在せず、上記の同期だけでは
  `customer_id` が更新されない。そこで、同じ `source_attachment_id` を持つ全ての
  注文の `customer_id` が揃った場合に限り、ステージング行の `customer_id` も
  合わせて同期する。まだ揃っていない場合（1ソースから複数注文を生成し、顧客が
  一部しか変更されていない場合など）はどちらに合わせるべきか判断できないため、
  ステージング行は更新しない

## スコープ外

- 同じソースから生成された注文の顧客がまだ一致していない場合のステージング行の
  取り扱い（上記の通り更新しない。全注文の顧客が変更されて揃った時点で自動的に
  同期される）
- 顧客削除時の `order_attachments` 側の自動NULL化・カスケード削除は引き続き対象外

## 受け入れ条件

- [x] 注文の顧客を変更すると、紐づく `order_attachments.customer_id` も更新される
- [x] `customer_id` を含まない更新では `order_attachments` に触れない
- [x] 同じソースから生成された全注文の顧客が揃った場合、ステージング行の
      `customer_id` も同期される
- [x] 顧客がまだ揃っていない場合、ステージング行は更新されない
- [x] 既存のテストをパスすること（`__tests__/integration/test_sync_order_attachments_customer_id_trigger.py`
      でトリガーの分岐を実DBに対して検証）
- [x] 型・Lint エラーが出ていないこと

## 関連

- Issue #315: 注文の顧客変更時にorder_attachments.customer_idが更新されず不明な顧客を削除できない
- Issue #312 / [customer-delete-error-handling.md](customer-delete-error-handling.md):
  外部キー制約エラーの理由表示
