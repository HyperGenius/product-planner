# 受注の編集ダイアログで任意項目を空欄にして消す（Issue #518）

受注の編集ダイアログ（`EditOrderDialog`）で、注文番号・希望納期・顧客を空欄にして「保存」しても
値が消えず、成功トーストだけが出ていた問題を解消する。原因・修正パターンは
[customer-clear-optional-fields.md](customer-clear-optional-fields.md)（Issue #517）と同じ。

---

## 原因

- `EditOrderDialog` の `handleSubmit()` が任意項目を `orderNo.trim() || undefined` /
  `desiredDeadline || undefined` / `customerId ? ... : undefined` で組み立てていた。
  `undefined` は `JSON.stringify` でキーごと落ちるので、空欄にした項目は PATCH のボディに入らない
- `PATCH /orders/{id}`（`update_order()`）は `model_dump(exclude_unset=True)` の部分更新なので、
  送られてこない項目は元の値のまま残る

## 仕様判断: 空に戻してよいか

3項目とも **空に戻せる**（`null` で更新できる）方針にした。

- `order_number` はもともと任意項目
- `desired_deadline`（希望納期）・`customer_id`（顧客）は `orders_dedupe_key`
  （`tenant_id, customer_id, product_id, deadline_date`）の列だが、どちらも NULL 可で、
  メール起票の下書き等で未設定の受注は元から存在する。一覧の `?status=incomplete`
  （`filterOrder()` の `!order.customer_id || !order.desired_deadline`）はこの状態を
  前提にした既存の分岐なので、編集で空に戻すこと自体は既存のデータモデル・運用と整合する
- そのため保存前のブロッキングバリデーションは追加していない。空に戻すと一覧上は
  「情報不足」（`incomplete`）の下書きに戻るだけ

## 修正内容

- `handleSubmit()` で3項目の空欄を `null` で送る（`order_no` は `trim()` 後に判定）
- 更新用の型を `Partial<OrderCreate>` ではなく新規の `OrderUpdate`
  （`frontend/src/types/order.ts`）にし、`order_no` / `customer_id` / `desired_deadline` を
  `| null` にする。`useUpdateOrder()`（`frontend/src/hooks/use-orders.ts`）もこの型を使う
- バックエンドは変更なし。`OrderUpdate` スキーマは既に3項目とも `... | None = None` で、
  `customer_id` / `deadline_date` / `order_number` のDB列もNOT NULL制約が無いため、
  明示的に送られた `null` がそのまま `NULL` に更新される

## テスト

- `backend/__tests__/api/routers/transaction/test_orders.py`:
  `null` を送った3項目がリポジトリの更新内容に含まれること
- `frontend/src/components/orders/edit-order-dialog.test.tsx`:
  3項目を空欄にして保存すると `null` で送ること

## 関連

- Issue #517: 顧客マスタの編集ダイアログで同じ原因により修正した前例
