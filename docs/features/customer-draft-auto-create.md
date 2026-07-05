# 顧客が特定できないメール/PDF起票での下書き顧客自動作成（Issue #263, #265）

メール/PDF起票で送信者の顧客が特定できない場合に `customer_id` が NULL のまま起票されてしまう
問題（#262 の根本原因の一つ）を解消する。顧客情報を事前に登録していなくても、下書き状態の
顧客を自動作成して `customer_id` を必ず設定し、担当者が後から手直しするだけで受注登録が
完結する体験にする。

---

## 背景と目的

- メールアドレスが本文から抽出できない場合でも、注文起票時に `customer_id` を必ず設定する
  （NULL のまま残さない）
- 自動作成された顧客は「下書き」であることを明示し、担当者が後で正しい顧客情報に
  手直しできるようにする
- 従来「メールアドレスは分かるが未登録」の顧客も無自覚に自動作成されており
  （`resolve_or_create_customer`）、正規登録の顧客と区別がつかなかった。これも下書き扱いに揃える

---

## DBスキーマ変更

### `customers.status` 追加 (`20260704000000_add_customer_status.sql`)

```sql
alter table customers
add column status text not null default 'active'
check (status in ('active', 'draft'));
```

`orders.status` と同じ命名パターン（`text` + CHECK制約 + comment）。既存の全顧客は
`default 'active'` によりそのまま `active` 扱いになり、既存データへの影響はない。

### `notifications.notif_type` に `customer_draft_created` を追加

(`20260704000001_add_customer_draft_created_notif_type.sql`)

[notifications.md](notifications.md) の CHECK 制約に `customer_draft_created` を追加する
（既存の6種類の列挙値に追加するだけで、テーブル自体の変更はなし）。

---

## バックエンド設計

### `resolve_or_create_customer` の拡張 (`customer_matching_service.py`)

```python
def resolve_or_create_customer(
    db: Client,
    tenant_id: str,
    email: str | None,
    received_at: str | int | None = None,
) -> tuple[int, bool]:
    ...
```

- 戻り値を `int`（customer_id）から `tuple[int, bool]`（customer_id, 新規に下書き作成したか）
  に変更。呼び出し元が「下書きを作成したかどうか」を意識せず通知を出せるようにするため
- `email` が既存顧客と一致した場合: 従来通りその `customer_id` を返す（`status` は変更しない）
- `email` があり新規作成する場合: `status='draft'` で作成する
- `email` が無い場合: 常に新規の下書き顧客を作成する。`name` は
  `不明な顧客 (YYYY-MM-DD HH:MM)` 形式のプレースホルダーとし、`received_at`
  （Gmailメッセージの `internalDate`、epoch millis）から算出する。取得できない・不正な値の場合は
  処理実行時刻にフォールバックする

### 呼び出し元 `gmail_service.py` の修正

`_process_message` 内の PDF添付分岐・非PDF分岐の両方で、`sender_email` の有無に関わらず
必ず `resolve_or_create_customer` を呼ぶように変更した（変更前は
`if sender_email else None` で丸ごとスキップされ `customer_id=None` になっていた）。

いずれの分岐でも `msg.get("internalDate")` を `received_at` として渡し、下書き顧客が
新規作成された場合は `create_notification` で `customer_draft_created` を記録する
（`source_table="gmail_message"`, `source_id=msg_id`）。

---

## メールアドレス/顧客名抽出の改善（Issue #265）

Issue #263 の実装では、メールアドレス抽出そのもの（`extract_sender_email`）と本文取得
（`_get_message_body`）に不具合があり、転送メールの一部パターンで顧客が正しく特定できなかった。
本Issueでこれらを修正し、あわせて顧客名の抽出ロジックを新設した。

### 前提（運用フロー）

- ユーザ（テナントの担当者）がユーザの顧客からの受注メールを、意思をもって intake 用
  Gmail アドレスへ**転送する**運用を前提とする
- そのため実際の Gmail `From` ヘッダは常に転送した社内ユーザのアドレスであり、
  顧客の特定には使えない。顧客の情報は本文中に引用された「元メッセージ」（`From:`/`差出人:`
  ヘッダ、署名ブロック）にのみ含まれる
- 顧客のメールアドレスが既知であれば `customers` テーブルに事前登録されている

### 発覚した不具合

1. **`_get_message_body` の本文取得漏れ (`gmail_service.py`)**
   PDF添付メールは Gmail API 上で `multipart/mixed`（PDF添付部分と本文部分）の直下に
   `multipart/alternative`（`text/plain`/`text/html`）がネストする構造になる。
   従来の実装はトップレベルの `parts` しか見ておらず、本文が常に空文字になっていた
   → `_find_part_data` で `parts` を再帰的に探索するよう修正（`text/plain` 優先、
   `text/html` にフォールバック）

2. **`extract_sender_email` の候補選択が曖昧 (`customer_matching_service.py`)**
   本文中に複数の `From:`/`差出人:` 行が存在する場合（多段転送や返信の引用が重なる場合）に
   `re.search`（最初の1件のみ）を使っており、どれを顧客として採用するかが不定だった
   → 全候補を抽出したうえで「最後に出現したもの（一番奥＝最初にメールを書いた本人）」を
   優先するように変更

3. **顧客名抽出ロジックが存在しない**
   新規下書き顧客の `name` は常に生のメールアドレス文字列（`email`）がそのまま入っており、
   会社名・氏名は一切抽出されていなかった

### `resolve_or_create_customer` のシグネチャ変更

```python
def extract_sender_email_candidates(body: str) -> list[str]: ...

def extract_customer_name(body: str, email: str) -> str | None: ...

def resolve_or_create_customer(
    db: Client,
    tenant_id: str,
    body: str,
    received_at: str | int | None = None,
) -> tuple[int, bool]:
    ...
```

- 引数を `email: str | None` から `body: str`（メール本文そのもの）に変更し、
  マッチング処理自体を `customer_matching_service.py` に集約した
- `extract_sender_email_candidates(body)` で本文中の全候補メールアドレス
  （出現順・重複排除）を抽出し、`customers.email` との積集合を取る
  - **積集合が1件** → その顧客に確定（`customer_id` を返す、`status`/`name` は変更せず、
    顧客名抽出も行わない）
  - **積集合が0件（完全新規）または2件以上（相見積もり等で判定不能）** → 候補集合のうち
    「最後に出現したもの」1件に絞り込み、従来通りメールアドレス単体での検索/下書き作成
    （`_resolve_or_create_by_single_email`）にフォールバックする
    - 0件の場合のみ `extract_customer_name(body, email)` で署名ブロックから
      会社名・氏名を抽出し、下書きの `name` に使う（抽出できなければ email 文字列にフォールバック）
- `extract_sender_email(body)` は後方互換・通知ログ用に残置（候補集合のうち最後の1件を返す）

### `extract_customer_name` の署名ブロック解析

- 本文中で対象メールアドレスが最後に出現する行を署名欄とみなし、その直前の罫線区切り
  （`----` 等、なければ最大40行遡る）から会社名・氏名を探索する
- 会社名: `株式会社`/`有限会社`/`合同会社`/`合資会社`/`㈱`/`㈲` を含む行
- 氏名: 会社名より後の行のうち、`TEL`/`FAX`/`〒`/`e-mail` や数字を含まない行から、
  全角/半角スペース2つ以上で区切られた末尾（「部署名　　氏名」形式を想定）を候補とし、
  最後に見つかったものを採用する
- 会社名・氏名の両方が取れれば `"会社名 氏名"`、会社名のみなら会社名を返す。
  どちらも取れなければ `None`（呼び出し元で email 文字列にフォールバック）

### 顧客編集フォームでの「確定」(`routers/master/customers.py`)

`PATCH /customers/{id}` (`update_customer`) は、リクエストの更新内容に関わらず `status` を
強制的に `'active'` に上書きして保存する。専用の「確定」ボタンは設けず、既存の編集フォームで
保存するだけで下書き解除される仕様とした。

### レスポンススキーマ

`Customer`（読み取り用スキーマ、`models/master/customer_schemas.py`）に
`status: str = "active"` を追加し、フロントエンドで下書き判定できるようにした。
`CustomerCreateSchema` / `CustomerUpdateSchema` には追加していない
（`status` は常にサーバー側ロジックで決まり、クライアントから直接指定する経路がないため）。

---

## フロントエンド設計

- `frontend/src/types/customer.ts`: `Customer.status: "active" | "draft"` を追加
- `frontend/src/app/master/customers/page.tsx`: 顧客一覧テーブルの顧客名セルに
  `status === "draft"` の場合 `Badge variant="secondary"` で「下書き」を表示
- `frontend/src/components/customer-selector.tsx`: 顧客選択コンボボックスの各選択肢にも
  同様に「下書き」バッジを表示

---

## 受け入れ条件

- [x] メールアドレスが抽出できないメール/PDF起票でも `customer_id` が必ず設定され、
      対応する顧客が `status='draft'` で作成されること
- [x] メールアドレスがあるが未登録だった場合も、自動作成された顧客が `status='draft'` になること
- [x] 下書き顧客作成時に通知（`customer_draft_created`）が記録されること
- [x] 顧客一覧・セレクターで下書き顧客が視覚的に区別できること
- [x] 既存の顧客編集フォームで保存すると `status` が `active` になること
- [x] 既存のテストをパスし、新規ロジックのユニットテストを追加すること
      (`__tests__/unit/services/test_customer_matching_service.py`)
- [x] 型・Lint エラーが出ていないこと

### Issue #265 で追加した受け入れ条件

- [x] PDF添付メール（`multipart/mixed` に `multipart/alternative` がネストする構造）でも
      本文が正しく取得できること
- [x] 本文中に複数の `From:`/`差出人:` 候補がある場合、既存顧客との積集合により
      1件に絞り込めるケースでは顧客名抽出を行わずに確定できること
- [x] 積集合が0件・2件以上の場合は最後に出現した候補にフォールバックすること
- [x] 新規下書き顧客の `name` が、抽出できた場合は署名ブロックの会社名/氏名になり、
      抽出できない場合はメールアドレスにフォールバックすること
- [x] 既存のテストをパスし、新規ロジックのユニットテストを追加すること
      (`__tests__/unit/services/test_customer_matching_service.py`,
      `__tests__/unit/services/test_gmail_service.py`)
- [x] 型・Lint エラーが出ていないこと

---

## スコープ外（このIssueではやらない）

- `_mark_superseded_orders` の NULL customer_id ハンドリング自体のバグ修正（#262 で対応予定）
- 下書き顧客専用の「確定」ボタンや一括確定UI
- 顧客詳細ページの新設（現状は一覧ページの編集ダイアログのみ）
- （#265）積集合が0件の場合の重複ドラフト作成防止ロジック（同一顧客からの複数メールで
  下書きが重複しうるが、実データを見てから優先度を判断する）
- （#265）積集合が2件以上の場合のタイブレーク方法の改善（現状は最後に出現した候補への
  フォールバックのみ）
- （#265）同一会社の別担当者アドレスをドメイン単位でマッチさせる拡張

---

## 関連

- [email-order-intake.md](email-order-intake.md): メール起票の基盤設計、`customer_matching_service.py` の位置づけ
- [notifications.md](notifications.md): `notifications` テーブル・`create_notification` の共通設計
- Issue #262: `customer_id=NULL` によるbigint型エラー（本Issueで新規発生分はほぼ解消見込み）
- Issue #259, #168: 関連Issue
- Issue #265: 転送メールの顧客メールアドレス/顧客名抽出が正しく行われない不具合の修正
