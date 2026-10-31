# 顧客の担当者（customer_contacts）と Gmail 取り込みの突合（Issue #608）

1社に複数の担当者がいて、それぞれのアドレスから注文が来るケースに対応する。従来は `customers.email` が
1顧客1アドレスだったため、未知の担当者のアドレスごとに「担当者名つきの下書き顧客」が作られ、同じ会社の
注文が複数の顧客に分かれていた。Epic の第1段階（管理画面は別 Issue）。

## データモデル

`customer_contacts(id, tenant_id, customer_id, email, contact_name, created_at)`
（`supabase/migrations/20261031000000_add_customer_contacts.sql`）

- `email` は小文字・前後空白なし（CHECK）。`(tenant_id, email)` が UNIQUE なので、同じアドレスが2つの顧客に属することはない
- `customer_id` は `ON DELETE CASCADE`（顧客を消すと担当者も消える）
- RLS は `is_tenant_member(tenant_id)`。Gmail 取り込み（cron）は service role で読み書きし、`tenant_id` で明示的に絞る
- 初期移行で `customers.email` を担当者へ複製した。正規化後に重複するアドレスは `id` の小さい（先に登録された）顧客を優先。
  `customers.email` 列は互換のため残している

## 突合（`customer_matching_service.resolve_or_create_customer()`）

`customers.email` の検索を `customer_contacts` の検索に置き換えた。会社名・FAX・電話での突合（#385 / #521）は変えない。

- 検索するアドレスは `normalize_contact_email()`（小文字・前後空白除去）で揃える
- 候補が複数のアドレスに当たっても、**同じ顧客の担当者なら1件として数える**。別々の顧客に当たったら従来どおり確定しない
- 未知のアドレスで下書き顧客を作ったときは、そのアドレスを担当者にも登録する（次回から同じ下書き顧客に解決される）

## 顧客 API との同期（`customer_contact_service`）

`customers.email` は「主たる担当者のアドレス」として残し、API で渡されたときに担当者へ反映する。

| 操作 | 担当者への反映 |
|---|---|
| `POST /customers`（email あり） | 担当者として登録 |
| `PATCH /customers/{id}`（email を送った） | 旧アドレスの担当者を外し、新アドレスを登録 |
| `PATCH /customers/{id}`（email を送らない） | 触れない |

- 新アドレスが**別の顧客に登録済み**のときは付け替えず、ログ（warning）だけ残す。保存は成功する
  （付け替えると取り込みの結果が黙って変わるため。管理画面での整理は後続の Issue）
- 担当者を直接増減する API・画面は無い（後続の Issue）

## テスト

- unit: `test_customer_contact_service.py` / `test_customer_matching_service.py`
- api: `test_customers_router.py`
- integration: `test_customer_contacts.py`（UNIQUE・CHECK・CASCADE・複数アドレスの解決）
