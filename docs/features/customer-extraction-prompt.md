# 顧客ごとの抽出指示の編集・試し読み（Issue #602）

顧客ごとの抽出指示（`customers.order_extraction_prompt`、[#366](./pdf-order-parsing.md#顧客別プロンプトによる注文番号抽出issue-366)）を
画面から編集する。本体は**試し読み**で、過去に届いたPDFを今の指示と編集中の指示の両方で読み取り、違いを確かめてから保存する。
保存のたびに変更履歴を残し、前の版を編集欄に読み込んで保存し直せる。

これまでは指示の変更に本番DBへの直接SQLが必要で、書き換えの影響は次のメールが届くまで分からなかった。

## 権限

- 編集・試し読み・履歴の閲覧は **`platform_admin` のみ**（当面、指示を書くのは開発・運用者のため。`president` への開放は運用に慣れてから別途検討）
- ロールの定数は揃える: Backend `routers/master/customer_extraction_prompt.py` の `_EXTRACTION_PROMPT_EDITOR_ROLES`、
  RPC `save_customer_extraction_prompt` 内の判定、Frontend `types/member.ts` の `EXTRACTION_PROMPT_EDITOR_ROLES`
- 他のロールには顧客マスタの行に入口（「取り込み設定」アイコン）を出さず、画面も中身を描かない
- 顧客の一覧・詳細・作成・更新（`/customers`）のレスポンスから `order_extraction_prompt` を除く（`customers.py` の `_public_customer()`）。
  本文は下記の専用 API だけが返す

## 画面

`/master/customers/[id]/extraction-prompt`（`components/customer-extraction-prompt/`）。試し読みの結果を左右に並べるため、
ダイアログではなく専用ページにし、マスタ共通の幅（`max-w-[860px]`）より広く取る（`app/master/layout.tsx`）。タブレット対応は不要。

1. **抽出指示**: 文章で書く。上限 2000 文字（抽出のたびにプロンプトへ足されるため）。書き方の例を入力欄の下に出す。
   空にして保存すると指示なし（NULL、汎用プロンプトのみ）に戻る
2. **試し読み**: その顧客の過去の受信PDFを選んで「試し読み」。項目ごとに「今の指示／編集中の指示」を並べ、違う行を強調する。
   明細は上から順に（同じ位置どうしを）比べ、片方にしか無い明細はすべての項目を違いにする（`lib/extraction-preview-utils.ts`）。
   試し読みのあとに編集欄を変えると、結果が古いことを示す
3. **保存**: 今の指示と同じ内容なら履歴を追記せず「変更はありません」
4. **変更履歴**（右側）: 版を選ぶと中身を表示し、「この版を編集欄に読み込む」で編集欄へ入れる（その場では保存しない。
   試し読みしてから保存する流れに乗せる。戻す操作も新しい版として履歴に残る）

表示する試し読みの結果: 明細数（取れなかったときに取り込みが代わりに行うこと）、文書の注文番号、種別（生産／修理等）、件名、
明細ごとの品名・品番・数量・納期・確度・明細の注文番号・起票される注文番号（`customer_order_no`）・製品の照合結果（照合できた製品／未照合）。

## API

すべてユーザー JWT（`get_supabase_client`）で動く。`tenant_id` は `get_current_tenant_id` で検証済みの値。

| メソッド | パス | 内容 |
| --- | --- | --- |
| GET | `/customers/{id}/extraction-prompt` | 今の指示（`prompt`・`customer_name`・`max_length`） |
| PUT | `/customers/{id}/extraction-prompt` | 保存（`{"prompt": str \| null}`。前後の空白を除き、空は NULL）。`{prompt, changed}` を返す |
| GET | `/customers/{id}/extraction-prompt/history` | 変更履歴（新しい順） |
| GET | `/customers/{id}/extraction-prompt/attachments` | 試し読みに使える過去の受信PDF（新しい順、50件） |
| POST | `/customers/{id}/extraction-prompt/preview` | `{"attachment_id", "prompt"}` を受け、今の指示と編集中の指示の結果を返す |

エラー: `platform_admin` 以外は 403、顧客が無ければ 404、2000 文字超は 422。試し読みは、使えない添付が 404、
回数制限が 429（`preview_rate_limited`）、PDFのダウンロード失敗が 502（`attachment_download_failed`）、
Claude API の一時的な失敗（レート制限・5xx・接続エラー）が 503（`extraction_unavailable`）。例外文言はレスポンスに載せない。

## 試し読み（`services/extraction_prompt_preview_service.py`）

**起票・更新・ログ・通知は一切しない**（読み込みのみ）。取り込みと結果がずれないよう、取り込み
（`pdf_order_parsing_service`）と同じ関数で読む。

- PDFの読み分け: `pdf_text_service.extract_text()`（`size_bytes` が上限超ならダウンロードしない。暗号化・サイズ超過は
  Claude を呼ばず `unreadable_reason` を返す）。テキストPDFは `extract_order_lines()`、画像PDF（`failed_image`、#520）は
  `extract_order_lines_from_pdf()`。画像PDFを Claude が受け付けなかった（`PdfDocumentRejectedError`）ときは、その指示の結果に
  `error: "document_rejected"` を入れる
- 明細の解釈・製品の照合: `pdf_order_parsing_service.read_line_item()`。注文番号の解決（`_resolve_customer_order_no()`）・
  確度の正規化・`_resolve_product_id()`（別名 → 品番 → pg_trgm → 埋もれた品番）までを DB へ書き込まずに行う。
  取り込みの `_process_line_item()` もこれを使う
- 修理等の判定 `is_repair_extraction()`、自動採番 `generate_pdf_auto_customer_order_no()` も取り込みと共有
- 明細が取れず修理でもないときは、取り込みが代わりに行うことを `fallback` で返す（テキストPDF＝メール本文から読み直す、
  画像PDF＝空の下書きを起票する）
- 2つの指示が（正規化して）同じなら Claude を1回だけ呼ぶ（`same_prompt`）
- 顧客は編集中の顧客に固定する。取り込みでは文面・発行元から顧客を解決し直すが（#385 / #520）、試し読みはその顧客の指示を確かめるためのもの

### 選べる添付

`attachment_id` だけを信用しない（`find_customer_pdf_attachment()`）。同じテナント・ステージング行（`order_id IS NULL`）・
PDF（`content_type='application/pdf'`、`storage_path` あり）で、顧客は次のどちらかで確かめる:

- ステージング行の `customer_id` がその顧客
- その添付から起票した受注（`orders.source_attachment_id`）の顧客がその顧客。束ね添付メールで PDF の文面から顧客を解決し直した
  受注は、ステージング行の `customer_id` がメール単位の顧客のまま残るため（#385）

一覧（`list_customer_pdf_attachments()`）も同じ条件で、新しい順に 50 件。

### 連打の防止

1回の試し読みで Claude API を最大2回呼ぶため:

- 画面のボタンは読み取り中は押せない
- テナント単位で 10 分に 10 回まで（`_PREVIEW_RATE_LIMIT` / `_PREVIEW_RATE_WINDOW_SECONDS`）。プロセス内の簡易な制限で、
  インスタンスが複数あればそれぞれで数える

### Storage の読み取り

試し読みは過去のPDFをユーザー JWT でダウンロードする。`order-attachments` バケットの読み取りポリシー
（20260630000000）は発行されていない `auth.jwt() ->> 'tenant_id'` クレームを見ていてユーザー JWT では一度も読めて
いなかったため（署名付きURLの発行はバックエンドの service role で行っていた）、本Issueのマイグレーションで
`organization_members` の所属と先頭フォルダ（テナントID）で判定するポリシーに張り直した。

## データモデル

`supabase/migrations/20261030000000_add_customer_extraction_prompt_history.sql`

### `customer_extraction_prompt_history`（追記のみ）

| 列 | 内容 |
| --- | --- |
| `id` | `bigint` identity。版の新旧はこの順 |
| `tenant_id` / `customer_id` | 顧客を消したら履歴も消す（`ON DELETE CASCADE`）。顧客を統合する機能は無いので付け替えは不要 |
| `prompt` | 変更後の指示。NULL は空に戻した版 |
| `changed_by` | 変更したユーザー。NULL は画面以外で入った値（移行時点の値・SQL での直接変更） |
| `changed_at` | 変更日時 |

- RLS は SELECT のみ `is_tenant_member(tenant_id)`。INSERT / UPDATE / DELETE のポリシーは作らない（ユーザー JWT では書けない）
- マイグレーションで、その時点で指示がある顧客の値を初版（`changed_by` NULL）として入れる

### RPC `save_customer_extraction_prompt(p_tenant_id, p_customer_id, p_prompt)`

顧客の指示の更新と履歴の追記を1トランザクションで行う（片方だけ成功しないように）。`SECURITY DEFINER`
（履歴に INSERT のポリシーを作らないため）で、関数内で `auth.uid()` が `platform_admin` であることを確かめる。

- `normalize_extraction_prompt()` で前後の空白（改行・タブ・全角空白を含む）を除き、空は NULL。2000 文字超は `22001`
- 履歴の最新と今の値が違う（画面以外で書き換えられた）ときは、今の値を `changed_by` NULL の版として先に残してから保存する
- 今の値と同じなら何も書かず `changed=false`
- 顧客が無ければ `P0002`（API は 404）、ロールが足りなければ `42501`（API は 403）

## テスト

- unit: `__tests__/unit/services/test_extraction_prompt_preview_service.py`（読み分け・同じ指示は1回・拒否・読めないPDF・
  DB へ書き込まないこと・添付の絞り込み・`read_line_item()`）
- api: `__tests__/api/routers/master/test_customer_extraction_prompt_router.py`（403・正規化・429・503・502）、
  `test_customers_router.py`（一覧・詳細が指示を返さない）
- integration: `__tests__/integration/test_customer_extraction_prompt.py`（RPC の履歴・権限・他テナント、履歴に直接書けないこと、
  Storage をユーザー JWT で自テナントだけ読めること、選べる添付が同じテナント・同じ顧客に限られること）
- Frontend: `lib/extraction-preview-utils.test.ts`、`components/customer-extraction-prompt/extraction-prompt-editor.test.tsx`、
  `app/master/customers/page.test.tsx`（入口の出し分け）
