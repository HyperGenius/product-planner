# 受注PDF自動パース＋複数order生成（内示ステータス対応）

[order-attachments.md](order-attachments.md) の PDF ステージング基盤（Issue #248）を前提に、
ステージングされた PDF を実際にパースし、1ファイルに含まれる複数品番・複数納期の明細を、
確度別ステータス（確定/内示/内々示）付きの複数 `orders` 行として自動生成する（Issue #249）。

---

## 背景と目的

受注PDFは「7月確定 / 8月内示 / 9月内々示」のように確度の異なる複数明細を含み、毎月更新される。
Issue #248 により PDF添付メールは `order_attachments` に `order_id=NULL` のステージング行として
保存されるようになったが、そこから実際の注文レコードを生成する処理は未実装だった。
本Issueでこのパース処理を実装し、1PDFから複数の実注文レコードを正しく起票できるようにする。

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
   a. 品番 (product_number_raw) の完全一致 (match_product_by_code) → 見つからなければ
      品名のpg_trgm類似度検索 (match_products) にフォールバック
   b. どちらも失敗した場合: order を生成せず order_parse_log に reason='no_product_match' で記録
   c. certainty → orders.status へ1:1マッピング (confirmed/forecast/forecast_tentative)
   d. customer_id はステージング行のものをそのまま使用（再照合しない）
   e. SQL RPC create_order_skip_duplicate で orders に INSERT
      (tenant_id, customer_id, product_id, deadline_date) の重複時は ON CONFLICT DO NOTHING
      でスキップし、order_parse_log に reason='duplicate_skipped' で記録
   f. 生成できた場合、対応する order_attachments 行を追加INSERT
      (order_id 設定済み、storage_path はステージング行と同一、parse_status='success')
      → 既存の `/orders/{order_id}/attachments` エンドポイント・UIがそのまま流用できる
5. 処理後、ステージング行自体の parse_status を更新する
   (テキスト抽出・Claude抽出が完走すれば、生成された order 数によらず 'success' とする。
   0件生成となるケース＝全明細が重複/照合失敗＝も、パース処理自体は正常に完了しているため。
   個々の失敗理由は order_parse_log 側で追跡する)
```

### なぜ postgrest-py の `on_conflict` を使わないか

supabase-py（postgrest-py）の `.insert(..., on_conflict=...)` は UPSERT（マージ）用であり、
「重複時に何もしない」動作は表現できない。そのため `create_order_skip_duplicate` という
SQL RPC 関数（`INSERT ... ON CONFLICT ON CONSTRAINT orders_dedupe_key DO NOTHING RETURNING id`）
を新設し、`inserted: boolean` で成否を返している。

---

## DB スキーマ変更

`supabase/migrations/20260702000000_add_order_status_forecast.sql`:

- `orders.status` の CHECK制約を DROP + 再作成し、`forecast` / `forecast_tentative` を追加
  （text CHECK制約のため `ALTER TYPE ADD VALUE` は使えない）
- 新規 UNIQUE 制約 `orders_dedupe_key`: `(tenant_id, customer_id, product_id, deadline_date)`
  - 既知の制約: `product_id` または `customer_id` が `NULL` の行は NULL の非等価性により
    デデュープキーとして機能しない。パース処理側は `product_id` が確定した場合のみ
    このUNIQUE制約に依拠したINSERTを行うことで運用上回避している
- 新規テーブル `order_parse_log`: `id, tenant_id, order_attachment_id (FK), reason, detail (jsonb), created_at`
  - `reason`: `duplicate_skipped` / `no_product_match`
- 新規 RPC 関数 `create_order_skip_duplicate`

### `orders.status` の全定義

| 値                    | 意味                     |
|------------------------|--------------------------|
| `draft`                | 下書き                   |
| `confirmed`            | 確定/スケジュール済      |
| `completed`            | 完了                     |
| `canceled`             | キャンセル               |
| `forecast`             | 内示（Issue #249 で追加）|
| `forecast_tentative`   | 内々示（Issue #249 で追加）|

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

---

## 環境変数

```
# Claude API
PDF_EXTRACTION_MODEL=claude-sonnet-5  # デフォルト。EMAIL_EXTRACTION_MODEL とは別軸で管理
```

---

## 受け入れ条件

- [x] サンプルPDFから複数orderが正しく生成される（単体テストでモック検証。実PDFでの精度検証は運用後に実施）
- [x] `certainty` に応じて `orders.status` が `confirmed`/`forecast`/`forecast_tentative` に正しくセットされる
- [x] 品番・品名の照合失敗時はorderを生成せず、`order_parse_log` に記録される
- [x] 暗号化PDF・画像PDF（テキスト抽出不可）でもクラッシュせず `parse_status` が適切に更新される
- [x] 重複明細（UNIQUE制約抵触）はスキップされ `order_parse_log` に記録される
- [x] 生成された各orderから、対応する添付PDFが注文詳細画面からダウンロードできる
      （既存の `/orders/{order_id}/attachments` エンドポイントを変更なしで再利用）
- [x] マイグレーション（CHECK制約変更、UNIQUE制約、`order_parse_log`）が適用済み

---

## スコープ外

- 既存orderへのupsert・更新処理（将来Issue）
- PPAP（パスワード付きPDF）の自動復号
- 複数添付ファイルへの対応（1メール1添付の前提を維持）
- 重複スキップ・照合失敗の通知UI（将来Issue、`order_parse_log` を参照する前提）
- ステージング行が長時間 `pending` のまま停滞した場合のリトライ・タイムアウト処理
- `forecast`/`forecast_tentative` のUIフィルタータブ追加（別途検討）

---

## 関連

- [order-attachments.md](order-attachments.md): PDFステージング保存基盤（Issue #248、前提）
- 後続: 既存order upsert処理、処理ログ通知基盤（`order_parse_log` を利用）
