# 顧客削除時の外部キー制約エラーハンドリング（Issue #312）

顧客マスタで受注/添付データから参照されている顧客を削除しようとすると、外部キー制約違反が
FastAPI/フロントエンドで握りつぶされ、常に汎用的な「顧客の削除に失敗しました」トーストしか
表示されず、原因が分からない問題を解消する。

---

## 背景

メール受注取り込みで自動作成される下書き顧客（[customer-draft-auto-create.md](customer-draft-auto-create.md)
参照）は、作成直後に `order_attachments.customer_id` から参照されるステージング行を必ず伴う。
`customers.id` を参照する外部キー（`orders.customer_id`, `order_attachments.customer_id`、
いずれも `ON DELETE` 句なし）があるため、これらの顧客を削除しようとすると Postgres が
`23503 foreign_key_violation` を返すが、従来は以下の理由でユーザーに原因が伝わらなかった。

- `BaseRepository.delete`（`base_repo.py`）に例外処理がなく、`APIError` がそのまま伝播し
  FastAPI が汎用的な 500 を返す
- `delete_customer` ルーターにも `try/except` がない
- フロントエンドの `handleDelete`（`page.tsx`）が `catch` 内で実際のエラー内容を見ず、
  固定文言のトーストのみを表示していた

## 修正内容

### バックエンド

- `BaseRepository.delete`（`backend/app/repositories/supa_infra/common/base_repo.py`）で
  `postgrest.exceptions.APIError` を捕捉し、`code == "23503"`（外部キー制約違反）の場合は
  `ValueError("他のデータから参照されているため削除できません")` に変換する。
  それ以外の `APIError` はそのまま再送出する（`create` の一意制約違反ハンドリングと同じパターン）
- `delete_customer`（`backend/app/routers/master/customers.py`）で `ValueError` を捕捉し、
  `HTTPException(status_code=409, detail=str(e))` を返す

### フロントエンド

- `frontend/src/app/master/customers/page.tsx` の `handleDelete` で、`error` が `ApiError`
  かつ `data.detail` が文字列の場合はそれをトーストメッセージとして表示し、それ以外は
  従来通り汎用メッセージ「顧客の削除に失敗しました」を表示する

## スコープ外

- 下書き顧客に紐づく `order_attachments`（ステージング行）がある場合の削除可否自体の仕様変更
  （カスケード削除や `customer_id` の NULL 化など）は本Issueのスコープ外とし、現状通り
  「関連データがある場合は削除をブロックし、理由を表示する」動作とする
  - → 注文の顧客変更時に `order_attachments.customer_id` が追従しない問題は
    Issue #315（[order-attachments-customer-sync.md](order-attachments-customer-sync.md)）で対応

## 受け入れ条件

- [x] 関連データ（受注/添付）が存在する顧客を削除しようとした際、具体的な理由を含む
      エラーメッセージ（「他のデータから参照されているため削除できません」）が表示されること
- [x] 関連データが存在しない顧客は正常に削除できること
- [x] 既存のテストをパスし、新しいエラーハンドリングを検証するテストを追加すること
      (`__tests__/unit/repositories/supabase/common/test_base_repo.py`,
      `__tests__/api/routers/master/test_customers_router.py`)
- [x] 型・Lint エラーが出ていないこと

## 関連

- [customer-draft-auto-create.md](customer-draft-auto-create.md): 下書き顧客が
  `order_attachments` から参照される経緯
- Issue #312: 顧客マスタで関連データを持つ顧客を削除できず理由も表示されない
