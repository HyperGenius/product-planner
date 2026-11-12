# 弥生販売のエクスポートの取り込み（Issue #662 / #664 / #667）

送品の正典は弥生販売（インストール型）。弥生にはクラウド API が無く、連携手段はエクスポートなので、
事務PCが書き出したファイル（帳票「得意先別売上明細表」の Excel `.xlsx`。Issue #664）を**生ファイルのまま**受け取って保存し（フェーズ1）、
cron で解析して受注と突き合わせ、「送品の消し込み」に弥生の送品数量を出す（フェーズ2、Issue #667）。
**自動では送品済みにしない**（送品は弥生が正で、アプリは候補を示すだけ。#557）。

## 構成

```
[事務PC] 弥生販売 ──手動エクスポート──▶ 共有フォルダ（弥生取り込み用）
                                           │ UNC
[日報エージェント端末] DailyReportAgent.ps1（targets に shipment_files を追加）
        └─▶ agent-gateway ─▶ POST /api/agent/shipment-files ─▶ Storage + shipment_files

[事務PCのブラウザ]（予備）─▶ POST /shipment-files（ユーザー JWT）─▶ 同じ Storage + shipment_files
```

- 事務PC（経理データがある）には**何も入れない**。トークン・スクリプト・タスクスケジューラはエージェント端末だけに置く
- エージェントはファイルの形式を知らない。解析をサーバー側に置くので、CSV の形式が分かった後の修正は再訪問なしで出せる
- 弥生側のエクスポートは自動化しない（画面操作のため）。送品のたびに担当者がエクスポートを1回押す運用

## データ

- テーブル `shipment_files`（マイグレーション `20261108000000_add_shipment_files.sql`）。`UNIQUE (tenant_id, sha256)` で
  再送・同名上書き・同時送信を重複排除する。`source` は `agent` / `web`。`agent` は `agent_token_id`、`web` は
  `uploaded_by` が必須（CHECK）
- バケット `shipment-files`（private、20MB）。キーは `{tenant_id}/{sha256}{拡張子}`（`.xlsx` / `.csv` / `.txt`）（日本語ファイル名はキーに使わない）
- RLS: 参照はテナントメンバー。INSERT は `source='web'` かつ `uploaded_by = auth.uid()` のメンバーだけ（エージェント経由は
  service role）。Storage は自テナントのフォルダへの追加のみ（UPDATE・DELETE ポリシーは無い）。`auth.jwt() ->> 'tenant_id'` は
  発行されていないので `is_tenant_member()` で判定し、先頭フォルダが UUID でないキーで `::uuid` が失敗しないよう `CASE` で形式を先に確かめる

## API

| 経路 | エンドポイント | 認証 |
|---|---|---|
| エージェント | `POST /api/agent/shipment-files`（octet-stream。ヘッダは日報と同じ `X-File-Sha256` / `X-File-Path` / `X-File-Modified-At`） | エージェントトークン |
| アプリ | `POST /shipment-files`（octet-stream。`X-File-Name`（URL エンコード）/ 任意 `X-File-Modified-At`）。SHA-256 はサーバーが求める | ユーザー JWT。`order_handler` / `president` / `platform_admin` |
| アプリ | `GET /shipment-files`（最終取り込み日時＋直近20件。パスは返さない） | テナントメンバー |

- 受け付ける拡張子は `.xlsx` / `.csv` / `.txt`（content-type は `_CONTENT_TYPES` に明示。当初 `.xlsx` を除外していて弥生の実エクスポートが 400 になった。#664）（`shipment_file_service.ALLOWED_EXTENSIONS`）、上限は `SHIPMENT_FILE_MAX_BYTES`（既定 20MB）
- raw body の検証（サイズ上限・ハッシュ）は日報と共通の `routers/agent/_upload.py`。テストで上限を変えるときは
  ルーターモジュール側（`routers.agent.shipment_files` / `routers.transaction.shipment_files`）の定数を `monkeypatch` する
- **`agent-gateway`（Edge Function）の `ALLOWED_PATHS` に `/api/agent/shipment-files` を足してある。マージ後に
  `supabase functions deploy agent-gateway --no-verify-jwt` で再デプロイしないと、本番のエージェントからは届かない**

## エージェント（`tools/daily-report-agent/`）

- 設定の `targets`（`kind` = `daily_reports` / `shipment_files`、`folders`、任意の `extensions` / `recurse`）で、フォルダごとに
  送り先を切り替える。`targets` が無い従来の `target_folders` は `daily_reports` 1つとして動くので、既設の `config.json` はそのまま動く
- `kind` で送り先が決まる（任意のエンドポイントは指定できない）。拡張子の既定は日報が Excel、送品が `.xlsx` / `.csv` / `.txt`
- heartbeat の `payload.targets` に種類ごとの集計が入る。`-DryRun` は従来どおり送信せず対象だけを一覧する

## 画面

- `/orders/shipment-import`（サイドバー「弥生の取り込み」。社長・受注担当・プラットフォーム管理者）: 最終取り込み日時・直近のファイルと
  ファイルごとの解析の結果（期間・明細の件数・エラー）・予備のアップロード。ロールが足りないメンバーにはアップロードのボタンを出さない
- `/orders/shipment-names`（サイドバー「弥生の名寄せ」）: 得意先・商品のタブで、既定は未照合だけを出す。得意先には複数の顧客を追加でき、
  商流の推定・名前の一部一致の候補をボタンで出す。商品は候補（得意先の受注にある似た製品）とすべての製品から選べ、別の顧客の受注に出ている
  製品の候補を選ぶと、得意先にその顧客もひも付ける（`useSetShipmentProductLink()` が顧客→製品の順に登録し、顧客の 409 は無視）
- 「送品の消し込み」の上部に最終取り込み日時と、取り込んだ明細の最新の売上日を出す。**送品は不定期なので「何日更新が無い」の警告は出さない**
- 「送品の消し込み」の各行に「弥生の送品」（合算した数量／受注数量・最後の売上日・一部送品・区別できない明細の件数）を出し、受注数量に達した
  注文は理由「弥生で送品済み」で候補の先頭に並べる。送品の突合は対象の受注 ID でまとめて1リクエスト（`useShipmentOrderMatches()`。
  直前の結果を残す `keepPrevious`）で、サイドバーの件数は突合が届くまで数えない

## エクスポートの形式（実物2本で確認。値はダミー）

- 帳票「得意先別売上明細表」の `.xlsx`（売上伝票のエクスポートではない）。シートは1枚。結合セル・数式は無い
- 1行目は帳票名、3行目は `期間:YYYY年MM月DD日 ～ YYYY年MM月DD日`、5行目は見出し（33列。A列は空）、6行目から明細、最終行は `<<総合計>>`
- 明細には商品の行（`内訳=通常`、商品コードあり）と、伝票ごとの `《消費税》` 行（商品コードは空）がある
- 列: 得意先コード / 得意先名 / 税転嫁 / 売上日 / 伝票番号 / 取引区分 / 締切 / 納入先コード / 納入先名 / 担当者コード / 担当者名 / 内訳 /
  出荷 / 商品コード / 商品名/摘要 / 単位 / 入数 / ケース / 倉庫コード / 倉庫名 / 数量 / 原単価 / 単価 / 粗利益 / 金額 /
  主・副プロジェクトコード / プロジェクト名 / 課税区分 / 備考 / 見積番号 / 受注番号
- 売上日は datetime、数量は int。得意先コード・伝票番号・商品コードは文字列で先頭の0は残る。受注番号・見積番号・納入先・担当者・出荷は空
  （弥生の受注管理は使われていない）。取引区分は「掛売上」だけで、マイナスの数量（赤伝）は無かった
- 規模の目安: 1か月で商品の行が約100、伝票が約70、得意先が約20
- 設計に効く点:
  - **伝票番号は一意のキーにできない**（月をまたいで採番が戻った）。**行番号の列も無く、まったく同じ内容の行がありうる**（違うのは備考だけ等）
  - ファイルに期間が書かれていて、月の途中で書き出したファイルもある（期間は月初〜月末、明細は書き出した日まで）。ファイル名は担当者が付けるので期間は3行目から読む
  - 受注の手がかりは備考: `M/D納期分` / `N月末納期分`（受注の希望納期）、英数字とハイフンの値（顧客の注文番号と思われる）
  - 分納が多い（1つの納期分を何日にも分けて送る・1伝票に複数の納期分）
  - **商品コードは弥生の独自コード**（得意先ごとに接頭辞があり、大文字小文字が揺れる）。製品マスタの図番（`products.code`）とは一致しない（本番で確認済み）
  - 送料など商品ではない行が混ざる。単価・原単価・粗利益・金額の列は保存しない

## 解析（フェーズ2、Issue #667）

```
shipment_files (parse_status=pending)
  └─ cron GET /api/cron/parse-shipment-files（service role）
       ├─ services/shipment_parser.py（純粋関数）: 期間・見出しを名前で引き、商品の行だけを読む
       └─ RPC replace_shipment_entries: 期間の日ごとに、その日を含む最新のファイルの明細へ置き換える
            → shipment_entries / shipment_coverage
```

- パーサーは Storage・DB から切り離した純粋関数（`parse_shipment_workbook()`）。`read_only=True` なので `reset_dimensions()` してから読む。
  列は位置ではなく見出しの名前で引き、必須の見出し（得意先コード・得意先名・売上日・伝票番号・商品コード・商品名/摘要・数量）が無ければ
  `header_not_found`、期間が無ければ `period_not_found`。商品コードが空の行（消費税・総合計）は読み飛ばし、売上日が無い・期間の外の行は
  保存せず `skipped_count` に数える。数量がマイナス（赤伝）も同じ行として保存し、合算で打ち消す
- **明細は足し込まず置き換える**。伝票番号も行番号も冪等キーにならないので、ファイルの期間の**日ごと**に「その日を含むファイルのうち
  `file_modified_at` → `received_at` が最新のもの」の明細だけを残す（`shipment_coverage` が日ごとの載っているファイルを持つ）。
  当月分と2か月分のように期間の重なり方が違うファイルが来ても日単位で決まる。戻り値の `status` は `replaced` / `partial`（一部の日は
  新しいファイルが残った）/ `stale`。同じファイルの再処理は冪等
- `shipment_files.parse_status` は `pending` / `parsed` / `unsupported`（`.csv` / `.txt`）/ `failed`。`parse_error` はテナントのメンバーが
  読めるので固定の分類（`unsupported_file_type` / `invalid_workbook` / `period_not_found` / `header_not_found` / `parse_failed`）だけを入れ、
  例外の文言はログにのみ残す。表示文言は frontend の `SHIPMENT_PARSE_ERROR_LABELS`。再解析は `parse_status` を `pending` に戻す
- **`parse-order-pdfs-trigger` に `/api/cron/parse-shipment-files` を足したので、マージ後に `terraform apply` で Edge Function を再デプロイする**
  （漏れると本番では解析が一度も走らない）。失敗・復旧は `alert_cron_failure()` / `alert_cron_success()` で Slack に通知する

## 名寄せと受注への突合（Issue #667）

照合・突合の結果は保存せず、参照のたびに `services/shipment_matching_service.py` が求める（ロジック本体は純粋関数の
`shipment_matcher.py`）。辞書・受注の変更を再計算なしで反映するため（日報の名寄せ #488 と同じ考え方）。

### 得意先 → 顧客（1対多）

1. 辞書 `shipment_customer_links`（得意先コード → 顧客）。登録があれば辞書だけを使う
2. 得意先名と顧客名・通称の一致（`normalize_company_name()`。法人格・空白・**長音とハイフン類 `ー` / `－` / `‐` / `-`** を無視）。一意のときだけ

**商流**: 弥生の得意先（請求先。顧客としてはこちらが正）と、受注の顧客（注文書の会社＝注文元・送り先）が違うことがある（商社が得意先で
注文元は別の会社）。そのため1つの得意先に複数の顧客をひも付けられ、突合ではひも付いた顧客の受注をすべて候補にする。**受注の顧客は
注文書の会社のまま書き換えない**（請求先は表示しない。要望が出たら足す）。対応は現場に一覧を出してもらわず、名寄せの画面で直して覚える。
画面には推定の候補（製品が決まらない行の品名が、別の顧客の受注の製品に当たる）を出すが、自動では確定しない。

### (得意先, 商品コード) → 製品

1. 辞書 `shipment_product_links`（弥生の商品コードは得意先の中で安定しているので、一度登録すれば以降は当たる）
2. 品名に入っている図番らしき番号（数字5桁以上）が、製品の図番・品名・別名（`product_name_aliases`）に含まれる
3. `parse_product_spec()`（#515）の直径・長さが同じで、材質が先頭一致

2・3 は**得意先に対応する顧客の受注にある製品**に絞り、一意のときだけ照合する（類似度では照合しない）。商品コードは
`products.code` と照合しない。比較キーは `normalize_code()`（全角半角・空白・英字の大小を無視）で、辞書・対象外のキーもこの値で持つ。

### 対象外

`shipment_ignored_codes`（`kind='product'` は送料など商品ではない行、`kind='customer'` は突合に使わない得意先）。照合には影響させず、
未照合の一覧と突合から外すだけ。

### 明細 → 受注

対象は未送品の生産受注（`draft` / `pending_approval` / `confirmed` / `in_progress`）。下書き等は送品の消し込みには出ないが、
当てておかないと同じ顧客・製品の別の受注に誤って当たる。

1. 備考の注文番号らしい値が `orders.customer_order_no` と一致（補助。本番の一致は少なく、取り込み時の番号の正規化は別途見直す）
2. 備考の `M/D納期分` / `N月末納期分` が希望納期（`orders.deadline_date`）と一致。年は売上日に最も近い年（1月の売上の `12/20納期分` は前年）
3. どちらも無ければ、顧客＋製品の未送品の受注が1件だけのとき（受注日 `order_date` の JST 暦日より前の売上は充当しない）

候補が複数なら確定しない（各候補の受注に「区別できない明細」として件数を出す）。受注ごとに数量を合算し（分納・赤伝）、受注数量に
達したら送品の候補（理由 `yayoi_shipped`「弥生で送品済み」）、届かない間は「一部送品」。

### 顧客・製品の統合との関係

`shipment_customer_links.customer_id` / `shipment_product_links.product_id` は `ON DELETE CASCADE` で、`merge_customers` /
`merge_products` の付け替え対象に入れていない。統合で消えた対応は名寄せの画面で未照合に戻るので付け直す（件数は数十件の規模）。

## API（Issue #667）

| エンドポイント | 内容 |
|---|---|
| `GET /shipments/order-matches?order_id=…` | 受注ごとの弥生の送品（`shipped_qty` / `is_fully_shipped` / `last_sales_date` / 明細 / 区別できない明細）と `latest_sales_date`。上限500件 |
| `GET /shipments/customers` | 得意先ごとの照合状況（辞書・自動・対象外）と候補（名前の一部一致・商流の推定） |
| `GET /shipments/products` | (得意先, 商品コード) ごとの照合状況と候補（受注にある似た製品・別の顧客の受注の製品） |
| `POST /shipments/customer-links` / `DELETE /shipments/customer-links/{id}` | 得意先 → 顧客（重複は 409） |
| `PUT /shipments/product-links` / `DELETE /shipments/product-links/{id}` | (得意先, 商品コード) → 製品。登録済みなら付け替え |
| `POST /shipments/ignored` / `DELETE /shipments/ignored/{id}` | 対象外 |

- 書き込みはユーザー JWT で、ロールは Backend `SHIPMENT_NAME_EDITOR_ROLES` と Frontend `SHIPMENT_NAME_EDITOR_ROLES` を揃える
  （社長・受注担当・プラットフォーム管理者）。`GET /shipment-files` は解析の結果（期間・件数・エラー）も返す

## 顧客に確認すること

- 伝票番号の採番が戻った理由（採番のやり直しか、入力ミスか）
- 赤伝・返品の入力方法（今回の2本には無かった。来たら同じ行として取り込み、合算で打ち消す）
- 備考の書き方のルール（`納期分` / 注文番号以外の値の意味）
- 書き出しの範囲（毎回 当月1日〜月末か、月をまたいだ修正はどう拾うか）
- 事務PCから日報用のファイルサーバーへ書き込めるか（下記の確認手順）

### 事務PCの担当者向け: 書き込みの確認手順（メールで依頼する。スクリプトは送らない）

1. エクスプローラーのアドレス欄に共有フォルダのパス（`\\サーバー名\共有名`）を入力して開けるか
2. 開けたら新規にテキストファイルを作り、`test_書き込み確認.txt` で保存できるか
3. 結果（できた／できない。エラーが出たら文言・スクリーンショット）と、その PC にログオンしているアカウント名を返信してもらう
4. 確認後にそのファイルを削除してもらう（削除できるかも確認になる）

書き込めない場合の代替: アプリからのアップロード（本命の予備）→ メール添付 → USB。

## 運用上の注意

- 同じ月を何度書き出し直してもよい（日ごとに最新のファイルの中身へ置き換わるので重複しない。同じ内容のファイルは `(tenant_id, sha256)` で吸収）
- エクスポートには金額・請求情報の列が含まれるが、解析では保存しない（`shipment_entries` に列が無い）
