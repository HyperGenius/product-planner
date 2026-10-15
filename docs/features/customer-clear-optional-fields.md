# 顧客マスタの編集で任意項目を空欄にして消す（Issue #517）

顧客マスタ（`/master/customers`）の編集ダイアログで、登録済みの Email 等を空欄にして「更新」しても
値が消えず、成功トーストだけが出ていた問題を解消する。

---

## 原因

- フロントの `handleUpdate()`（`frontend/src/app/master/customers/page.tsx`）が任意項目を
  `email || undefined` で組み立てていた。`undefined` は `JSON.stringify` でキーごと落ちるので、
  空欄にした項目は PATCH のボディに入らない
- `PATCH /customers/{id}`（`backend/app/routers/master/customers.py` の `update_customer()`）は
  `model_dump(exclude_unset=True)` で、送られてきた項目だけを更新する（部分更新）。
  送られてこない項目は元の値のまま残る
- `name` と `status='active'` の更新は成功して 200 が返るので、画面は成功トーストを出していた

## 修正内容

- `handleUpdate()` で任意項目（通称・代表者名・電話番号・Email）の空欄を `null` で送る。
  前後の空白は `trim()` してから判定し、空白だけの入力も空欄として扱う
- 更新用の型 `CustomerUpdate`（`frontend/src/types/customer.ts`）の任意項目を `string | null` にする
- バックエンドは変更なし。`CustomerUpdateSchema` は既に `str | None` で、`exclude_unset=True` は
  明示的に送られた `null` を落とさないので、そのまま `NULL` に更新される

作成（`handleCreate()`）は空欄を `undefined` のまま送る（未設定で作るだけなので問題ない）。

## テスト

- `backend/__tests__/api/routers/master/test_customers_router.py`:
  `null` を送った任意項目がリポジトリの更新内容に含まれること
- `frontend/src/app/master/customers/page.test.tsx`:
  空欄（空白のみを含む）にした項目を `null` で送ること、空欄にしていない項目はそのまま送ること

## 関連

- Issue #518: 受注の編集ダイアログ（`edit-order-dialog.tsx`）にも同じパターンがあり、
  同方針で修正した。[order-edit-clear-optional-fields.md](order-edit-clear-optional-fields.md) 参照
