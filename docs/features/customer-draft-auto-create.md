# 顧客が特定できないメール/PDF起票での下書き顧客自動作成（Issue #263）

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

---

## スコープ外（このIssueではやらない）

- `_mark_superseded_orders` の NULL customer_id ハンドリング自体のバグ修正（#262 で対応予定）
- 下書き顧客専用の「確定」ボタンや一括確定UI
- 顧客詳細ページの新設（現状は一覧ページの編集ダイアログのみ）

---

## 関連

- [email-order-intake.md](email-order-intake.md): メール起票の基盤設計、`customer_matching_service.py` の位置づけ
- [notifications.md](notifications.md): `notifications` テーブル・`create_notification` の共通設計
- Issue #262: `customer_id=NULL` によるbigint型エラー（本Issueで新規発生分はほぼ解消見込み）
- Issue #259, #168: 関連Issue
