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

## 管理画面と API（Issue #611）

顧客マスタ（`/master/customers`）の各行の「担当者」ボタンで `CustomerContactsDialog`
（`components/customer-contacts/`）を開き、担当者の一覧・追加・削除を行う。

| API | 内容 |
|---|---|
| `GET /customers/{id}/contacts` | 一覧（テナントメンバー全員） |
| `POST /customers/{id}/contacts` | 追加。`email` は `normalize_contact_email()` で正規化して保存、`contact_name` は任意（空白のみは NULL） |
| `DELETE /customers/{id}/contacts/{contact_id}` | 削除 |

- 追加・削除できるのは `order_handler` / `president` / `platform_admin`（Backend `_CONTACT_EDITOR_ROLES` と
  Frontend `CUSTOMER_CONTACT_EDITOR_ROLES` を揃える）。それ以外のロールは一覧の閲覧のみで、画面にも操作を出さない
- アドレスが登録済み（別の顧客・同じ顧客とも）なら 409 `duplicate_contact_email`。`message` に登録先の顧客名
  （「…は「○○」に登録済みです」）、`conflicting_customer`（`{id, name}`）を付け、画面は入力欄の下に文言を出す
- 他テナントの顧客 ID は 404。顧客の `email` と同じ担当者を削除したときは `customers.email` も空にする
  （残すと、顧客を保存したときに `sync_primary_contact()` が担当者を登録し直してしまうため）

## 突合（`customer_matching_service.resolve_customer()`）

`customers.email` の検索を `customer_contacts` の検索に置き換えた。会社名・FAX・電話での突合（#385 / #521）は変えない。

- 検索するアドレスは `normalize_contact_email()`（小文字・前後空白除去）で揃える
- 候補が複数のアドレスに当たっても、**同じ顧客の担当者なら1件として数える**。別々の顧客に当たったら従来どおり確定しない
- 担当者に当たらない未登録のアドレスは**下書き顧客を作らず顧客不明（`customer_id` NULL）**にする（Issue #609。下記「顧客不明の注文の紐づけ」）

## 顧客 API との同期（`customer_contact_service`）

`customers.email` は「主たる担当者のアドレス」として残し、API で渡されたときに担当者へ反映する。

| 操作 | 担当者への反映 |
|---|---|
| `POST /customers`（email あり） | 担当者として登録 |
| `PATCH /customers/{id}`（email を送った） | 旧アドレスの担当者を外し、新アドレスを登録 |
| `PATCH /customers/{id}`（email を送らない） | 触れない |

- 新アドレスが**別の顧客に登録済み**のときは付け替えず、ログ（warning）だけ残す。保存は成功する
  （付け替えると取り込みの結果が黙って変わるため。管理画面での整理は後続の Issue）
- 担当者を直接増減する API・画面は下記「管理画面と API」（Issue #611）

## 顧客不明の注文の紐づけ（Issue #609）

実From・本文のどのアドレスも担当者に当たらず、会社名・番号でも決まらない注文は、下書き顧客（`status='draft'`）を
作らず `customer_id` NULL（顧客不明。社内転送者と同じ扱い、#521）で起票する。`customer_draft_created` 通知は
出さなくなった（既存の通知行・種別は履歴として残す）。顧客不明の注文は「起票の確認」の区分で拾う。

### 差出人の保存

`order_attachments.sender_email`（`20261101000000_add_link_customer_to_unknown_orders.sql`）に、取り込み時に解決した
差出人（`extract_effective_sender_email()`：本文の転送ヘッダー → 実From → 本文）を小文字で保存する。ステージング行
（`order_id IS NULL`）にだけ入り、注文からは `orders.source_attachment_id` で引く。この列を入れる前の行は NULL
（紐づけはできるが担当者の登録は提案しない）。

### 紐づけ（RPC `link_customer_to_unknown_orders`）

編集ダイアログで顧客不明の注文に顧客を選ぶと、フロントは通常の項目を `PATCH /orders/{id}`（`customer_id` は含めない）
で保存したあと `POST /orders/{id}/link-customer` を呼ぶ。注文・ステージング行・担当者の更新は RPC が1トランザクションで行う
（`SECURITY INVOKER`、ユーザー JWT）。

| 引数 | 内容 |
|---|---|
| `register_contact`（既定 true） | 差出人を選んだ顧客の担当者として登録。**別の顧客の担当者として登録済みなら上書きせず 409 `contact_owned_by_other_customer`**（全体を巻き戻す）。同じ顧客なら何もしない |
| `apply_to_same_sender`（API の既定 false、画面の既定は on） | 同じ差出人の、顧客不明の**下書き**注文と、まだ注文になっていないステージング行も同じ顧客へ紐づける。重複（`orders_dedupe_key` 等）になる注文だけ紐づけず `skipped_order_ids` で返す |

- 指定した注文自身が重複する場合は 409 `duplicate_order`（`conflicting_order` 付き）で全体を失敗させる
- すでに顧客がある注文は 409 `customer_already_set`
- 注文の `customer_id` の更新はトリガー `trg_sync_order_attachments_customer_id`（#315）がステージング行・添付行へ同期する
- 権限は `PATCH /orders/{id}` と同じ（テナントのメンバー）

### 候補表示（`GET /orders/{id}/customer-link-context`）

差出人・差出人が登録済みの顧客（`contact_owner_customer_id`）・同じドメインの担当者を持つ顧客
（`candidate_customer_ids`）・まとめ直しの対象件数を返す。同じドメインの顧客は顧客選択の先頭に「同じドメイン」として
出すだけで、**自動では確定しない**（フリーメール・共有ドメインの誤確定を避ける）。

## 重複顧客の統合（Issue #610）

#608 以前に作られた「担当者名つきの下書き顧客」など、同じ会社の重複顧客を顧客マスタ画面（`/master/customers` の「顧客の統合」。
president / platform_admin のみ）から1つにまとめる。製品の統合（#515、[product-master.md](product-master.md#重複製品の統合issue-515)）の顧客版で、構成も同じ。

- **事前チェック**: `customer_merge_service.plan_merge()`（純粋関数）をプレビュー `POST /customers/merge/preview` と実行 `POST /customers/merge`
  （実行直前に再検証。止める理由があれば 409 `merge_blocked`、RPC が競合で失敗したら 409 `merge_conflict`）で共有する。
  止める理由は `order_conflict` のみ: 付け替えると受注の UNIQUE（`orders_dedupe_key` / `orders_dedupe_key_unmatched_product` /
  `orders_repair_customer_order_no_key`）が衝突する統合される側の受注。残す顧客の受注（無ければ ID の若い受注）が枠を持つ。
  製品の統合と違い、出荷済みでも自動では削除しない。
- **実行**: RPC `merge_customers`（`SECURITY INVOKER`、1トランザクション）。付け替え対象は `orders` / `order_attachments`（ステージング行を含む）/
  `product_name_aliases` / `product_name_alias_history` / `customer_name_aliases` / `daily_report_unallocated_actuals` /
  `customer_extraction_prompt_history` / `customer_contacts`。統合される側の `customers.email` で担当者に無いものは担当者として足す。
  `product_name_aliases` の `(顧客, 表記)` の UNIQUE が衝突する分は**統合先を優先して統合される側を捨てる**（`aliases_dropped`）。
  プレビュー後に受注が変わった場合は 23505、顧客が消えていれば P0002、削除件数の不一致は P0001 で全体を失敗させる。
- **権限**: UPDATE ポリシーの無かった `daily_report_unallocated_actuals` / `customer_extraction_prompt_history` は `customer_id` 列だけの
  `GRANT UPDATE` ＋ president / platform_admin のポリシーを足し、`product_name_alias_history` の列 GRANT に `customer_id` を足した。
- **履歴**: RPC が `customer_merge_log`（追記のみ）へ、統合先・統合された顧客の統合時点の内容（id / 名前 / 通称 / email）・付け替え件数・実行者を残す。
  `GET /customers/merge-log` と画面の「統合履歴」で見られる。
- **顧客を参照する FK を新しく足すとき**は、`merge_customers` の付け替え対象に入れるか CASCADE にするかを決める。
- 日報の進捗（`order_process_progress`）は顧客を持たないので影響しない。未割当の結果は次回の cron の再計算でも整う。

## テスト

- unit: `test_customer_contact_service.py` / `test_customer_matching_service.py`
- api: `test_customers_router.py` / `test_customer_contacts_router.py`（#611）
- integration: `test_customer_contacts.py`（UNIQUE・CHECK・CASCADE・複数アドレスの解決）/ `test_link_customer_to_unknown_orders.py`（#609 の RPC）
- #609: unit `test_customer_link_service.py`、api `test_order_customer_link.py`、frontend `edit-order-dialog.test.tsx`
- #611: frontend `customer-contacts-dialog.test.tsx`
- #610: unit `test_customer_merge_service.py`、api `test_customer_merge_router.py`、integration `test_merge_customers.py`（付け替え・履歴・ロール・競合時のロールバック）、frontend `customer-merge-dialog.test.tsx`
