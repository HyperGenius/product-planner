# 受注PDF自動パース＋複数order生成（顧客側確度対応）

[order-attachments.md](order-attachments.md) の PDF ステージング基盤（Issue #248）を前提に、
ステージングされた PDF を実際にパースし、1ファイルに含まれる複数品番・複数納期の明細を、
複数 `orders` 行として自動生成する（Issue #249）。
さらに、同一dedupeキーの既存orderが見つかった場合は数量更新を行う
upsert処理に対応する（Issue #252）。

PDF文面から抽出した確度（確定/内示/内々示）は `orders.customer_certainty` に「顧客側の
参考情報」として保存し、ProductPlanner側のワークフローステータス（`orders.status`）とは
独立に扱う。`status` は常に `draft` で作成され、`confirmed` への遷移はユーザーの確定操作
（`POST /orders/{id}/confirm`）でのみ発生する（Issue #267、詳細後述）。

---

## 背景と目的

受注PDFは「7月確定 / 8月内示 / 9月内々示」のように確度の異なる複数明細を含み、毎月更新される。
Issue #248 により PDF添付メールは `order_attachments` に `order_id=NULL` のステージング行として
保存されるようになったが、そこから実際の注文レコードを生成する処理は未実装だった。
本Issueでこのパース処理を実装し、1PDFから複数の実注文レコードを正しく起票できるようにする。

なお、当初（Issue #249/#252）は certainty をそのまま `orders.status` にマッピングしており、
確定納期・PO番号が明記された明細（certainty='confirmed'）はユーザーの確認・確定操作なしに
`status='confirmed'` として起票されてしまっていた。これは「メール/PDF転送起票は常に
draftとし、ユーザーの確定操作でのみ確定させたい」という運用意図に反するバグであり、
Issue #267 で `customer_certainty` カラムを新設して是正した。

---

## 処理フロー

新規cronエンドポイント `GET /api/cron/parse-order-pdfs`（既存 `gmail-poll` と同じBearer認証
パターン、`backend/app/routers/cron/_auth.py` の `validate_cron_secret()` を共通利用）が
`pdf_order_parsing_service.parse_pending_order_pdfs()` を呼び出す。

```
1. order_attachments WHERE parse_status='pending' AND order_id IS NULL をポーリング
2. Storage から PDF をダウンロードし、pdfplumber でテキスト抽出 (pdf_text_service.py)
   - パスワード保護 (PPAP等) で開けない → parse_status='failed_encrypted'、orderは生成しない
   - テキストが1文字も取れない (画像PDF等) → parse_status='failed_image'、orderは生成しない
3. 抽出成功時、Claude tool-use (pdf_order_extraction_service.py) で明細行の配列を取得
   { product_name_raw, product_number_raw, quantity, delivery_date, certainty }
4. 明細ごとに (pdf_order_parsing_service._process_line_item):
   a. 製品照合は3段階のフォールバックで行う:
      1. `products.code` の完全一致 (match_product_by_code)
      2. `products.name` に対する品番文字列 (product_number_raw) でのpg_trgm検索
         （`code` 列が未整備で、`name` 列に品番文字列が入っているテナントに対応）
      3. `products.name` に対する品名文字列 (product_name_raw) でのpg_trgm検索
      - `match_products` の自動確定条件は「候補が1件だけ」ではなく、
        「最上位候補のスコアが `PRODUCT_MATCH_AUTO_CONFIRM_THRESHOLD` 以上、かつ
        次点候補とのスコア差が `PRODUCT_MATCH_AUTO_CONFIRM_MARGIN` 以上」。
        品番は1文字違いで別製品を指すことがあり（例: `25760-63C-...` と
        実在する `22760-63C-...` は pg_trgm 上高い類似度になる）、
        「候補1件のみ」は自動確定の根拠として弱いため
   b. すべて失敗した場合: order を生成せず order_parse_log に reason='no_product_match' で記録
   c. certainty はそのまま orders.customer_certainty に保存する（confirmed/forecast/
      forecast_tentative）。orders.status には反映しない（Issue #267）
   d. customer_id はステージング行のものをそのまま使用（再照合しない）
   e. SQL RPC upsert_order_by_dedupe_key で orders に INSERT/UPDATE。INSERT時は
      customer_certainty の値に関わらず常に status='draft' で作成する。
      (tenant_id, customer_id, product_id, deadline_date) の重複時は既存orderの
      customer_certainty昇格・数量更新を試み、`action` (inserted/updated/skipped_downgrade/
      skipped_no_change/skipped_draft_conflict) に応じて分岐する（Issue #252/#267、詳細後述）
   f. `inserted`/`updated` の場合、対応する order_attachments 行を追加INSERT
      (order_id 設定済み、storage_path はステージング行と同一、parse_status='success')
      → 既存の `/orders/{order_id}/attachments` エンドポイント・UIがそのまま流用できる
   g. `inserted` の場合のみ、同一 (tenant_id, customer_id, product_id) で異なる
      deadline_date を持つ未来日付の forecast/forecast_tentative レコードに
      `superseded_at = now()` をセットする（`_mark_superseded_orders`、Issue #252）
5. 処理後、ステージング行自体の parse_status を更新する
   (テキスト抽出・Claude抽出が完走すれば、生成された order 数によらず 'success' とする。
   0件生成となるケース＝全明細が重複/照合失敗＝も、パース処理自体は正常に完了しているため。
   個々の失敗理由は order_parse_log 側で追跡する)
```

### メール本文からの複数明細抽出への統一（Issue #280）

「1メール = 1受注」前提が崩れているケース（1通に部品番号ごとの複数月分の内示数量が
表形式で含まれる等）が報告され（Issue #280）、メール本文からの抽出も PDF と同じ
`line_items` 配列形式に統一した。

- `email_extraction_service.extract_email_order_lines(body)` が
  `product_name_raw`/`product_number_raw`/`quantity`/`delivery_date`/`certainty` を
  持つ明細の配列を返す（`pdf_order_extraction_service.extract_order_lines()` と
  同じスキーマ・`EMAIL_EXTRACTION_MODEL` を使用）。単一スカラー値のみ返す旧
  `extract_email_fields()` は廃止した
- `pdf_order_parsing_service._process_email_body()`（旧 `_fallback_to_body_extraction`）が
  この配列を明細ごとに既存の `_process_line_item()` に渡すため、1通のメールから
  複数の `orders` 行を正しく生成できる。製品照合・`upsert_order_by_dedupe_key` による
  dedupe・`order_attachments` 紐付けは PDF由来の明細処理と完全に同じ経路を通る
- 明細が1件も抽出できなかった場合は、従来通り order を作成せず `non_order_email` として
  `create_notification` のみ行う

`_process_email_body()` は以下の2つのケースで呼ばれる共通経路になっている:

1. PDFに明細が1件も無かった場合のフォールバック（Issue #278）
2. 非PDF添付・添付なしメールの本処理（Issue #280、後述）

### 非PDF添付・添付なしメールの本処理への統一（Issue #280）

従来、非PDF添付・添付なしメールは `gmail_service.py` 内で単一フィールド抽出→即座に
`orders` を1件直接INSERTする独立した経路を持っていた（PDF添付メールのみ
`order_attachments` へのステージング保存＋非同期パースだった）。この経路は
「1メール1受注」前提のままで Issue #280 の対象外だったため、PDF添付メールと同じ
ステージング＋非同期パース経路に統一した。

- `gmail_service._process_message()` は PDF・非PDF添付・添付なしのいずれであっても、
  顧客解決後に `order_attachments` へ `order_id=NULL` のステージング行を1件INSERTする
  だけになった（添付が無い場合は `storage_path=""`）。`orders` への直接INSERTは行わない
- `pdf_order_parsing_service._parse_one()` はステージング行の `content_type` が
  `application/pdf` かつ `storage_path` がある場合のみPDFテキスト抽出を行い、それ以外
  （非PDF添付・添付なし）は `_process_email_body()` へ直接ルーティングする
- 添付ファイル本体が無いソースから生成された `orders` の `order_attachments` 行は、
  フロントエンドの表示分岐（`parse_status === 'failed_no_attachment'`）と合わせるため
  `parse_status='failed_no_attachment'` で作成する（`storage_path` が空か否かで判定）
- これにより添付ファイルは常に「1ソースにつき1回」だけ Storage に保存される
  （非PDF添付を複数明細に分割してもファイル本体は複製しない）

### 受注ソースの「1ソース:N受注」モデル（Issue #280）

`orders.source_attachment_id`（`order_attachments.id` への nullable FK）を追加し、
1つの `order_attachments` ステージング行（1ソース）に対してN件の `orders` を
紐づけられるようにした。

- `upsert_order_by_dedupe_key` RPC に `p_source_attachment_id` パラメータを追加し、
  新規INSERT時にのみ設定する（既存行のUPDATE時は最初に作成したソースを保ったまま
  変更しない）
- 既存データは以下の方針でバックフィル済み（`20260706000000_add_orders_source_attachment_id.sql`）:
  - PDF由来: ステージング行（`order_id IS NULL`）と、そこから生成された各 `orders` に
    紐づく `order_attachments` 行（`storage_path` を複製したもの）を対応付けて設定
  - 非PDF添付・添付なしメール由来: 専用のステージング行が存在しないため、その
    `orders` に紐づく `order_attachments` 行自身を自己参照的な「ソース」として設定
- 手動分割UI（誤って1件にマージされた下書きから同じ `source_attachment_id` を
  参照するN件の下書きを生成する機能）は `POST /orders/{order_id}/split` として実装済み。
  詳細は本ファイル末尾の「手動分割UI（Issue #280 Phase3）」を参照

### 複数受注の疑いの検知（Issue #280）

`line_items` 配列形式への統一により「1通のメールに複数月分の数量が含まれる」
ケースの多くは正しく複数明細として抽出されるようになったが、それでも1明細に
複数月分がマージされてしまうケースに備え、粗いヒューリスティックによる検知を
`_process_line_item()` に追加した。

- 1明細の `quantity` が `MULTI_ORDER_SUSPECTED_QUANTITY_THRESHOLD`（デフォルト
  100,000）を超える場合、`order_parse_log` に `reason='multi_order_suspected'` で
  記録し、`notifications` に `notif_type='multi_order_suspected'` で通知する
- あくまで情報提供目的の通知であり、order自体の作成はブロックしない
- 閾値・条件は本番データの精度を見ながら調整する前提（Issue #280 未解決の論点）

また、`quantity` が本来のツールスキーマ（`int | null`）から外れた想定外の型で
返ってきた場合（スキーマ変更・抽出結果の崩れ等への防御）は、不整合な `orders`
行を作らないよう `reason='invalid_quantity'` で `order_parse_log` に記録した上で
その明細をスキップする（PRレビュー指摘対応）。

### なぜ postgrest-py の `on_conflict` を使わないか

supabase-py（postgrest-py）の `.insert(..., on_conflict=...)` は単純なマージ用であり、
「顧客側の確度は昇格のみ許可・数量は差分があれば更新・ユーザーが確定/完了/キャンセルした
注文や手動下書きは対象外」といった条件付きロジックは表現できない。そのため SQL RPC 関数
`upsert_order_by_dedupe_key`（`orders%ROWTYPE` を `FOR UPDATE` で取得し、優先順位判定して
INSERT/UPDATEを分岐）を実装し、`action` で結果を返している。

### 既存orderのupsert処理（Issue #252、Issue #267で customer_certainty 対応）

`upsert_order_by_dedupe_key` は `(tenant_id, customer_id, product_id, deadline_date)` の
dedupeキーに一致する既存orderが見つかった場合、以下のルールで判定する。

- **INSERT時は customer_certainty の値に関わらず常に `status='draft'` で作成する**。
  `status='confirmed'` へはユーザーの確定操作（`POST /orders/{id}/confirm`）でのみ遷移する
- 既存orderの `status` が `confirmed`/`completed`/`canceled`（ユーザーが確定・完了させた、
  またはキャンセルした注文）の場合は常に `skipped_downgrade`。PDF自動処理からは一切
  変更しない
- 既存orderの `status='draft'` かつ `source_type='manual'`（手動下書き）の場合は
  優先順位判定に入れず、常に `skipped_draft_conflict` としてコンフリクト記録のみ行う
  （PDF自動処理で意図せず上書きされないようにするため）
- それ以外（`status='draft'` かつ `source_type != 'manual'` = メール/PDF起票の確認待ち
  draft）の場合のみ、`customer_certainty` の優先順位（数値が大きいほど確度が高い）で
  判定する: `forecast_tentative(0) < forecast(1) < confirmed(2)`。
  既存 > 新規（格下げ）の場合は更新しない（`skipped_downgrade`）
- 優先順位が同じかつ数量も一致する場合は完全重複とみなし `skipped_no_change`
  （この場合のみ `order_parse_log` への記録なし）
- それ以外（昇格 or 同確度での数量差分）は `customer_certainty`/`quantity`/`source_*`/
  `extracted_product_name` を更新し `updated` を返す（**`status` は `draft` のまま
  変更しない**）

`_process_line_item` は `action` に応じて分岐する:

| action                    | order_attachments追加 | order_parse_log |
|---------------------------|:---:|---|
| `inserted`                | ○ | なし |
| `updated`                 | ○ | なし |
| `skipped_downgrade`       | - | `reason='downgrade_skipped'` |
| `skipped_draft_conflict`  | - | `reason='draft_conflict_skipped'` |
| `skipped_no_change`       | - | なし |

`deadline_date` はdedupeキーの一部のため、内示の納期が翌月にずれるようなケースは
既存の仕組みでは別レコードとして新規INSERTされる（旧レコードは残り続ける）。これは
現時点で正式な引き継ぎ機能としては対応しないが、旧 `forecast`/`forecast_tentative`
レコード（`status='draft'` かつ `customer_certainty IN ('forecast', 'forecast_tentative')`
のもの）が一覧に溜まり続けないよう、`inserted` の都度 `_mark_superseded_orders` で
同一 `(tenant_id, customer_id, product_id)` の異なる未来日付レコードに
`superseded_at = now()` をセットし、注文一覧 (`OrderRepository.get_all`) から除外する。
ユーザーが確定済み（`status='confirmed'`）の注文はこのフィルタ対象外のため supersede
されない。

---

## DB スキーマ変更

`supabase/migrations/20260702000000_add_order_status_forecast.sql`（Issue #249）:

- `orders.status` の CHECK制約を DROP + 再作成し、`forecast` / `forecast_tentative` を追加
  （text CHECK制約のため `ALTER TYPE ADD VALUE` は使えない）
- 新規 UNIQUE 制約 `orders_dedupe_key`: `(tenant_id, customer_id, product_id, deadline_date)`
  - 既知の制約: `product_id` または `customer_id` が `NULL` の行は NULL の非等価性により
    デデュープキーとして機能しない。パース処理側は `product_id` が確定した場合のみ
    このUNIQUE制約に依拠したINSERTを行うことで運用上回避している
- 新規テーブル `order_parse_log`: `id, tenant_id, order_attachment_id (FK), reason, detail (jsonb), created_at`
  - `reason`: `no_product_match` / `downgrade_skipped` / `draft_conflict_skipped`
    （Issue #249時点の `duplicate_skipped` は Issue #252 で上記2種に置き換え）

`supabase/migrations/20260702000001_add_order_upsert_by_dedupe_key.sql`（Issue #252）:

- `orders.superseded_at timestamptz`（nullable）を追加
- `create_order_skip_duplicate` を削除し、`upsert_order_by_dedupe_key` を新設
  （唯一の呼び出し元 `pdf_order_parsing_service._process_line_item` を置き換え）

`supabase/migrations/20260705000000_separate_customer_certainty_from_status.sql`（Issue #267）:

- `orders.customer_certainty text`（nullable）を追加
- `orders.status` の CHECK制約を元の4値（`draft`/`confirmed`/`completed`/`canceled`）に戻し、
  `forecast`/`forecast_tentative` を除外
- 既存データ移行: `status IN ('forecast', 'forecast_tentative')` だった行は
  `customer_certainty` に値を退避し `status='draft'` に。`status='confirmed' AND
  confirmed_at IS NULL`（ユーザーが一度も確定操作をしていないのに本バグで確定済みに
  されていた行）も `customer_certainty='confirmed'`, `status='draft'` に是正
- `upsert_order_by_dedupe_key` の `p_status` パラメータを `p_customer_certainty` に置き換え

### `orders.status` の全定義（ProductPlanner側のワークフローステータス）

| 値          | 意味                 |
|--------------|----------------------|
| `draft`      | 下書き               |
| `confirmed`  | 確定/スケジュール済（`/orders/{id}/confirm` でのみ遷移） |
| `completed`  | 完了                 |
| `canceled`   | キャンセル           |

### `orders.customer_certainty` の全定義（顧客側の確度、参考情報）

| 値                    | 意味                       |
|------------------------|----------------------------|
| `null`                 | 手動起票（確度情報なし）     |
| `confirmed`            | 確定納期・PO番号明記        |
| `forecast`             | 内示                        |
| `forecast_tentative`   | 内々示                      |

`orders.status` とは独立しており、`customer_certainty` の値が `confirmed` であっても
`status` は自動では `confirmed` にならない（Issue #267）。

---

## 新規ファイル

### Backend

- `supabase/migrations/20260702000000_add_order_status_forecast.sql`
- `backend/app/services/pdf_text_service.py`
  - `extract_text(content: bytes) -> PdfTextResult`
- `backend/app/services/pdf_order_extraction_service.py`
  - `extract_order_lines(pdf_text: str) -> list[dict]`（Claude tool-use、`PDF_EXTRACTION_MODEL`）
- `backend/app/services/pdf_order_parsing_service.py`
  - `parse_pending_order_pdfs(db) -> dict[str, int]`
- `backend/app/routers/cron/_auth.py`
  - `validate_cron_secret(request)`（`gmail_poll.py` と共通化）
- `backend/app/routers/cron/parse_order_pdfs.py`
  - `GET /api/cron/parse-order-pdfs`

### 既存ファイルへの追加

- `backend/app/services/product_matching_service.py`: `match_product_by_code()` を追加
- `backend/app/services/attachment_service.py`: `download_attachment()` を追加
- `backend/app/repositories/supa_infra/common/table_name.py`: `ORDER_PARSE_LOG` を追加
- `backend/requirements.txt`: `pdfplumber==0.11.10`

Issue #252 での追加:

- `supabase/migrations/20260702000001_add_order_upsert_by_dedupe_key.sql`
- `backend/app/services/pdf_order_parsing_service.py`: `_process_line_item` の
  RPC呼び出しを `upsert_order_by_dedupe_key` に置き換え、`_mark_superseded_orders()` を追加
- `backend/app/repositories/supa_infra/transaction/order_repo.py`: `get_all()` を
  オーバーライドし `superseded_at IS NULL` でフィルタ

Issue #267 での変更（顧客側の確度とProductPlannerステータスの分離）:

- `supabase/migrations/20260705000000_separate_customer_certainty_from_status.sql`
- `backend/app/services/pdf_order_parsing_service.py`: `_CERTAINTY_TO_STATUS` を削除し、
  RPCへ渡すパラメータを `p_status` から `p_customer_certainty` に変更。
  `_mark_superseded_orders()` の絞り込み条件を `status='draft' AND customer_certainty IN
  (...)` に変更
- `frontend/src/types/order.ts` / `frontend/src/lib/order-utils.ts`: `customer_certainty`
  フィールド・表示用ラベル/バッジ関数を追加
- `frontend/src/components/orders/order-table-row.tsx` /
  `frontend/src/app/orders/[id]/page.tsx`: 顧客側の確度バッジを追加表示

Issue #280 での変更（1ソース:N受注モデル・メール本文/非PDF添付の複数明細対応）:

- `supabase/migrations/20260706000000_add_orders_source_attachment_id.sql`:
  `orders.source_attachment_id` 追加・既存データバックフィル・
  `upsert_order_by_dedupe_key` に `p_source_attachment_id` 追加・
  `notifications.notif_type` に `multi_order_suspected` 追加
- `backend/app/services/email_extraction_service.py`: `extract_email_fields()` を
  廃止し、`extract_email_order_lines()`（line_items配列形式）に置き換え
- `backend/app/services/pdf_order_parsing_service.py`: `_fallback_to_body_extraction`
  を `_process_email_body`（PDFフォールバックと非PDF添付・添付なしメールの共通経路）に
  一般化。`_parse_one` にPDF/非PDF分岐を追加。`_check_multi_order_suspected` を追加
- `backend/app/services/gmail_service.py`: 非PDF添付・添付なしメールの即時order作成
  経路を削除し、PDF添付と同じステージング保存のみに統一
- `backend/app/services/attachment_service.py`: 呼び出し元が無くなった
  `upload_attachment()` を削除
- `backend/app/routers/transaction/notifications.py`: `_PARSE_LOG_NOTIF_TYPES` に
  `multi_order_suspected` を追加
- `frontend/src/types/notification.ts` / `notification-bell.tsx`:
  `multi_order_suspected`（および従前抜けていた `customer_draft_created`）の
  型・表示ラベルを追加

---

## 環境変数

```
# Claude API
PDF_EXTRACTION_MODEL=claude-sonnet-5  # デフォルト。EMAIL_EXTRACTION_MODEL とは別軸で管理

# 製品マッチング (pg_trgm) の自動確定しきい値
PRODUCT_MATCH_AUTO_CONFIRM_THRESHOLD=0.75  # 最上位候補スコアの下限
PRODUCT_MATCH_AUTO_CONFIRM_MARGIN=0.15     # 次点候補とのスコア差の下限

# 複数受注疑いの検知（Issue #280、粗いヒューリスティック）
MULTI_ORDER_SUSPECTED_QUANTITY_THRESHOLD=100000  # 1明細の数量がこれを超えると通知
```

---

## 受け入れ条件

- [x] サンプルPDFから複数orderが正しく生成される（単体テストでモック検証に加え、
      `backend/__tests__/e2e/test_pdf_order_parsing_flow.py` で実PDF・実Claude API・
      実Supabaseを用いたe2e検証を実施）
- [x] `certainty` に応じて `orders.customer_certainty` が `confirmed`/`forecast`/`forecast_tentative`
      に正しくセットされる。`orders.status` は常に `draft` で作成される（Issue #267）
- [x] 品番・品名の照合失敗時はorderを生成せず、`order_parse_log` に記録される
- [x] 暗号化PDF・画像PDF（テキスト抽出不可）でもクラッシュせず `parse_status` が適切に更新される
- [x] 重複明細（UNIQUE制約抵触）はスキップされ `order_parse_log` に記録される
- [x] 生成された各orderから、対応する添付PDFが注文詳細画面からダウンロードできる
      （既存の `/orders/{order_id}/attachments` エンドポイントを変更なしで再利用）
- [x] マイグレーション（CHECK制約変更、UNIQUE制約、`order_parse_log`）が適用済み
- [x] 同一dedupeキーで `customer_certainty` が `forecast` → `confirmed` に更新されても
      `status` は `draft` のまま変化しない（Issue #252/#267）
- [x] 同一dedupeキーで数量のみ変わった場合、数量が更新される（Issue #252）
- [x] `status='confirmed'/'completed'/'canceled'` な既存orderへの明細は更新されず
      `downgrade_skipped` として記録される（Issue #252/#267）
- [x] `status='draft' AND source_type='manual'`（手動下書き）の既存orderへの明細は
      更新されず `draft_conflict_skipped` として記録される（Issue #252/#267）
- [x] 完全に値が一致する重複はログ記録なしでスキップされる（Issue #252）
- [x] `updated` の場合も `order_attachments` に新しいPDFの添付レコードが追加で紐付けられる（Issue #252）
- [x] `deadline_date` が変わった内示は新規orderとして生成され、旧レコードに `superseded_at` がセットされる（Issue #252）
- [x] `superseded_at` が設定されたorderは注文一覧APIのレスポンスに含まれない（Issue #252）
- [x] PDF文面上で確定納期・PO番号が明記された明細（certainty='confirmed'）でも、
      ユーザーが `/orders/{id}/confirm` を実行するまで `status` は `confirmed` に
      ならない（Issue #267）
- [x] `orders.source_attachment_id` により1ソース(order_attachments)につきN件の
      `orders` を紐づけられる。既存データはバックフィル済み（Issue #280）
- [x] メール本文フォールバック抽出・非PDF添付メール処理が `line_items` 配列形式で
      1メールから複数受注を抽出できる（Issue #280）
- [x] 自動抽出時に1明細の数量が閾値を超える場合、`multi_order_suspected` として
      通知される（Issue #280、粗いヒューリスティック）
- [x] 添付ファイルは1ソースにつき1回のみStorageに保存される（非PDF添付・添付なし
      メールもPDF添付と同じステージング経路に統一、Issue #280）
- [x] 手動分割UIにより、誤って1件にマージされた下書きから、同じ `source_attachment_id`
      を参照するN件の下書きを生成できる（Issue #280 Phase3）

### 手動分割UI（Issue #280 Phase3）

自動抽出でも1明細に複数受注がマージされてしまうケース（`multi_order_suspected` の
粗いヒューリスティックで検知しきれない場合を含む）に備え、ユーザーが手動で
下書き注文をN件に分割できるUIを実装した。

- `POST /orders/{order_id}/split`（`backend/app/routers/transaction/orders.py`）
  - リクエスト: `{"line_items": [{"product_id", "quantity", "desired_deadline",
    "customer_id"?, "customer_certainty"?, "extracted_product_name"?}, ...]}`
    （`line_items` は2件以上必須）
  - 分割対象の注文が `status='draft'` かつ `source_attachment_id` を持つ場合のみ許可
    （手動作成 (`source_type='manual'`) の注文や確定済み注文は分割不可、400）
  - 各明細ごとに新しい `orders` 行を作成し、`source_attachment_id` は元の注文と
    同じ値を設定する。`customer_id`/`customer_certainty` は明細で指定が無ければ
    元の注文の値を引き継ぐ
  - 元の注文が参照していたソース（`order_attachments` の `source_attachment_id`
    行）から `storage_path`/`original_filename`/`content_type`/`size_bytes` を
    取得し、新しい注文それぞれに対して `order_attachments` 行を1件ずつ複製する
    （`_process_line_item` と同じパターン。添付ファイル本体は複製しない）
  - **元の注文は新規INSERTより先に削除する**。分割後の明細が元の注文と同じ
    `(customer_id, product_id, deadline_date)` を指定するケース（内容はそのまま
    に品番だけ変えたい等）では、元の注文が残ったまま新規INSERTすると
    `orders_dedupe_key` が自分自身と衝突してしまうため。作成が一部失敗した場合は
    ロールバック（作成済み注文の削除 + 元の注文を同一内容で復元）した上で400を返す
  - `order_attachments` のRLSポリシーは元々 `auth.jwt()->>'tenant_id'` クレームを
    直接参照しており、`is_tenant_member(tenant_id)` を使う他の全テーブルと方式が
    異なっていたため、通常のユーザーJWTクライアントでは常にRLS違反になっていた
    （`GET /orders/{id}/attachments` は元々この問題を service role キーで回避して
    いた）。`supabase/migrations/20260710000000_fix_order_attachments_rls_tenant_member.sql`
    でポリシーを他テーブルと同じ `is_tenant_member(tenant_id)` に統一し、
    通常のユーザークライアントで読み書きできるようにした（service role キーは
    アプリコードで使わないという方針を維持するため、根本原因のポリシー自体を修正）
- フロントエンド: 注文詳細ページ (`/orders/[id]`) に「分割」ボタンを追加
  （`status='draft'` かつ `source_type='email'` かつ `source_attachment_id` あり
  の場合のみ表示）。`SplitOrderDialog`
  (`frontend/src/components/orders/split-order-dialog.tsx`) は左ペインに参照元
  メール（件名・顧客・本文・添付ファイル一覧）、右ペインに明細フォーム（2件以上）
  を表示する2ペインレイアウトで、分割単位を判断するのに必要な情報を見ながら
  入力できる。送信すると分割後の一覧ページに遷移する
- `useSplitOrder`（`frontend/src/hooks/use-orders.ts`）が上記APIを呼び出し、
  成功時に注文一覧のキャッシュを無効化する

---

## スコープ外

- PPAP（パスワード付きPDF）の自動復号
- 複数添付ファイルへの対応（1メール1添付の前提を維持）
- 重複スキップ・照合失敗の通知UI（[notifications.md](notifications.md) Issue #254 で対応）
- ステージング行が長時間 `pending` のまま停滞した場合のリトライ・タイムアウト処理
- `customer_certainty`（`forecast`/`forecast_tentative`）のUIフィルタータブ追加（別途検討）
- `deadline_date` 変更を「同一注文の引き継ぎ」として明示的にUI上で提示する機能（Issue #252スコープ外）
- `order_history`（変更履歴・監査ログ）テーブルの新設（Issue #252スコープ外）
- ステータスの手動格下げ操作、`superseded_at` レコードの物理削除・アーカイブ処理（Issue #252スコープ外）
- 手動分割UI（誤って1件にマージされた下書きから、同じ `source_attachment_id` を参照する
  N件の下書きを生成する機能）は後続Issueで対応（Issue #280スコープ外）
- 複数受注疑い検知の閾値・ヒューリスティックの精緻化（数量異常値以外の条件追加等）は
  本番データの精度を見ながら別途調整（Issue #280スコープ外）

---

## Integrationテスト（Issue #252）

`backend/__tests__/integration/test_order_upsert_by_dedupe_key.py`
（実行: `supabase start` の上で `pytest __tests__/integration/test_order_upsert_by_dedupe_key.py -v --run-integration`）。

`upsert_order_by_dedupe_key` の `customer_certainty` 優先順位判定・数量更新・
confirmed/completed/canceled/手動draftの上書き除外、および `_mark_superseded_orders`
のクエリチェーンは Claude API・Gmail APIの出力に依存しない決定的なDB/SQLロジックのため、
実PDF・実Claude APIを使うe2e tierではなく、ローカル Supabase のみで完結する
integration tier で検証する
（方針の詳細は `backend/__tests__/e2e/CLAUDE.md`, `backend/__tests__/integration/CLAUDE.md` を参照）。
テストごとに専用の tenant/customer/product を作成し、`upsert_order_by_dedupe_key` RPC を
直接呼び出して `action`（inserted/updated/skipped_downgrade/skipped_draft_conflict/
skipped_no_change）と実DB上の状態を検証したのち、テナントごと削除してteardownする。

---

## E2Eテスト

`backend/__tests__/e2e/test_pdf_order_parsing_flow.py`（実行: `pytest __tests__/e2e/ -v --run-e2e`）。

order-attachments バケットに事前アップロード済みの実PDF（飯野製作所フォーマット、複数品番・
複数納期・確度混在の注文一覧表）を対象に、`pdf_order_parsing_staging_row` フィクスチャ
（`conftest.py`）でステージング行をDBに直接INSERTしてから `parse_pending_order_pdfs()` を
実行し、実際の Supabase Storage・Claude API を使って以下を検証する:

- 配線・データフロー: ステージング行 → テキスト抽出 → Claude抽出 → 製品照合 → order生成 →
  order_attachments紐付け、という一連の処理が完走し `parse_status` が `success` になること
- 抽出精度: 実在する製品については正しい数量・妥当な納期でorderが生成され、実在しない製品
  （1文字違いの類似製品が製品マスタに存在するケース）は誤って別製品にマッチせず
  `no_product_match` としてスキップされること

テスト対象のPDF実体はfixtureとして使い回すため削除しない。生成された `orders` /
ステージング行 / `order_parse_log` はテストごとに `run_id` で識別してteardownで削除する。

### このテストで発見・修正した実装上の問題

1. **`match_products` の自動確定条件**: 「pg_trgm候補が1件だけなら自動確定」というロジックは、
   品番の1文字違いの別製品（デコイ）が唯一の候補としてヒットした場合に誤って自動確定して
   しまう。「最上位候補のスコアが一定以上、かつ次点候補との差が一定以上」の条件に変更した
   （`PRODUCT_MATCH_AUTO_CONFIRM_THRESHOLD` / `PRODUCT_MATCH_AUTO_CONFIRM_MARGIN`）。
2. **品番でのproducts.name検索フォールバックの欠落**: `products.code` が未整備で、`name` 列に
   品番文字列がそのまま登録されているテナントでは、旧ロジック（`product_name_raw` のみで
   フォールバック検索）では品番と品名が別々に抽出されるPDFの明細をほぼマッチできなかった。
   `product_number_raw` でも `products.name` をpg_trgm検索するフォールバックを追加した。
3. **`customer_matching_service.resolve_or_create_customer` の既存バグ**: 存在しない
   `customers.status` カラムへのINSERTを試みており、新規送信者からのメール受信時（本番の
   メール起票フロー含む）に顧客自動作成が失敗していた。存在しないカラムへの参照を削除した。

---

## 関連

- [order-attachments.md](order-attachments.md): PDFステージング保存基盤（Issue #248、前提）
- Issue #252: 既存orderのupsert処理（内示→確定の昇格・数量更新対応）。本ドキュメントに統合
- [notifications.md](notifications.md): 処理ログの通知UI（Issue #254、`order_parse_log` を利用）
