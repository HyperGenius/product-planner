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
   - パスワード保護 (PPAP等) で開けない → `product_id`/`quantity`/`deadline_date` が
     すべて `NULL` の下書き order を1件起票し、対応する `order_attachments` 行の
     `parse_status='failed_encrypted'` とする（Issue #304、詳細後述）
   - テキストが1文字も取れない (画像PDF等) → 同様に下書き order を1件起票し
     `parse_status='failed_image'` とする（Issue #304）
   - テキスト抽出成功時、続けて **PDF文面から顧客を解決し直す**
     (`customer_matching_service.match_customer_by_pdf_text`、Issue #385)。
     束ね添付メール（1通にN顧客の注文書PDF）では全ステージング行がメール単位で
     解決した同じ `customer_id` を持つため、`customers.name` / `customers.alias` を
     法人格・記号・空白を無視して正規化し、抽出テキストに部分一致する顧客が
     **一意に定まった場合のみ** その添付の `customer_id` を上書きする。
     0件・複数件（判定不能）はメール単位の `customer_id` のまま
     （解決できないPDFは「不明な顧客」下書きに紐づく: Issue #263 の挙動を踏襲）。
     新規の下書き顧客はここでは作らない（作成はメール単位で1回のまま）
3. 抽出成功時、Claude tool-use (pdf_order_extraction_service.py) で明細行の配列を取得
   { product_name_raw, product_number_raw, quantity, delivery_date, certainty }
   - 顧客固有の抽出プロンプト断片（`customers.order_extraction_prompt`）は、
     上記で解決し直した `customer_id` から引く（Issue #385）
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
   b. すべて失敗した場合: `order_parse_log` に `reason='no_product_match'` で記録した上で、
      明細をドロップせず `product_id=NULL`・`extracted_product_name=<抽出生テキスト>` で
      下書きを起票する（Issue #296、詳細後述）
   c. certainty はそのまま orders.customer_certainty に保存する（confirmed/forecast/
      forecast_tentative）。orders.status には反映しない（Issue #267）
   d. customer_id は、手順2でPDF文面から解決し直した値（解決できなければ
      ステージング行の値）を明細共通で使う（Issue #385）
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

### 複数PDF添付の分割ステージング（Issue #384）

社長（社内の共通メールアカウント）が、FAX / セキュアファイル共有サイト由来の
受注PDFを **複数顧客ぶんまとめて1通のメールに添付** して転送する運用がある。

- 以前の `gmail_service._process_message()` は「1メール1添付」前提で、最初の
  `application/pdf` 添付（無ければ先頭の添付）1件だけを Storage 保存・ステージング
  していたため、2つ目以降のPDFは Storage にも `order_attachments` にも残らず、
  通知もされないまま **サイレントに起票漏れ** していた
- Issue #384 で、PDF添付が複数ある場合は **添付ごとに Storage 保存 + `order_attachments`
  ステージング行を1件ずつ INSERT** するよう変更（`_insert_staging_row()`）。以降は
  各ステージング行が独立して `parse_pending_order_pdfs()` に拾われ、それぞれ
  「1ソース:N受注」モデルで処理される
- あわせて `_get_attachments()` を **ネストした `parts` の再帰探索** に変更
  （転送メールが `message/rfc822` として添付される等、添付が2階層目以降に現れる
  構造で1つも取得できなかった問題への防御。本文抽出の `_find_part_data` と同じ理由）
- PDFが1件も無いメール（非PDF添付のみ・添付なし）は従来どおり単一ステージング行
- **ステージング時の顧客解決は引き続きメール単位で1回**（`gmail_service._process_message()`）。
  束ね添付では全ステージング行がこの同じ `customer_id`（社長の実 From ヘッダー由来 or
  「不明な顧客」下書き）を持つ。各PDFを正しい顧客へ紐づけ直す処理は
  **パース時（`parse_pending_order_pdfs`）に移した**（Issue #385、次項）

### 束ね添付での PDF 単位の顧客解決（Issue #385）

束ね添付メール（#384）は「1メールの中に複数顧客の注文書PDF」が入るため、
メール単位で1回だけ解決した `customer_id` を全PDFに使うと、各PDF（＝各顧客）の
受注がすべて同じ（多くの場合は誤った）顧客に起票されてしまう。

- **解決タイミング**: ステージング行の `customer_id` は変えず（`gmail_service` 側は
  無改修）、`pdf_order_parsing_service._parse_one()` が **PDFテキスト抽出後・
  Claude明細抽出前** に顧客を解決し直す。`order_attachments.customer_id` は
  nullable のままで、`_require_customer_id()`（NULL を不整合として弾く）とも整合する
  （NULL にはしない）
- **解決ロジック**: `customer_matching_service.match_customer_by_pdf_text(db, tenant_id, pdf_text)`。
  メールアドレスはPDF文面から安定して取れないため、既存の email 突合とは別経路で
  **企業名のみ**で突合する:
  - `customers.name` / `customers.alias` と PDF テキストの双方を
    `_normalize_company_name()` で正規化（`株式会社`・`(株)`・`㈱` 等の法人格、
    空白・中黒・ハイフン等の区切りを除去し英字を小文字化）
  - 正規化後の顧客名が正規化後のPDFテキストに **部分一致** する顧客を集め、
    **ちょうど1件**なら採用。0件（該当なし）・複数件（判定不能）は `None`
  - 正規化後2文字以下の顧客名は誤マッチしやすいため突合対象から除外
    （`_MIN_COMPANY_CORE_LEN`）
  - cron は管理者クライアント（RLSバイパス）で走るため `tenant_id` で明示的に絞る
- **フォールバック**: 解決できなければステージング行の `customer_id`（メール単位で
  解決済み。「不明な顧客」下書きを含む）をそのまま使う → 解決できないPDFは
  従来どおり下書き顧客に紐づく（#263 の挙動を踏襲）
- **顧客固有プロンプト**: `_get_customer_extraction_prompt()` は解決し直した
  `customer_id` で引く（束ね添付でも各PDFに正しい顧客のプロンプト断片が当たる）
- **下書き顧客の新規作成はしない**: 既存顧客への突合のみ。`customer_draft_created`
  通知は従来どおりメール単位で1回（`gmail_service`）
- **既存経路への影響なし**: 単一PDF添付・非PDF添付・添付なしメールは、解決結果が
  一意に定まらなければメール単位の `customer_id` のまま。テキスト抽出に失敗した
  PDF（暗号化・画像）も文面が無いため再解決せずメール単位の値を使う（挙動不変）
- 実装: `backend/app/services/customer_matching_service.py`（`match_customer_by_pdf_text`）、
  `backend/app/services/pdf_order_parsing_service.py`（`_parse_one`）、
  テスト: `__tests__/unit/services/test_customer_matching_service.py::TestMatchCustomerByPdfText`、
  `test_pdf_order_parsing_service.py::TestPerPdfCustomerResolution`

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
| `skipped_no_change`       | - | なし（※下記 Issue #357 の attachment 単位フォールバックを除く） |

#### パース成功・起票0件の可視化（Issue #357）

自動抽出は成功したのに、全明細が既存の内示注文と同一キー・同確度・同数量で
`skipped_no_change` になると、`_process_line_item` が黙って `False` を返すだけで
`order_parse_log` も `notifications` も残らず、`order_attachments.parse_status='success'`
だけが記録されていた。運用側はメーラーとアプリを見比べない限り「起票0件」に
気づけず、`parse_status='success'` のため cron の再処理対象からも外れる。

対策として `_parse_one` の末尾（`parse_status='success'` 更新の直前）で
`_notify_if_no_order_created(db, row, created_count)` を呼ぶ。

- `created_count == 0` かつ、その attachment に紐づく `order_parse_log` が1件も無い場合のみ、
  `reason='no_order_created'` の parse_log と `notif_type='no_order_created'` の通知を記録する
- `non_order_email` / `no_product_match` / `invalid_quantity` / `downgrade_skipped` /
  `draft_conflict_skipped` など、既に別の理由で parse_log が残っているケースは二重に
  通知しない（既存 parse_log の有無で判定）
- `parse_status` は `success` のまま（無限再処理を避ける）。可視化は通知と
  [受信メール処理結果一覧](email-order-intake.md#受信受注メールの処理結果一覧issue-357) で行う

`deadline_date` はdedupeキーの一部のため、内示の納期が翌月にずれるようなケースは
既存の仕組みでは別レコードとして新規INSERTされる（旧レコードは残り続ける）。これは
現時点で正式な引き継ぎ機能としては対応しないが、旧 `forecast`/`forecast_tentative`
レコード（`status='draft'` かつ `customer_certainty IN ('forecast', 'forecast_tentative')`
のもの）が一覧に溜まり続けないよう、`inserted` の都度 `_mark_superseded_orders` で
同一 `(tenant_id, customer_id, product_id)` の異なる未来日付レコードに
`superseded_at = now()` をセットし、注文一覧 (`OrderRepository.get_all`) から除外する。
ユーザーが確定済み（`status='confirmed'`）の注文はこのフィルタ対象外のため supersede
されない。

### 製品未マッチ明細のNULL product_id下書き起票（Issue #296）

以前は品番・品名のいずれの照合にも失敗した明細は `order_parse_log` に
`reason='no_product_match'` で記録するのみで、明細自体（`orders`行）を生成せず
ドロップしていた。1通のメールに複数明細が含まれる場合、一部の製品名がマッチしな
かっただけで当該明細の情報が失われる問題があったため、`product_id=NULL` の状態で
下書きを起票するよう変更した。

- `_process_line_item` は `product_id` が解決できなかった場合も `order_parse_log`/
  `notifications` への記録は従来どおり行った上で、処理を継続して
  `upsert_order_by_dedupe_key` RPCを呼ぶ（以前はここで処理を打ち切っていた）
- `extracted_product_name`（`orders.product_id` が NULL のときのフォールバック表示・
  重複判定に使う抽出済み生テキスト）は `TRIM()` のみ正規化する。全角/半角統一や
  記号除去等の高度な正規化は行わない（表記ゆれによる取りこぼし＝重複下書きの
  増加は許容し、情報が失われるわけではないため実運用データを見てから要否を
  判断する、というインクリメンタルな方針を採る）
- 同一メール内の他の明細がマッチ成功している場合、それらは通常どおり処理され、
  未マッチの明細の存在によってブロックされない（1明細=1order行の設計のため
  明細間の依存が元々ない）
- `product_id=NULL` の明細に対して `_mark_superseded_orders`（旧内示レコードの
  無効化）は呼ばない。どの製品の内示を無効化すべきか判断できないため

### PDF自体が読めない場合の下書き起票（Issue #304）

暗号化PDF・画像PDF等でテキスト抽出自体に失敗した場合、以前は `order_attachments` の
`parse_status` を更新し通知するだけで `orders` 行を一切作成せず処理を打ち切っていた。
ユーザーが内容を確認・手動修正する起点が無くなってしまうため、Issue #296（製品未マッチ
時の `product_id=NULL` 下書き起票）と同じ設計方針をテキスト抽出失敗ケースにも適用した。

- `pdf_order_parsing_service._process_unreadable_pdf()` が、`product_id`・`quantity`・
  `deadline_date` をすべて `NULL`、`customer_certainty='forecast_tentative'` として
  `upsert_order_by_dedupe_key` RPCを呼び、下書き order を1件起票する
- `customer_id` はステージング行作成時（`gmail_service.py` → `resolve_or_create_customer`）
  に既に解決済みの値をそのまま使う。送信元メールアドレスから顧客を特定できない場合も
  「不明な顧客 (YYYY-MM-DD HH:MM)」のプレースホルダー顧客が自動作成されているため、
  `customer_id` が `NULL` になることはない（[customer-draft-auto-create.md](customer-draft-auto-create.md)）
- `product_id` と `deadline_date` が共に `NULL` の場合、`upsert_order_by_dedupe_key` は
  重複判定に使える情報が無いため常に新規行としてINSERTする（Issue #296で追加された分岐、
  `20260712000000_add_orders_dedupe_key_unmatched_product.sql`）。そのため複数の
  解析失敗PDFが同一顧客から届いても、既存の下書きと誤って統合されることはない
- 生成した order に対応する `order_attachments` 行（`order_id` 設定済み）を追加INSERTし、
  `parse_status` にはテキスト抽出失敗理由（`failed_encrypted`/`failed_image`）をそのまま
  引き継ぐ。ステージング行自体（`order_id IS NULL` の元の行）は処理完了として
  `parse_status='success'` に更新する（Claude抽出まで到達したかどうかに関わらず、
  パース処理自体は正常完了とみなす既存方針を踏襲）
- `order_parse_log`・`notifications` への記録は従来どおり行う（`reason`/`notif_type` に
  `failed_encrypted`/`failed_image` を使用。新しい値の追加やCHECK制約変更は不要）

#### 重複起票防止（dedupe）のNULL product_id対応

`orders_dedupe_key`（`product_id` を含む）はNULLの非等価性により機能しないため、
`product_id IS NULL` の行専用の部分UNIQUE制約 `orders_dedupe_key_unmatched_product`
を追加し、`upsert_order_by_dedupe_key` に対応する分岐を追加した
（`supabase/migrations/20260712000000_add_orders_dedupe_key_unmatched_product.sql`）。

- 部分UNIQUE制約: `(tenant_id, customer_id, deadline_date, extracted_product_name)
  WHERE product_id IS NULL AND deadline_date IS NOT NULL AND extracted_product_name IS NOT NULL`
- `p_product_id IS NULL` の場合、既存行の特定方法を「`product_id` 一致」から
  「`product_id IS NULL AND extracted_product_name` 一致」に切り替えるのみで、
  その後の certainty priority hierarchy（confirmed/completed/canceled保護 →
  manual draft保護 → certainty優先度判定）は既存ロジックをそのまま再利用する
  （新規の分岐ロジックではない）
- `extracted_product_name` または `deadline_date` が NULL で重複判定に使える
  情報が無い場合は、常に新規行として挿入する（重複を許容する）

### 製品名の表記ゆれ辞書による自動補完（Issue #347）

製品未マッチ（Issue #296）や誤マッチの原因の多くは、メール本文中の製品名表記が
`products.name`/`products.code` と完全一致しない「表記ゆれ」であり、担当者が
下書きの `product_id` を選び直すことで都度手動修正されていた。この修正結果を
「生テキスト（`raw_text` = `extracted_product_name` と同じ値）→ 製品」の対応と
して `product_name_aliases` テーブルへ蓄積し、以後の自動マッチングに活用する。

- `_resolve_product_id()`（`pdf_order_parsing_service.py`）は
  `match_product_by_alias()`（`product_matching_service.py`）による別名辞書の
  完全一致検索を、`products.code` 完全一致・pg_trgm 曖昧検索よりも前段で行う。
  一致すればそれを最上位の確度として即採用し、以降の照合はスキップする
- 別名は顧客単位でスコープされる（Issue #349）。`match_product_by_alias(db,
  tenant_id, customer_id, raw_text)` / `_resolve_product_id(db, tenant_id,
  customer_id, ...)` は明細ごとに解決済みの `customer_id`（`_require_customer_id`）
  を受け取り、`(tenant_id, customer_id, raw_text)` の完全一致のみを見る。該当顧客の
  別名が無い場合に**他顧客の別名へフォールバックはしない**（誤爆防止）
- 別名の記録は `backend/app/services/product_alias_service.py` の
  `record_correction_if_applicable()` が担い、`PATCH /orders/{id}` と
  `POST /orders/{id}/split` の両経路（`orders.py`）から呼ばれる。対象注文が
  `source_type='email'` かつ `extracted_product_name` が設定されている場合のみ、
  修正前後で `product_id` が変化したときに発火する（手動起票の注文編集では
  発火しない）
- 別名登録自体は承認不要（`order_handler` 権限で完結）だが、
  `product_name_alias_history` に「いつ・誰が・どの注文をトリガに」修正したかを
  追記のみで記録する。詳細なテーブル定義・履歴閲覧APIは
  [product-master.md](./product-master.md#別名辞書-product_name_aliases)
  を参照

### 顧客別プロンプトによる注文番号抽出（Issue #366）

受注書フォーマットは顧客ごとに大きく異なり、特に「注文番号／注文No.」の位置・粒度・
呼称がばらつくため、汎用プロンプト1本では安定して抽出できない。顧客固有の抽出指示
（自然言語のプロンプト断片）と、抽出スキーマへの注文番号フィールド追加で対応する。
本Issueは **dedupe への統合前の観察フェーズ**であり、`customer_order_no` は保存・
表示のみで、重複判定（`upsert_order_by_dedupe_key` のキー・優先順位）には一切使わない
（本体は後続 Issue #365）。

**顧客固有プロンプト断片（`customers.order_extraction_prompt`、nullable）**

- `pdf_order_parsing_service._parse_one()` がステージング行の `customer_id` から
  `_get_customer_extraction_prompt()` で引き、`extract_order_lines()` /
  `extract_email_order_lines()` の第2引数へ渡す
- 抽出サービスは、断片が非NULLなら汎用プロンプトの末尾に「【この顧客固有の抽出指示】」
  として**追記**する（汎用プロンプトは共通ベースとして維持）。ツールスキーマ
  （フィールド定義）は変更せず、「どこを見てどう埋めるか」の自然言語指示のみ
- 断片が NULL の顧客は従来どおり汎用プロンプトのみで処理し、挙動は変わらない
- RLS は `customers` の既存 tenant isolation ポリシーで自動的にカバーされる
- 断片の投入は tenant_id / customer_id 特定が必要なため、マイグレーションの seed では
  行わず、本番で対象 customer を `SELECT` で確認 → ユーザー承認の上で個別 `UPDATE`
  （`CLAUDE.md` の「本番 Supabase への接続」手順に従う）

**抽出スキーマの注文番号フィールド（PDF・メール両方の `_EXTRACT_TOOL`）**

- `document_order_no`（文書レベル。1注文書＝1番号。多くの顧客はこれ）
- 明細 `line_items[].line_order_no`（明細レベル。1文書に複数の注文No.がある
  昭和製作所のようなケースで使用。無ければ null）

**明細ごとの `customer_order_no` 解決（`_resolve_customer_order_no()`）**

1. 明細の `line_order_no` があればそれ
2. 無ければ文書レベルの `document_order_no`
3. どちらも無ければ `_generate_auto_customer_order_no()` がアプリ側で採番した値
   （注文番号が文書に存在しない飯野製作所等）。`(customer_id, 空白正規化した
   文書テキスト)` の SHA-256 先頭10桁から `AUTO-xxxxxxxxxx` を生成する。同じ文書を
   再パースしても同じ番号になり、連番管理テーブルを持たずに観察・重複判定の土台と
   して安定する

1・2 の値は `_normalize_order_no_digits()` で**丸数字・全角数字を半角アラビア数字へ
正規化**してから返す（Issue #370）。昭和製作所は1ファイルに複数注文が入り、明細表で
品名単位に `①②③…` の連番が振られるため、顧客固有プロンプトで
`line_order_no` = `<文書の注文番号>-<連番>`（例: `C1869-①`）を返させ、保存時に
`C1869-1` へ畳む。丸数字 `①`–`⑳` は Unicode 上で連続だが `㉑`（U+3251）以降は非連続で、
「連番が10を超えたとき」に単純なコードポイント演算では扱えない。このため変換は
ブロック単位（`①`–`⑳` / `㉑`–`㉟` / `㊱`–`㊿` / `⓪` / 全角 `０`–`９`）の明示的な
マッピング辞書で行う。ASCII のみの値・`None` は no-op（冪等）で、`AUTO-xxxx` は
アプリ採番の ASCII 値のため正規化対象外。

> 昭和製作所（customer_id=5）の `order_extraction_prompt` 本番投入はコード変更とは分離し、
> マージ後の受注起票から適用する。それまでは `line_order_no` が来ないため挙動不変。

解決した値は `_process_line_item()` から `upsert_order_by_dedupe_key` の
`p_customer_order_no` 引数として渡され、INSERT 時に `orders.customer_order_no` へ
保存される。UPDATE 時は `COALESCE(v_customer_order_no, customer_order_no)`、すなわち
新しい値が非NULL/非空ならそれで更新し、NULL のときだけ既存値を保持する。手動メール起票
（`POST /orders/email-intake`）でも `ManualEmailIntakeLineItem.customer_order_no` で
受け取り保存する。

**表示**

- 受注一覧・詳細レスポンスは `_map_order_response()` が DB 行をそのまま透過するため
  `customer_order_no` を自動的に含む
- フロント: 受注一覧（`orders/page.tsx` + `order-table-row.tsx`）に「顧客注文番号」列、
  受注詳細（`orders/[id]/page.tsx`）に「顧客注文番号」項目を追加（表示のみ）

---

## DB スキーマ変更

`supabase/migrations/20260702000000_add_order_status_forecast.sql`（Issue #249）:

- `orders.status` の CHECK制約を DROP + 再作成し、`forecast` / `forecast_tentative` を追加
  （text CHECK制約のため `ALTER TYPE ADD VALUE` は使えない）
- 新規 UNIQUE 制約 `orders_dedupe_key`: `(tenant_id, customer_id, product_id, deadline_date)`
  - 既知の制約: `product_id` または `customer_id` が `NULL` の行は NULL の非等価性により
    デデュープキーとして機能しない。`product_id` が NULL の行の重複排除は
    `orders_dedupe_key_unmatched_product`（Issue #296、後述）で別途対応した
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

`supabase/migrations/20260819000001_add_product_name_aliases.sql`（Issue #347）
および `20260829000000_scope_product_name_aliases_by_customer.sql`（Issue #349）:

- 新規テーブル `product_name_aliases`: `id, tenant_id, customer_id (FK, ON DELETE
  CASCADE, NOT NULL), product_id (FK, ON DELETE CASCADE), raw_text, created_by,
  created_at, updated_at`。`(tenant_id, customer_id, raw_text)` UNIQUE（#349 で
  `customer_id` を追加）。同一キーへの再修正は UPSERT（上書き）する。#349 適用時
  点で両テーブルは本番含め空だったためバックフィル不要
- 新規テーブル `product_name_alias_history`: `id, tenant_id, customer_id (FK, ON
  DELETE SET NULL), customer_name_snapshot, product_id (FK, ON DELETE SET NULL),
  product_name_snapshot, raw_text, changed_by, changed_at,
  action ('created'/'updated'), source_order_id (FK, ON DELETE SET NULL),
  source_order_label_snapshot`。追記のみ（UPDATE/DELETEしない）。#349 で
  `customer_id` / `customer_name_snapshot` を追加（顧客削除後もスナップショットで
  文脈を追える）
- 両テーブルとも RLS (`is_tenant_member(tenant_id)`) を設定

`supabase/migrations/20260712000000_add_orders_dedupe_key_unmatched_product.sql`（Issue #296）:

- 部分UNIQUE制約 `orders_dedupe_key_unmatched_product`（`product_id IS NULL` の行専用）を追加
- `upsert_order_by_dedupe_key` に `p_product_id IS NULL` の分岐を追加
  （既存の `orders.product_id`/`orders.extracted_product_name` カラムは
  `20260618000000_gmail_intake_v2.sql` で追加済みのため変更なし）

### `orders.customer_certainty` の全定義（顧客側の確度、参考情報）

| 値                    | 意味                       |
|------------------------|----------------------------|
| `null`                 | 手動起票（確度情報なし）     |
| `confirmed`            | 確定納期・PO番号明記        |
| `forecast`             | 内示                        |
| `forecast_tentative`   | 内々示                      |

`orders.status` とは独立しており、`customer_certainty` の値が `confirmed` であっても
`status` は自動では `confirmed` にならない（Issue #267）。

`supabase/migrations/20260902000000_add_customer_order_extraction_prompt.sql`（Issue #366）:

- `customers.order_extraction_prompt text`（nullable）を追加。RLS は `customers` の
  既存 tenant isolation ポリシーで自動的にカバーされる
- `orders.customer_order_no text`（nullable・制約なし）を追加。社内採番の
  `orders.order_number`（`orders_tenant_id_order_number_idx` でテナント内ユニーク）
  とは意味が異なるため流用しない
- `upsert_order_by_dedupe_key` に `p_customer_order_no text DEFAULT NULL` を追加し、
  各 INSERT で保存する。UPDATE 時は `COALESCE(v_customer_order_no, customer_order_no)`
  （新しい値が非NULL/非空ならそれで更新、NULL のときだけ既存値を保持）。
  **dedupe キー・優先順位判定は 20260830150000 時点の定義から一切変更しない**
  （末尾に DEFAULT 付き引数を足すと旧シグネチャが残るため、10引数版を `DROP FUNCTION`
  してから作り直す）

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
- `supabase/migrations/20260819000001_add_product_name_aliases.sql`（Issue #347）
- `backend/app/services/product_alias_service.py`（Issue #347）
  - `record_correction_if_applicable(client, tenant_id, order_before, order_after, changed_by)`
- `backend/app/repositories/supa_infra/master/product_name_alias_repo.py`（Issue #347）
  - `ProductNameAliasHistoryRepository`

### 既存ファイルへの追加

- `backend/app/services/product_matching_service.py`: `match_product_by_code()` を追加。
  `match_product_by_alias()` を追加（Issue #347）
- `backend/app/services/attachment_service.py`: `download_attachment()` を追加
- `backend/app/repositories/supa_infra/common/table_name.py`: `ORDER_PARSE_LOG` を追加。
  `PRODUCT_NAME_ALIASES` / `PRODUCT_NAME_ALIAS_HISTORY` を追加（Issue #347）
- `backend/app/routers/transaction/orders.py`: `update_order` / `split_order` に
  `record_correction_if_applicable()` の呼び出しを追加（Issue #347）
- `backend/app/routers/master/products.py`: `GET /products/{product_id}/aliases` を追加（Issue #347）
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

Issue #296 での変更（製品未マッチ明細のNULL product_id下書き起票）:

- `supabase/migrations/20260712000000_add_orders_dedupe_key_unmatched_product.sql`:
  部分UNIQUE制約 `orders_dedupe_key_unmatched_product` の追加、
  `upsert_order_by_dedupe_key` への `p_product_id IS NULL` 分岐追加
- `backend/app/services/pdf_order_parsing_service.py`: `_process_line_item` の
  no-match時early returnを撤廃し、`product_id=NULL`・`extracted_product_name`
  （TRIM済み）でorder作成処理に合流させる。`_mark_superseded_orders` は
  `product_id is not None` の場合のみ呼ぶよう変更
- `backend/app/routers/transaction/orders.py`: `/orders/{order_id}/simulate`・
  `/orders/{order_id}/confirm` に `product_id IS NULL` のNoneガードを追加し
  `422`（FastAPIの`HTTPException`によりレスポンスボディは
  `{"detail": {"error": "product_unmatched"}}`。フロントの`ApiError.errorCode`は
  `detail.error`を参照する）を返す
- `frontend/src/types/order.ts`: `Order.product_id` を `number | null` に、
  `extracted_product_name` フィールドを追加
- `frontend/src/lib/order-utils.ts`: `getProductName` に
  `extracted_product_name` フォールバック引数を追加
- `frontend/src/app/orders/[id]/page.tsx`: `blocksSimulation` に
  `product_id === null` の判定を追加。製品未識別時の警告メッセージ＋
  編集ダイアログへの導線、`product_unmatched` エラーコードのtoast表示を追加
- 注文一覧・削除確認・一括シミュレーション確認ダイアログの `getProductName`
  呼び出しに `extracted_product_name` を渡すよう更新

Issue #304 での変更（PDF解析失敗時の下書き起票）:

- `backend/app/services/pdf_order_parsing_service.py`: テキスト抽出失敗時に
  `order_attachments.parse_status` 更新・通知のみで打ち切っていた分岐を、
  `_process_unreadable_pdf()` による下書き order 起票に変更。
  `_parse_one()` は失敗時も最終的にステージング行を `parse_status='success'` に更新する

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
- [x] 品番・品名の照合失敗時も `order_parse_log` に記録した上で
      `product_id=NULL` の下書きが起票され、明細がドロップされない（Issue #296）
- [x] 暗号化PDF・画像PDF（テキスト抽出不可）でもクラッシュせず、判明している情報
      （顧客等）だけで下書き order が1件起票され、対応する `order_attachments` 行の
      `parse_status` に失敗理由が引き継がれる（Issue #304）
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
- [x] 製品マッチングが失敗した明細について、`product_id=NULL`・
      `extracted_product_name`付きで下書きが起票される（Issue #296）
- [x] `product_id=NULL` の明細を含む注文詳細画面・注文一覧がエラーにならず表示され、
      製品名部分は `extracted_product_name` をフォールバック表示する（Issue #296）
- [x] `product_id=NULL` の明細に対してシミュレーション実行ボタンが無効化される
      （UXレイヤー、既存の `has_no_routings` ロジックを活用。Issue #296）
- [x] `product_id=NULL` の明細について、同一
      `(tenant_id, customer_id, deadline_date, extracted_product_name)` の内容が
      再度パースされても重複下書きが増殖しない（Issue #296）
- [x] 暗号化PDF・画像PDFで解析自体に失敗した場合も、顧客IDのみで
      `product_id`/`quantity`/`deadline_date` が `NULL` の下書き order が起票される
      （Issue #304）
- [x] `product_name_aliases` / `product_name_alias_history` テーブルがマイグレーションで
      追加され、RLS が設定されている（Issue #347）
- [x] メール起票下書きの `product_id` 修正時（`PATCH /orders/{id}` /
      `POST /orders/{id}/split` の両方）に、共通サービス関数経由で別名が
      自動記録される。手動起票の注文編集では記録されない（Issue #347）
- [x] 同一 `raw_text` への再修正時に履歴が追記され、`product_name_aliases` には
      最新の対応が反映される（Issue #347）
- [x] `product_matching_service` が別名辞書を pg_trgm より優先的に参照する（Issue #347）
- [x] `GET /products/{product_id}/aliases` が登録者表示名・トリガー注文情報を
      含む集約レスポンスを返す（Issue #347）

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
    （`_process_line_item` と同じパターン。添付ファイル本体は複製しない）。
    このソース行が見つからない場合（レコード不整合等）は400を返す
  - 分割後の明細が元の注文と同じ `(customer_id, product_id, deadline_date)` を
    指定するケース（内容はそのままに品番だけ変えたい等）では、元の注文が
    残ったまま新規INSERTすると `orders_dedupe_key` が自分自身と衝突してしまう。
    これを避けるため、新規INSERTの前に元の注文の `deadline_date` を一時的に
    `NULL` へ退避する（UNIQUE制約はNULL同士を等価とみなさないため衝突しなくなる）。
    全明細の作成に成功した時点で初めて元の注文を実際に削除し、失敗時は
    `deadline_date` を元に戻すだけで復元が完了する（`id` や紐づく
    `order_attachments` 行を一度も削除しないため、削除→再作成のような
    データ消失は起きない）
  - `orders_dedupe_key` の一意制約違反等で作成が一部失敗した場合、その分割
    リクエスト内で既に作成済みの注文をロールバック（削除）した上で400を返す
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
- 参照元メール（件名・顧客・本文・添付ファイル一覧）を表示する左ペインは
  `SourceEmailPanel`（`frontend/src/components/orders/source-email-panel.tsx`）
  として共通コンポーネント化されており（Issue #317）、`SplitOrderDialog` に加えて
  `EditOrderDialog`（`frontend/src/components/orders/edit-order-dialog.tsx`）からも
  利用される。`EditOrderDialog` は `source_type === 'email'` かつ `source_raw` が
  存在する注文を編集する場合のみ、モーダルを2ペインレイアウト
  （`sm:max-w-[820px]`）に切り替えて左に本パネルを表示する。手動作成の注文では
  従来通り単一カラムのフォームのみが表示される。件名/本文の分離ロジック
  （`source_raw` 内の「件名: ...」行を正規表現で切り出す）は
  `splitSubjectAndBody()`（`frontend/src/lib/order-utils.ts`）として共通化されている

---

## スコープ外

- PPAP（パスワード付きPDF）の自動復号
- ~~複数添付ファイルへの対応（1メール1添付の前提を維持）~~ → Issue #384 で対応（1メール = N添付。下記「複数PDF添付の分割ステージング」参照）
- ~~束ね添付メールでのPDF単位の顧客解決（現状は全ステージング行がメール単位で解決した同じ `customer_id` を持つ）~~ → Issue #385 で対応（パース時に `match_customer_by_pdf_text` で企業名突合。上記「束ね添付での PDF 単位の顧客解決」参照）
- PDF文面の顧客突合を **企業名の部分一致以外**（住所・電話番号・エイリアス辞書の拡充、Claude抽出による発注元名の構造化等）へ広げること。まずは企業名の正規化＋部分一致で運用し、精度を見て判断する
- テキスト抽出に失敗したPDF（暗号化・画像）を束ね添付で受けた場合の顧客解決（文面が無いためメール単位の値のまま。OCR前提の別Issue）
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
- 製品候補のサジェスト表示・専用レビューUIの新規作成、未マッチ製品名から
  productsマスタへの新規自動登録、複数候補が僅差で並ぶ「曖昧マッチ」の扱い
  （`product_candidates`カラムの活用含む）は別Issue（Issue #296スコープ外）
- `extracted_product_name` の高度な正規化（全角/半角統一・NFKC正規化・記号除去等）。
  `TRIM()` のみ実施し、それ以外の表記ゆれによる取りこぼしは許容する（Issue #296スコープ外）
- 重複下書きが発生してしまった場合の手動マージUI（Issue #296スコープ外）
- `edit-order-dialog.tsx` への抽出済み生テキストのヒント表示強化。現状のUIでも
  `ProductSelector` による製品の選び直し自体は可能（Issue #296スコープ外）

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

`TestUpsertOrderByDedupeKeyUnmatchedProduct`（Issue #296）は `product_id=NULL` の
明細に対する `orders_dedupe_key_unmatched_product` 経由の重複判定
（同一`extracted_product_name`+`deadline_date`でのdedupe、TRIM()による表記ゆれ吸収、
`extracted_product_name`がNULLの場合は重複判定せず常に挿入、certainty優先度判定の
再利用）を検証する。

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
  （1文字違いの類似製品が製品マスタに存在するケース）は誤って別製品にマッチせず、
  `no_product_match` としてログ記録された上で `product_id=NULL` の下書きが
  生成されること（Issue #296）

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
- [product-master.md](product-master.md#別名辞書-product_name_aliases): 製品名の表記ゆれ辞書・修正履歴管理（Issue #347）
