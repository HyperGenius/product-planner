# 社内転送者の登録と、注文書の中身からの顧客解決（Issue #521）

社長（社内の共通メールアカウント）など、受注書を取り込み用アドレスへ転送してくる社内の
アドレスを「社内転送者」としてテナントごとに登録し、差出人で顧客を突合・作成しないようにする。
顧客は添付の注文書の中身（発行元の会社名・FAX 番号）から決め、決まらないものは
`customer_id` NULL（顧客不明）で起票して担当者に選ばせる。

---

## 背景

- FAX 受信の PDF やファイル共有システムで受領した PDF は、社長が件名・本文なしで転送してくる
- 本文に転送ヘッダーが無いため、`resolve_or_create_customer()` は実際の差出人（＝社長のアドレス）で
  `customers.email` を突合し、一致しなければ社長のアドレスで下書き顧客を作っていた
  （[customer-matching-real-from-priority.md](customer-matching-real-from-priority.md)、Issue #311）
- その結果、社長からの転送はすべて「社長の下書き顧客」に紐づいた。テキスト PDF は #385 で文面の会社名から
  付け直されるが、会社名が一意に決まらない PDF・画像 PDF は社長の下書き顧客のまま起票されていた

## データモデル

マイグレーション: `supabase/migrations/20261012000000_add_internal_senders_and_customer_fax.sql`

| テーブル / 列 | 内容 |
|---|---|
| `tenant_internal_senders` | `id` / `tenant_id` / `email`（小文字・前後空白なしを CHECK で強制）/ `created_by` / `created_at`。UNIQUE `(tenant_id, email)` |
| `customers.fax_number` | FAX 番号（表記はハイフン等を含んだまま保存。照合時に数字だけへ正規化する） |

- RLS: `tenant_internal_senders` はテナントメンバーが SELECT / INSERT（`created_by = auth.uid()`）/ DELETE できる。
  操作できるロールを president / platform_admin に絞るのは API 側（日報の別名辞書と同じ方針）
- Gmail 取り込み（cron）は service role で読むので、`tenant_id` で明示的に絞り込む

## 顧客「不明」の表し方: `customer_id` NULL

テナントごとの「顧客不明」レコードを作る案もあったが、NULL を採用した。

- 重複判定: `upsert_order_by_dedupe_key` は `(tenant_id, customer_id, …)` の UNIQUE で重複を判定する。
  NULL 同士は一致しないので、顧客不明の受注は常に新規 INSERT になる（別の顧客の注文が誤って
  1件に統合されない）。共通の「顧客不明」レコードにすると、品番・納期が同じ別顧客の注文が統合されてしまう
- RPC・`orders.customer_id`（NULL 可）の変更が不要
- フロントは既に顧客未設定の受注を扱っている（受注一覧の「未設定」表示・「情報不足」通知カード・
  `?status=incomplete` の絞り込み・編集ダイアログの顧客選択）。メール由来（`source_type='email'`）の
  顧客未設定は「顧客不明」と表示を変えた（`order-table-row.tsx` / 受注詳細）

NULL を許すため、パース側の `_require_customer_id()`（None を不整合として例外にしていた）を
`_staging_customer_id()` に置き換えた。顧客不明の明細では、顧客単位の製品別名辞書
（`match_product_by_alias`）と内示の無効化（`_mark_superseded_orders`）を行わない。

## 処理の流れ

### Gmail 取り込み（`gmail_service._process_message`）

1. `load_internal_sender_emails(db, tenant_id)` でテナントの社内転送者を読む
2. `resolve_or_create_customer(..., internal_senders=...)`:
   - 差出人が社内転送者なら、差出人での突合・下書き顧客の作成をしない
   - 本文の候補（転送ヘッダー・署名欄）からは社内転送者のアドレスを除く
   - 社長が通常の転送機能で転送した（本文に転送ヘッダーがある）場合は、従来どおり本文で決まる
   - 本文の候補が無ければ `customer_id=None` を返す（下書き顧客を作らない・作成通知も出ない）
3. ステージング行（`order_attachments`）は `customer_id` NULL で保存される

### パース（`pdf_order_parsing_service`）

`match_customer_by_pdf_text(db, tenant_id, pdf_text, phone_numbers=())` で注文書の中身から顧客を決める。

| 経路 | 会社名 | 番号（FAX・電話） |
|---|---|---|
| テキスト PDF | 文面全体（#385） | 文面の電話番号の形をした番号すべて（`extract_phone_numbers`。見出しの有無は問わない） |
| 画像 PDF（#520） | モデルが読み取った `issuer_company_name` | モデルが読み取った `issuer_fax_number`（FAX 受信ならページ上端の送信元ヘッダー行を優先）・`issuer_phone_number` |

- 番号は顧客マスタの `fax_number` と `phone_number` の両方と突合する
- 優先順位: 会社名で一意 → 番号で一意 → 決まらない
- 会社名と番号が別の顧客に一意に当たった場合は確定しない
- 会社名が複数の顧客に当たっても、番号で一意なら番号で決める
- 番号は数字だけに正規化し、国内番号（0 始まりの10〜11桁）だけを使う（`normalize_phone_number`）。
  顧客マスタにはどの書き方で登録してもよい
- **自社の番号の扱い**: 注文書には宛先（自社）の番号も載っているが、自社は顧客マスタに無いので
  照合に当たらない。そのため自社の番号を別に登録して除外する仕組みは持たない
- **納入先など別の顧客の番号が載っている場合**: 番号が2社に当たるか会社名と食い違うので確定しない（顧客不明に倒す）

#### テキスト PDF から拾う番号の書き方（Issue #524）

顧客マスタへの登録作業で、次のケースが見つかった（#521 の時点では「FAX」見出し付き・ハイフンか
市外局番の括弧の書き方しか拾えず、電話番号は使っていなかった）。

- FAX の送信元番号が、見出し無しで印字されている
- 表記揺れ: ハイフンなし、市内局番を括弧で囲む（`0480(12)3456`。番号はダミー）
- 会社名と電話番号はあるが FAX 番号が無い注文書／会社名しか無い注文書

拾う書き方（NFKC 後）: `0480-12-3456` / `0480123456` / `(0480)12-3456` / `0480(12)3456` / 空白区切り /
ハイフン類（‐ − ー 等）。行はまたがず、前後が数字の場合（長い数字列の一部）は拾わない。日付・郵便番号・
0 始まりでない数字列は拾わない。会社名しか無い注文書は会社名だけで照合するので、注文書の表記が顧客マスタの
顧客名と違う場合は「通称」に注文書の表記を登録する。

- 決まらなければステージング行の `customer_id`（社内転送者からのメールでは NULL＝顧客不明）で起票する

## API

`backend/app/routers/tenant/internal_senders.py`（president / platform_admin のみ）

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/tenant/internal-senders` | 一覧（メールアドレス順） |
| POST | `/tenant/internal-senders` | 登録。`{"email": ...}`（形式は `EmailStr` で検証し、小文字にして保存）。重複は 409 `{"error": "duplicate_internal_sender", "message": ...}` |
| DELETE | `/tenant/internal-senders/{id}` | 登録解除。他テナント・存在しない ID は 404 |

顧客マスタの作成・更新（`/customers`）に `fax_number` を追加した（PATCH で空欄にしたら null を送る。#517 の規約）。

## フロントエンド

- `/settings/internal-senders`（サイドバー「設定 > 社内転送者」）: 一覧・登録・解除（解除は確認ダイアログで完了を待って閉じる）
- 顧客マスタ: FAX 番号の列・入力欄
- 受注一覧・受注詳細: メール由来で顧客未設定の受注を「顧客不明」と表示（ツールチップで「編集から顧客を選んでください」）

## リリース時の作業（本番）

本番には既に、社長のアドレスで作られた下書き顧客と、それに紐づく受注がある可能性が高い。
以下は手順の雛形で、実際のアドレス・ID は手元でのみ扱う。本番データの確認・更新は承認を得てから行う。

1. 社内転送者の画面で、社長のアドレスを登録する（以降の取り込みから顧客を作らなくなる）
2. 社長のアドレスで作られた顧客を確認する

   ```sql
   SELECT id, name, status FROM customers
   WHERE tenant_id = '<tenant_id>' AND lower(email) = '<社長のアドレス>';
   ```

3. その顧客に紐づく受注を確認する（承認済み以降の受注は個別に判断する）

   ```sql
   SELECT id, status, source_type, product_id, deadline_date FROM orders
   WHERE tenant_id = '<tenant_id>' AND customer_id = <顧客ID>;
   ```

4. 下書きの受注を顧客不明に戻す。`orders.customer_id` の更新はトリガー
   `trg_sync_order_attachments_customer_id` で紐づく添付行にも反映される。ステージング行
   （`order_id IS NULL`）は別に更新する

   ```sql
   UPDATE orders SET customer_id = NULL
   WHERE tenant_id = '<tenant_id>' AND customer_id = <顧客ID> AND status = 'draft';
   UPDATE order_attachments SET customer_id = NULL
   WHERE tenant_id = '<tenant_id>' AND customer_id = <顧客ID> AND order_id IS NULL;
   ```

5. 受注一覧の「情報不足」から顧客を選び直す。参照が無くなったら顧客マスタから社長の下書き顧客を削除する
   （製品の別名辞書 `product_name_aliases` に同じ顧客の行があれば、正しい顧客へ付け替えるか削除する）

## スコープ外

- 社内転送者以外の差出人の扱い（顧客から直接届いたメール・転送ヘッダー付きの転送）は変更しない
- 顧客不明の受注を通知する新しい通知種別は追加しない（受注一覧の「情報不足」通知カードで件数を出す）
- 起票済みの受注の顧客を、マスタの FAX 番号を後から登録したときに自動で付け直す処理

## 関連

- [customer-draft-auto-create.md](customer-draft-auto-create.md): 下書き顧客自動作成の基本設計
- [customer-matching-real-from-priority.md](customer-matching-real-from-priority.md): 実 From ヘッダー優先（Issue #311）
- [pdf-order-parsing.md](pdf-order-parsing.md): 束ね添付での PDF 単位の顧客解決（#385）・画像 PDF の読み取り（#520）
