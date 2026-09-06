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
  （Gmailメッセージの `internalDate`、epoch millis、UTC）から算出する。取得できない・不正な値の場合は
  処理実行時刻にフォールバックする。実行ホストのタイムゾーンに関わらず表示はJSTで統一するため、
  `received_at` はUTCとして解釈した上で `app.utils.calendar.JST` へ変換する
  （変換前はUTCのままフォーマットしてしまい、日本のユーザーから見て9時間ずれて表示される
  不具合があった）

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
  Gmail アドレスへ**転送する**運用を主として想定するが、顧客が intake 用アドレスへ
  **直接**メールを送るケースも存在する（Issue #311）
- 転送メールの場合、実際の Gmail `From` ヘッダは転送した社内ユーザのアドレスであり、
  顧客の特定には使えない。顧客の情報は本文中に引用された「元メッセージ」（`From:`/`差出人:`
  ヘッダ、署名ブロック）にのみ含まれる。一方、本文中にこの引用ヘッダーが存在しない場合は
  顧客からの直接メールとみなし、実際の Gmail `From` ヘッダそのものが顧客のメールアドレスに
  なるため、これを最優先の突合シグナルとして使う（詳細は
  [customer-matching-real-from-priority.md](customer-matching-real-from-priority.md) 参照）
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

## ヘッダー行が本文化されない「直接転送」への対応（Issue #298）

Issue #265 の前提「ユーザが intake 用 Gmail アドレスへ**転送する**」は、メーラーの転送機能
（`Forward`）を使うことを想定しており、その場合 `From:`/`差出人:` ヘッダー行がテキストとして
本文に残る。運用調整により、宛先を差し替えて直接転送する「直接転送」形式に変更したところ、
このヘッダー行自体が本文に含まれなくなり、`extract_sender_email_candidates` が常に空集合を
返すようになった。結果、署名ブロックからの会社名抽出（`extract_customer_name`）も一切起動
されず、`不明な顧客 (YYYY-MM-DD HH:MM)` の下書きになってしまっていた。

### 修正内容 (`customer_matching_service.py`)

- `extract_body_email_candidates(body)` を追加。ヘッダー行の有無に関わらず、本文全体から
  メールアドレス（`[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}`）を出現順・重複排除で
  抽出する
- `resolve_or_create_customer` は `extract_sender_email_candidates(body)`（ヘッダー行ベース）
  が空集合の場合のみ、`extract_body_email_candidates(body)` にフォールバックする。以降の
  積集合判定・`extract_customer_name` による署名ブロック抽出ロジックは変更なし（抽出元の
  候補集合が変わるだけ）
- `extract_effective_sender_email(body)` を追加し、`resolve_or_create_customer` と同じ優先順位
  （ヘッダー行 → 本文全体）で解決したメールアドレスを返す。`gmail_service.py` の
  `customer_draft_created` 通知payload用の `sender_email` はこちらに置き換えた
  （従来の `extract_sender_email` はヘッダー行のみを見るため、直接転送メールでは常に `None`
  になり通知内容が不正確だった）

### 前提の更新

- ヘッダー行（`From:`/`差出人:`）は「あれば優先して使う」候補源の一つに格下げし、
  必須の前提ではなくなった。本文中に署名ブロック（罫線区切り＋会社名キーワード＋
  メールアドレス）が含まれていれば、転送方式に関わらず顧客特定できる
- 本文中に複数の署名ブロックが存在する場合（例: 転送元の担当者の署名＋実際の顧客の署名）は、
  従来のヘッダー候補と同様「最後に出現したメールアドレス」を採用する。これは実例
  （社内担当者宛の文面が先頭、顧客の署名ブロックが末尾）で正しく動作することを確認済みだが、
  本文の構成によっては先頭のブロックが実際の顧客になるケースもありうるため、
  誤マッチ時に手動修正できる下書き運用（本ドキュメント本体の仕組み）に引き続き依存する

### 受け入れ条件

- [x] `From:`/`差出人:` ヘッダー行が本文中に存在しない「直接転送」形式のメールでも、
      署名ブロックから顧客名（会社名）を抽出できること
- [x] 既存のヘッダーあり転送メールの挙動（Issue #265）が変わらないこと
- [x] 既存のテストをパスし、新規ロジックのユニットテストを追加すること
      (`__tests__/unit/services/test_customer_matching_service.py`,
      `__tests__/unit/services/test_gmail_service.py`)
- [x] 型・Lint エラーが出ていないこと

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
- （#385）束ね添付メールのPDF単位の顧客解決では、**既存顧客への企業名突合のみ**行い、
  下書き顧客の新規作成はしない（作成は従来どおり `_process_message` でメール単位に1回）。
  一意に解決できないPDFはメール単位で解決済みの `customer_id`（「不明な顧客」下書きを
  含む）にフォールバックする＝ #263 の挙動を踏襲する。`customer_draft_created` 通知も
  メール単位で1回のまま（添付単位では出さない）

---

## 関連

- [email-order-intake.md](email-order-intake.md): メール起票の基盤設計、`customer_matching_service.py` の位置づけ
- [notifications.md](notifications.md): `notifications` テーブル・`create_notification` の共通設計
- Issue #262: `customer_id=NULL` によるbigint型エラー（本Issueで新規発生分はほぼ解消見込み）
- Issue #259, #168: 関連Issue
- Issue #265: 転送メールの顧客メールアドレス/顧客名抽出が正しく行われない不具合の修正
- Issue #298: 直接転送メールでヘッダー行が本文化されず顧客特定に失敗する不具合の修正
- Issue #311: 転送を介さず顧客から直接届くメールで、実際の Gmail `From` ヘッダーを
  最優先の突合シグナルとして使うようにした改善（[customer-matching-real-from-priority.md](customer-matching-real-from-priority.md)）
- Issue #385: 束ね添付メールで、パース時にPDF文面の企業名から `customers` を突合し
  添付ごとに `customer_id` を再解決する（`match_customer_by_pdf_text`。
  詳細は [pdf-order-parsing.md](pdf-order-parsing.md#束ね添付での-pdf-単位の顧客解決issue-385)）
