# 修理注文（受注種別 `order_type`）（Issue #493 / #494）

生産ではなく**修理**（例: 顧客から預かった部品のはんだ補修）の注文書が届くことがある（月1回未満）。
修理は図番・品名が規格化されておらず、製品マスタ・工程ルートに当てはめられない。

受注（`orders`）に種別 `order_type`（`production` / `repair`）を足し、修理を同じテーブルで扱う。
顧客・ステータス遷移・承認・通知・着手日の自動遷移 cron は生産と共通の仕組みを使い、別テーブルで
二重に作らない。修理専用のステータスや、内訳を表で持つ構造は作らず、運用しながら直す前提で最小限にしている。

この文書はバックエンド（DB・取り込み・承認フロー）と、画面（一覧・詳細・起票・ダッシュボード、Issue #494）を扱う。

---

## 「修理」に含める注文の範囲

運用では修理のほかに**メンテナンス・洗浄**などの注文も届く。どれも製品の生産ではなく、製品・工程・設備を持たない
作業依頼なので、新しい種別は足さず `order_type = 'repair'` にまとめる（DB の値・API は変えない）。
画面では「修理」ではなく**「修理等」**と呼ぶ（`ORDER_TYPE_LABELS`）。PDF 取り込みの種別判定も、件名・品名に
「メンテナンス」「洗浄」などが書かれた注文を `repair` とするようプロンプトに加えた。種別ごとに扱いを変える必要が
出たら `order_type` の値を増やす（CHECK を張り直す）。

## 前提

- **設備は使わない**。修理は `production_schedules` に行を作らず、ガントチャート・スケジューラの対象外
- **社長承認は必要**。ステータス遷移は生産と同じ（`draft` → `pending_approval` → `confirmed` → `in_progress`
  → `shipped` → `completed`）で、`ORDER_STATUS_TRANSITIONS` は変えていない
- 注文書1枚 = 修理注文1件。明細（例:「補修部1〜3ヶ所 ×11枚」「補修部4〜6ヶ所 ×1枚」）は件名とあわせて
  `work_description` にテキストで入れる

## データモデル

マイグレーション: `supabase/migrations/20261015000000_add_order_type_repair.sql`

| 列・制約 | 内容 |
|---|---|
| `orders.order_type` | `text NOT NULL DEFAULT 'production'`、CHECK で `production` / `repair`。あとで値を増やしやすいよう enum 型にしない。**作成後は変更しない**（`OrderUpdate` に持たせない） |
| `orders.work_description` | 件名・作業内容のフリーテキスト |
| CHECK `orders_repair_without_product` | `order_type = 'production' OR product_id IS NULL`（修理は製品を持たない） |
| 部分 UNIQUE `orders_repair_customer_order_no_key` | `(tenant_id, customer_id, customer_order_no) WHERE order_type = 'repair' AND customer_order_no IS NOT NULL`。同じ注文書の再受信で重複起票しない |

修理での列の使い方:

| 意味 | 列 | 入力者 |
|---|---|---|
| 納期 | `deadline_date` | PDF から取り込み（明細の納期のうち最も早い日） |
| 実施開始日 | `scheduling_start_date`（`scheduling_start_date_auto = false`） | 受注担当者 |
| 承認前の完了予定日 | `simulated_deadline` | 受注担当者 |
| 確定した完了予定日 | `confirmed_deadline` | 承認時に `simulated_deadline` をコピー |
| 数量・製品 | `quantity` / `product_id` / `extracted_product_name` | NULL（使わない） |

- `extracted_product_name` が NULL なので、製品が照合できなかった受注用の部分 UNIQUE
  `orders_dedupe_key_unmatched_product` の対象にならない。`orders_dedupe_key` も `product_id` が NULL なので当たらない
- 顧客不明（`customer_id` NULL、[internal-senders.md](internal-senders.md)）の修理は UNIQUE が効かない
  （NULL 同士は一致しない）。顧客不明の受注を重複させない既存の方針と同じ

## PDF からの取り込み

### 抽出（`services/pdf_order_extraction_service.py`）

抽出スキーマ `_EXTRACT_SCHEMA`（画像PDF用の `_IMAGE_EXTRACT_SCHEMA` も同じものをコピーして使う）に、
文書レベルの `order_type`（`production` / `repair`）と `subject`（件名）を足した。判定は LLM に任せ、
「件名・品名に修理・補修などの作業依頼が書かれ、製品の生産ではない注文」を `repair` とする旨を
スキーマの説明とプロンプト（`_ORDER_TYPE_INSTRUCTION`）に書いている。

`_normalize_result()` は `order_type` が `"repair"` 以外（想定外の値・未指定）なら `production` にする
（従来どおりの挙動）。

メール本文からの抽出（`email_extraction_service`、`_process_email_body()`）には判定を入れていない。
修理の注文書は PDF（FAX を含む）で届く前提のため。本文で届くようになったら同じ項目を足す。

### 起票（`services/pdf_order_parsing_service.py`）

テキストPDF・画像PDFとも、抽出結果が修理（`_is_repair_extraction()`）なら、明細ごとの起票
（`_process_line_item()` → `upsert_order_by_dedupe_key`）を通さず `_process_repair_order()` で下書きを1件作る。

- `work_description`: `repair_order_service.build_repair_work_description()` で件名＋「・品名 ×数量」の箇条書き
- `customer_order_no`: 既存と同じく `document_order_no`（無ければ文書内容から決定的に採番した `AUTO-…`）
- `customer_certainty`: 明細の確度が1種類に揃っていればその値、揃わない・判定できなければ NULL（Issue #474 の規約）
- `deadline_date`: 明細の納期のうち最も早い日（日付として読めない値は無視）
- 実施開始日・完了予定日は入れない（受注担当者が入力する）。製品の照合・内示の無効化・自動シミュは行わない
- 起票した受注の添付行（`order_attachments`）はテキストPDFなら `success`、画像PDFなら `success_image`。
  画像PDFは生産と同じく `image_extracted` のログを残す
- 部分 UNIQUE に当たった（同じ注文書の再受信）ら、既存の注文を上書きせずスキップし、
  `order_parse_log` に `repair_duplicate_skipped` を残す（受信受注メール一覧ではスキップ扱い）。
  23505 でも別の制約名なら、それ以外の DB エラーと同じく送出する

件名も明細も取れていない場合は作業内容を組み立てられないので、修理と判定されても従来の経路
（テキストPDFは本文へのフォールバック、画像PDFは読み取り不能の空の下書き）に回す。

`upsert_order_by_dedupe_key` は修理では使っていない（RPC は変更していない）。

## 承認フロー・更新処理

`services/repair_order_service.py` に修理の判定・日付の検証・作業内容の組み立てを純粋関数でまとめ、
ルーターと取り込みの両方から使う。

| 操作 | 修理での扱い |
|---|---|
| 起票 `POST /orders` | `order_type: "repair"` と `work_description` / `scheduling_start_date` / `simulated_deadline` を受け付け、製品・数量なしで作成できる（FAX 等で届いた修理を手で登録するため）。`product_id` / `quantity` を送ると 422 `repair_order_product_not_allowed` |
| 更新 `PATCH /orders/{id}` | `work_description` / `scheduling_start_date` / `simulated_deadline` を編集できる。実施開始日を変えても完了予定日はクリアしない。`product_id` / `quantity` を送ると 422 `repair_order_product_not_allowed` |
| 承認依頼 `POST /orders/{id}/request-approval` | `product_id` の有無ではなく、実施開始日と完了予定日が入っていることを条件にする。足りなければ 422 `repair_dates_missing` |
| 承認 `POST /orders/{id}/confirm`・`/approve-bulk` | `schedule_order()` と作業開始日の繰り上げをスキップし、`simulated_deadline` を `confirmed_deadline` にコピーして `confirmed` にする（`production_schedules` は作らない）。レスポンスの `schedules` は空配列。日付が欠けていれば 422 `repair_dates_missing` |
| シミュ `POST /orders/{id}/simulate` | 422 `repair_order_not_simulatable`。cron の `auto_simulate_intake_order()` もスキップする |
| 分割 `POST /orders/{id}/split` | 400（注文書1枚 = 1件のため） |
| 着手日の自動遷移 cron `GET /api/cron/advance-order-status` | 変更なし。`scheduling_start_date` を見るので修理にも効く |

日付の検証（起票・更新共通）:

- `simulated_deadline` が日付として読めなければ 422 `invalid_simulated_deadline`
- `simulated_deadline < scheduling_start_date` なら 422 `repair_dates_out_of_order`（同日は可）。
  更新では送られなかった方の値を既存の受注から補って比べる
- `scheduling_start_date` は生産と同じ検証（形式・過去日の権限、Issue #372）。手入力なので
  `scheduling_start_date_auto` は false（既存の PATCH の規則どおり）

生産の受注で `simulated_deadline` を送ると、起票・更新とも 422 `simulated_deadline_not_editable`
（シミュ納期はシミュレーションでしか書き込まない）。

### `is_scheduled` の扱い

一覧の「シミュ済」バッジ・「起票の確認」の区分・承認依頼ボタンは `status='draft' かつ is_scheduled` で判定している
（`order-utils.ts`。draft では `is_scheduled` と `simulated_deadline != null` が実質同値という前提）。
修理では、**実施開始日と完了予定日が両方入ったら `is_scheduled = true`**、どちらかが空になったら false にする
（起票・更新のたびに日付の有無に合わせる）。これで修理も「日付が入った = 承認依頼できる」状態が
シミュ済みと同じ見え方になり、既存の前提も崩れない。承認時は生産と同じく true を書く。

### 工程フラグ

`OrderRepository.get_all_with_routing_status()` / `get_by_id_with_routing_status()` は、修理の
`has_no_routings` / `has_unconfirmed_routings` を常に false にする（「工程未入力・起票不可」として扱わない）。

### 重複（409）

`PATCH` で顧客を変えて修理の部分 UNIQUE に当たった場合は、`_duplicate_order_conflict_exception()` が
409 `{"error": "duplicate_repair_order", "message": ...}` を返す（衝突先の検索は製品・納期キー用なので行わない）。

## テスト

- `__tests__/unit/services/test_repair_order_service.py`: 日付の検証・作業内容の組み立て
- `__tests__/unit/services/test_pdf_order_parsing_service.py::TestRepairOrderIntake`: 修理の起票・重複スキップ・画像PDF
- `__tests__/unit/services/test_pdf_order_extraction_service.py::TestOrderTypeExtraction`: 種別の抽出と既定値
- `__tests__/api/routers/transaction/test_repair_orders.py`: 起票・更新・承認依頼・承認・シミュ・分割
- `__tests__/unit/services/test_order_auto_transition_service.py`: 修理（スケジュール無し）の着手日での `in_progress` 遷移

## 画面（Issue #494）

DB・API は変えず、フロントエンドだけで生産と分けて表示・操作する。修理等かどうかの判定は `isRepairOrder()`（`lib/order-utils.ts`）。

| 画面 | 修理等の扱い |
|---|---|
| すべての注文 `/orders` | 「生産／修理等」の切り替え（`?type=production\|repair`、未指定は生産）。未知の値は `toValidOrderTypeFilter()` で生産にクランプする。ステータスタブ・顧客の絞り込みは選んだ種別の中で効く（製品の絞り込みは生産だけ）。修理等の列は顧客・件名・納期・実施開始日・完了予定日・ステータス（`repair-order-table.tsx`）。`STATUS_TABS` に修理用のタブは足さない |
| 注文詳細 `/orders/{id}` | 修理等は別コンポーネント `RepairOrderDetail`（製品・数量・工程・シミュレーション・スケジュールを出さない）。件名・作業内容、注文番号、顧客、納期、実施開始日、完了予定日、元の PDF を表示する。実施開始日と完了予定日が揃うまで「承認依頼を送信」を押せず、理由を表示する（`getRepairApprovalBlockReason()`）。社長の承認・差し戻しは生産と同じ操作で、承認後は確定した完了予定日を表示する |
| 編集 | `RepairOrderEditDialog`（件名・作業内容、注文番号、顧客、納期、実施開始日、完了予定日）。空欄にした項目は `null` で送る。一覧・承認画面などの編集ボタンも修理等ならこのダイアログを開く |
| 新規注文 `/orders/new` | 上部の「生産／修理等」で切り替え。修理等は製品・数量・シミュレーションの代わりに `RepairOrderCreateForm`（件名・作業内容を必須）で下書きを作り、詳細へ移動する |
| 起票の確認・承認・送品の消し込み | 製品名の代わりに件名を出し、「修理等」バッジを付ける。起票の確認ではシミュレーションの代わりに「日付を入力」（詳細へ）を出す。一括シミュレーションは修理等をスキップする |
| ダッシュボード | 承認待ちキュー・納期リスク・最新の注文は件名と「修理等」バッジを表示する。納期の集計には修理等も含まれる。ガントは変更なし（`production_schedules` が無いので出ない） |

製品名を出す箇所は `getOrderProductName(order, products)` / `getOrderProductDisplayParts(order, products)` を使う
（修理等は件名、生産は従来の製品名）。`getProductName()` に `order.product_id` を直接渡すと、修理等が「不明」と表示される。

エラーは `lib/repair-order.ts` の `getRepairOrderErrorMessage()` で `errorCode` を既知の値と照合して固定文言にする
（`detail` は外部入力なので、サーバーの文言をそのまま出さない）。

現場向けの操作手順は Wiki に分離する: 「修理等の注文の登録と承認」（Wiki 側に追加後、ここにリンクを記載する）。

テスト: `lib/order-utils.test.ts`（クランプ・件名・承認依頼の可否）、`components/orders/repair-order-detail.test.tsx`、
`components/orders/orders-filter-bar.test.tsx`、`app/orders/new/page.test.tsx`。
