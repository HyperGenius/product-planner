# メール起票による注文入力設計

メールトリガーによる注文 API 入力機能のための基盤設計。
注文番号の任意化・起票元区分・生メール本文保存を実装し、将来のメール解析パイプラインと接続できる土台を提供する。

---

## 背景と目的

従来の注文入力は手動フォーム入力のみを前提としており、以下の課題があった。

- `order_number` が必須のため、メール解析結果から自動起票する際に採番ロジックが必要
- 起票元（手動 / メール）の区別ができず、運用上の混乱が生じやすい
- 生メール本文を保存できないため、解析ミス時の確認・修正が困難

本機能では DB スキーマ・バックエンド・フロントエンドを横断的に拡張し、メール起票の土台を整える。

---

## DBスキーマ変更 (#155)

### orders テーブル変更点

| カラム | 変更前 | 変更後 |
|---|---|---|
| `order_number` | `text NOT NULL` | `text NULL` (任意化) |
| (なし) | — | `source_type text NOT NULL DEFAULT 'manual'` |
| (なし) | — | `source_raw text NULL` |

### UNIQUE 制約

```sql
-- 変更前: テーブル制約
UNIQUE(tenant_id, order_number)

-- 変更後: 部分ユニークインデックス (NULL を除外)
CREATE UNIQUE INDEX orders_tenant_id_order_number_idx
  ON orders (tenant_id, order_number)
  WHERE order_number IS NOT NULL;
```

NULL 同士は重複とみなされないため、注文番号なしの注文を複数同一テナントに作成できる。

### source_type 値

| 値 | 説明 |
|---|---|
| `manual` | 手動フォーム入力（デフォルト） |
| `email` | メールトリガーによる自動起票 |

---

## バックエンド設計

### Pydantic スキーマ (`order_schema.py`)

```python
class OrderCreate(BaseSchema):
    order_number: str | None = Field(None, alias="order_no")  # 任意
    product_id: int
    quantity: int
    deadline_date: str | None = Field(None, alias="desired_deadline")
    customer_id: int | None = None
    source_type: str = Field("manual")   # 'manual' | 'email'
    source_raw: str | None = None        # メール本文 (email 時のみ使用)
```

### API リクエスト例

**手動起票（注文番号あり）**
```json
POST /orders/
{
  "order_no": "ORD-2026-001",
  "product_id": 1,
  "quantity": 100
}
```

**手動起票（注文番号なし）**
```json
POST /orders/
{
  "product_id": 1,
  "quantity": 100
}
```

**メール起票**
```json
POST /orders/
{
  "product_id": 5,
  "quantity": 50,
  "source_type": "email",
  "source_raw": "件名: 発注のご依頼\n\n山田製作所 鈴木です。\n製品コード ABC-500 を50個発注したく..."
}
```

---

## フロントエンド変更

### 型定義 (`frontend/src/types/order.ts`)

```typescript
interface Order {
  order_no: string | null          // null 許可
  source_type: 'manual' | 'email' // 追加
  source_raw?: string              // 追加
  // ...既存フィールド
}

interface OrderCreate {
  order_no?: string                // 任意に変更
  // ...既存フィールド
}
```

### 注文番号フィールド

`/orders/new` および編集ダイアログで注文番号を任意入力に変更。

- ラベル: `注文番号（任意）`
- プレースホルダー: `例: ORD-20260125-001（空白可）`
- バリデーション: `z.string().optional()`

### メール本文表示UI

注文詳細ページ (`/orders/[id]`) で `source_type === 'email'` かつ `source_raw` が存在する場合、
折りたたみ式パネルでメール本文を表示する。

```tsx
{order.source_type === 'email' && order.source_raw && (
  <details className="rounded-lg border bg-muted/50 p-4">
    <summary className="cursor-pointer text-sm font-medium">
      メール本文を表示
    </summary>
    <pre className="mt-2 text-xs whitespace-pre-wrap break-words text-muted-foreground">
      {order.source_raw}
    </pre>
  </details>
)}
```

### 注文番号 null 時の表示フォールバック

```tsx
// 詳細ページヘッダー
<h1>{order.order_no ?? `注文 #${order.id}`}</h1>

// 基本情報 dl 内
<dd>{order.order_no ?? <span className="text-muted-foreground">未設定</span>}</dd>
```

---

## メール解析パイプライン（実装済み）

`backend/app/services/` 配下に以下のサービスが実装済み。Supabase Edge Function + pg_cron（詳細は [docs/infra/supabase-pgcron-parse-order-pdfs.md](../infra/supabase-pgcron-parse-order-pdfs.md) 参照）から `/api/cron/gmail-poll` → `/api/cron/parse-order-pdfs` の順に叩くことで動作する。1段目の `gmail-poll` は `poll_unread_emails()` を呼び出す（下記「2段階Cronのスケジューリング設計」参照）。

### 処理フロー（Issue #280 でPDF添付・非PDF添付・添付なしを統一）

以前は非PDF添付・添付なしメールのみ `poll_unread_emails()` 内で即座に単一の `orders`
行を作成していたが、「1メール = 1受注」前提が崩れているケース（1通に複数品番・複数月分の
内示数量が含まれる等）に対応するため、Issue #280 で **すべてのソース種別（PDF添付・非PDF
添付・添付なし）を同じステージング経路に統一**した。実際の注文情報抽出・`orders` 生成は
`gmail_service.py` からは行わず、`parse_pending_order_pdfs()`（cron）が非同期に行う。

```
[Cron/タイマー]
  → poll_unread_emails() [gmail_service.py]
      │
      ├─ 1. Gmail ラベル `pp-pending/{テナント名}` の未読メール一覧取得
      │      → ラベルを `pp-processing/{テナント名}` に移動（二重処理防止）
      │
      ├─ 2. メール本文取得（base64 デコード、マルチパート MIME 対応）
      │
      ├─ 3. テナント解決（`gmail_label_tenants` テーブルからテナント ID 取得）
      │
      ├─ 4. 添付ファイル取得（ネストした parts も再帰探索）。PDF添付が
      │      あれば **その全件** を対象にし、PDFが無ければ最初の添付を使う
      │      （Issue #384。社長が複数顧客の注文書PDFを1通にまとめて転送する運用に対応）
      │
      ├─ 5. 顧客マッチング [customer_matching_service.py]
      │      送信者メールアドレスで検索 → 未登録の場合は draft 顧客を自動作成
      │      （受注メールか否かに関わらず、メール単位で1回だけ解決する。
      │       束ね添付メールでは全ステージング行にこの customer_id が入るが、
      │       各PDFを正しい顧客へ紐づけ直す処理はパース時に行う。Issue #385。
      │       詳細は [pdf-order-parsing.md](pdf-order-parsing.md#束ね添付での-pdf-単位の顧客解決issue-385)）
      │
      ├─ 6. 添付ファイルを Storage にステージング保存し、`order_attachments` に
      │      order_id=NULL のステージング行をINSERT。**PDF添付が複数ある場合は
      │      添付ごとに1行ずつ**（Issue #384）。PDFが無い/添付なしの場合は
      │      従来どおり1行のみ（storage_path は添付が無ければ空文字）
      │
      └─ 7. ラベルを `pp-done/{テナント名}` に移動
             （失敗時は `pp-error/{テナント名}` に移動）
```

実際の注文抽出（`line_items` 配列形式でのメール本文/PDF解析、製品照合、
`orders` へのUPSERT、`non_order_email`/`multi_order_suspected` 通知）は
`parse_pending_order_pdfs()` が行う。詳細は
[pdf-order-parsing.md](pdf-order-parsing.md) の「非PDF添付・添付なしメールの
本処理への統一（Issue #280）」を参照。

### Gmail ラベル規約

| ラベル | 意味 |
|---|---|
| `pp-pending/{テナント名}` | 処理待ち（ポーリング対象） |
| `pp-processing/{テナント名}` | 処理中（二重処理防止用） |
| `pp-done/{テナント名}` | 処理成功 |
| `pp-error/{テナント名}` | 処理失敗 |

プレフィックスは環境変数で変更可能（デフォルト: `pp-pending`, `pp-processing`, `pp-done`, `pp-error`）。

### 2段階Cronのスケジューリング設計 (#259)

メール起票パイプラインは実際には2つの独立したcronエンドポイントで構成されている。

| エンドポイント | 役割 |
|---|---|
| `GET /api/cron/gmail-poll` | メール取得・顧客解決・添付（あれば）のStorage保存を行い、`order_attachments` へのステージング保存のみ行う（Issue #280でPDF添付・非PDF添付・添付なしすべてこの経路に統一） |
| `GET /api/cron/parse-order-pdfs` | ステージング済み行（`order_attachments.parse_status='pending'`）をテキスト抽出/本文抽出・製品照合し、`orders` を実際にINSERT/UPDATE |

**設計方針（案1）: 2段目を高頻度で実行し、実行順序のズレを許容する。**

- `gmail_service.py` は「Storageへのアップロード完了 → `order_attachments` へのINSERT」の順で処理し、INSERTは単一の `.execute()` で完結する。そのため `order_attachments` に行が見える時点でPDFは必ずアップロード完了済みであり、「半端な状態」の行は存在しない
- `parse_pending_order_pdfs()` は `order_id IS NULL AND parse_status='pending'` の行のみを都度SELECTして処理するため、`gmail-poll` の実行途中で `parse-order-pdfs` が走っても、その時点までにINSERT済みの行だけが正しく処理され、未INSERTの分は `parse_status='pending'` のまま残り次回のポーリングで拾われる
- つまり2段目の実行タイミングが1段目より早くても、起きるのは**データ破損ではなく「今回処理されず次サイクルに持ち越されるだけ」の遅延**。この遅延を実用上無視できる範囲に収めるため、2段目はできるだけ高頻度（5〜15分間隔目安）にスケジュールする

**スケジューリング方式（#261で解消）**

`gmail-poll` / `parse-order-pdfs` はいずれも Vercel Cron には登録していない（Vercel Cronは無料プランで
実行回数制限があり、上記の高頻度実行（5〜15分間隔）を満たせないため）。代わりに単一の Supabase Edge
Function（`parse-order-pdfs-trigger`）が pg_cron/pg_net（Pro プランで追加コストなし）から5〜15分間隔で
呼び出され、その1回の実行の中で `gmail-poll` → `parse-order-pdfs` を順に呼び出す構成にした。上記の設計方針
（実行順序のズレを許容する）により、Edge Function内で厳密に「`gmail-poll` の完了を待ってから」実行しても、
本番運用上の周期のズレ自体は引き続き起こり得るが、それは想定内の挙動として扱う。構築手順は
[docs/infra/supabase-pgcron-parse-order-pdfs.md](../infra/supabase-pgcron-parse-order-pdfs.md) を参照。

### テナント登録（`gmail_label_tenants`）

Gmail ラベルの `{テナント名}` 部分と `tenant_id` の対応は `gmail_label_tenants` テーブルで管理する。
この登録が漏れると該当メールは `pp-error/{テナント名}` に落ちて起票されない（`tenant not found for label` エラー）。

新規テナント作成時は `backend/scripts/create_tenant.py --gmail-label <ラベル名>` で自動登録できる。
このテーブルはアプリ管理者専用の運用データであり、アプリユーザー向けAPIは設けていない。
既存テナントへの追加・変更はSupabase SQL Editorで直接行う（詳細は `docs/infra/env-setup-gmail-cron.md` Step 5）。

登録後、Gmail アカウント側で `pp-pending/{テナント名}` 等のラベルを実際に作成する作業は別途手動で必要
（`gmail_label_tenants` への登録とGmail上のラベル作成は自動連携されない）。

### 環境変数

| 変数名 | デフォルト | 説明 |
|---|---|---|
| `GMAIL_CLIENT_ID` | — | Gmail OAuth クライアント ID（必須） |
| `GMAIL_CLIENT_SECRET` | — | Gmail OAuth クライアントシークレット（必須） |
| `GMAIL_REFRESH_TOKEN` | — | Gmail OAuth リフレッシュトークン（必須） |
| `GMAIL_LABEL_PREFIX_PENDING` | `pp-pending` | 処理待ちラベルのプレフィックス |
| `GMAIL_LABEL_PREFIX_PROCESSING` | `pp-processing` | 処理中ラベルのプレフィックス |
| `GMAIL_LABEL_PREFIX_DONE` | `pp-done` | 完了ラベルのプレフィックス |
| `GMAIL_LABEL_PREFIX_ERROR` | `pp-error` | エラーラベルのプレフィックス |
| `EMAIL_EXTRACTION_MODEL` | `claude-haiku-4-5-20251001` | メール本文からの明細行(`line_items`)抽出に使用する Claude モデル |
| `MULTI_ORDER_SUSPECTED_QUANTITY_THRESHOLD` | `100000` | 自動抽出時に複数受注が1明細にマージされた疑いを検知する数量閾値（Issue #280） |
| `PRODUCT_MATCH_THRESHOLD` | `0.3` | pg_trgm 類似度の下限値 |
| `PRODUCT_MATCH_TOP_N` | `5` | 候補製品の最大表示件数 |
| `ANTHROPIC_API_KEY` | — | Claude API キー（必須） |

### 主要ファイル

| ファイル | 役割 |
|---|---|
| `backend/app/services/gmail_service.py` | Gmail ポーリングメインロジック |
| `backend/app/services/email_extraction_service.py` | Claude API によるフィールド抽出 |
| `backend/app/services/product_matching_service.py` | pg_trgm 製品名マッチング |
| `backend/app/services/customer_matching_service.py` | 送信者メールアドレスによる顧客解決・自動作成 |

### 注意事項

- `source_type === 'email'` の注文は `status='draft'` のまま起票される。`status` が
  `confirmed` に遷移するのはユーザーが `POST /orders/{id}/confirm` を実行した時のみで、
  PDF添付メール経由（`pdf_order_parsing_service.py`）でも certainty の値に関わらず
  常に `draft` で作成される。人間がレビューして確定する運用を徹底するための設計であり、
  当初これが徹底されていなかった不具合の是正については
  [pdf-order-parsing.md](pdf-order-parsing.md)（Issue #267）を参照
- 注文番号は解析できた場合のみ設定し、不明な場合は NULL のまま起票する
- `source_raw` にはメール本文全体を保存するため、個人情報の取り扱いに注意すること
- 製品マッチングが失敗した場合（候補ゼロ、またはしきい値未満）、明細はドロップされず
  `product_id=NULL`・`extracted_product_name`（抽出済み生テキスト、`TRIM()`のみ正規化）
  付きで下書きが起票される（Issue #296）。詳細は [pdf-order-parsing.md](pdf-order-parsing.md)
  を参照。なお `orders.product_candidates`（複数候補のjsonb保存）カラム自体は存在するが、
  実際の自動起票パイプラインからは未使用（デモ用シードスクリプトのみが書き込む）で
  あり、候補提示UIは本Issueのスコープ外として別Issueに切り出されている
- 担当者が下書きの `product_id` を選び直して表記ゆれを修正すると、その対応
  （`(customer_id, extracted_product_name)` → `product_id`）は別名辞書
  （`product_name_aliases`）へ自動的にフィードバックされ、以後**同じ顧客の**同じ
  表記ゆれは pg_trgm 曖昧検索より優先して即マッチする。別名は顧客単位でスコープ
  され（Issue #349）、他顧客の別名へはフォールバックしない。加えて、担当者が
  `product_id` を修正せず自動マッチのまま承認依頼（`POST /orders/{id}/request-approval`）
  を送信した場合も、その対応が `source='auto_match_unreviewed'`（未検証の推定）
  として辞書へ反映される（Issue #350）。この未検証エントリは製品マスタの
  「表記ゆれ履歴」から `president` の承認なしで付け替え・削除できる（Issue #351）。
  詳細は [product-master.md](product-master.md#別名辞書-product_name_aliases)
  および [pdf-order-parsing.md](pdf-order-parsing.md) を参照
- 顧客が特定できない場合でも `customer_id` は必ず設定される（下書き顧客の自動作成）。
  詳細は [customer-draft-auto-create.md](customer-draft-auto-create.md) を参照
- PDF添付メール経由で起票された注文は、PDF文面から抽出した顧客側の確度（確定/内示/内々示）
  を `orders.customer_certainty` に保持する。これは ProductPlanner側のワークフロー
  ステータス（`status`）とは独立した参考情報であり、UI上は別バッジとして表示される。
  詳細は [pdf-order-parsing.md](pdf-order-parsing.md) を参照

---

## 受信受注メールの処理結果一覧（Issue #357）

自動パースの結果（起票件数・スキップ/失敗理由）を確認する手段が通知ベルしかなく、
特に「パースは成功したが全明細が既存注文と重複して起票0件」のケースは通知すら
残らず（→ [pdf-order-parsing.md](pdf-order-parsing.md) の `no_order_created` 対策で解消）、
メーラーとアプリを見比べないと起票状況を追えなかった。

受信した受注メール（`order_attachments` のステージング行 = `order_id IS NULL`）を親に、
処理結果をまとめて一覧できるビューを追加した。

### API: `GET /orders/email-intake-results`

`backend/app/routers/transaction/orders.py::list_email_intake_results`。
レスポンスは `EmailIntakeResultResponse`（`order_schema.py`）の配列（受信日時の新しい順）。

| フィールド | 内容 |
|---|---|
| `received_at` | `order_attachments.created_at`（受信＝ステージング保存日時） |
| `customer_id` / `customer_name` | ステージング行の顧客（下書き顧客含む） |
| `has_attachment` / `original_filename` / `content_type` | 添付の有無・ファイル名・MIME |
| `parse_status` | `order_attachments.parse_status`。この一覧が対象にするステージング行（`order_id IS NULL`）では実質 `pending`（未処理）/ `success`（処理済み）の2値。`failed_*` は注文に紐づく実添付行（`order_id != NULL`）側で使われる値 |
| `created_order_count` / `created_order_ids` | そのメールから**新規起票**された注文（`orders.source_attachment_id = staging.id`。`updated` は含まない） |
| `parse_log_reasons` | その attachment に紐づく `order_parse_log.reason` の一覧（`no_order_created` / `no_product_match` / `draft_conflict_skipped` 等） |
| `signed_url` | 元PDFの署名付きURL（`create_signed_urls` バッチ生成、60分） |
| `gmail_url` | `https://mail.google.com/mail/u/0/#all/{gmail_message_id}` |

- ステージング行・顧客・注文・parse_log はいずれも「同一テナントのメンバーなら参照可」
  のRLSを持つため、閲覧者自身のユーザーJWTクライアントで取得する。`admin_client` は
  署名付きURL生成にのみ使う（既存 `GET /orders/{id}/attachments` と同じ方針）
- ルート定義は `GET /orders/{order_id}` より**前**に登録する（`email-intake-results` を
  `order_id: int` にパースしようとして422にならないようにするため）

### フロントエンド

- `frontend/src/types/order.ts`: `EmailIntakeResult` 型
- `frontend/src/hooks/use-orders.ts`: `useEmailIntakeResults()`（60秒ポーリング）
- `frontend/src/app/orders/email-intake/page.tsx`: 一覧テーブル。`created_order_count === 0`
  の行は「起票0件」バッジで強調する。`parse_status='success'` かつ理由ログが無い場合は
  「新規起票なし（全明細が既存注文と重複、または既存注文の更新のみ）」と中立的に補足表示する
  （`created_order_count` は `updated` を含まないため、重複スキップと断定はしない）。
  `parse_status` のバッジは `success`=中立 / `pending`=アウトライン / それ以外=エラー系で色分けする
- `frontend/src/components/layout/app-sidebar.tsx`: 「受信メール処理結果」メニュー項目
  （`/orders/email-intake`、全メンバーに表示）
- `notification-bell.tsx` / `types/notification.ts`: `no_order_created`（「起票0件（全明細が重複）」）
  を `NotificationType` / ラベルに追加

---

## 手動での「メール起票」（Issue #358）

自動パイプライン（Gmail ポーリング）に乗せられない受注メール（フォーマットが抽出に
不向き、分納スケジュール等）を、担当者が `/orders/new` から本文・添付付きで手動起票
できるようにする。自動経路（`_process_line_item`）と同じデータの持ち方
（`source_type='email'` / `source_raw` / `order_attachments` 紐付け / `source_attachment_id`
による束ね）に揃えることで、以後の受注管理・突き合わせを自動起票分と同一に扱える。

### API: `POST /orders/email-intake`（multipart/form-data）

`backend/app/routers/transaction/orders.py::create_email_order_intake`。

| パート | 内容 |
|---|---|
| `payload` | JSON文字列。`ManualEmailIntakeRequest`（`order_schema.py`）= `{ order_no?, customer_id?, customer_certainty?, source_raw?, line_items: [{ product_id?, quantity, desired_deadline?, extracted_product_name? }] }`。`line_items` は1件以上 |
| `files` | 添付ファイル（0個以上・複数可） |

処理:

1. 添付を Supabase Storage の `order-attachments` バケットへ保存する。パスは
   `{tenant_id}/manual/{group_id}/{safe_filename}`（`group_id` は1回の起票を束ねる UUID）。
   `attachment_service.upload_manual_email_attachment()`
2. 受信メールに相当する集約行を `order_attachments` に1件 INSERT（`order_id IS NULL`、
   `source_raw` 保持、代表として先頭ファイルの `storage_path` 等を記録）。集約行の
   `parse_status` は「処理状態」を表すため、添付有無に関わらず `success`（＝処理済み）で
   入れる（自動経路は `pending`→parse後 `success`。手動起票は同期的に処理済みのため
   `success` に寄せ、`/orders/email-intake-results` の表示・処理済み判定と揃える）。
   添付なしは `storage_path=''` で表現する
3. `line_items` ごとに `orders` を作成（`source_type='email'`、`status='draft'`、
   `source_attachment_id` = 集約行id、`customer_id` / `customer_certainty` / `source_raw`
   は全明細で共有）。`order_number` は UNIQUE(tenant_id, order_number) のため先頭明細にのみ付与
4. 作成した各注文 × 各添付ファイルの数だけ `order_attachments` を INSERT。この
   **実添付行**（`order_id != NULL`）の `parse_status` は添付ありで `success`、なしで
   `failed_no_attachment`（自動経路 `_process_line_item` と同じ規約。注文詳細画面の
   表示分岐もこの値を見る）
5. 集約行の INSERT が `APIError`（RLS違反等）の場合、および明細作成の途中で失敗した
   場合は 400 を返す（後者は作成済みの注文と集約行を削除してロールバック）

- `order_attachments` は `is_tenant_member(tenant_id)` の RLS 前提のため、INSERT は
  ユーザーJWTクライアントで行う。`admin_client` は Storage 保存にのみ使う（既存方針と同じ）
- 担当者が明細に品番を指定した場合、`record_correction_if_applicable()` で表記ゆれ辞書へ
  フィードバックする（`split_order` と同じ）
- 依存に `python-multipart` を追加（`requirements.txt`）

### フロントエンド

- `frontend/src/types/order.ts`: `ManualEmailIntakeLineItem` / `ManualEmailIntakeRequest` / `ManualEmailIntakeResponse`
- `frontend/src/hooks/use-orders.ts`: `useCreateEmailOrderIntake()`（multipart を送るため `apiClient` を使わず直接 `fetch`）
- `frontend/src/app/orders/new/page.tsx`: 冒頭に「手動フォーム / メール起票」トグルを追加。
  メール起票モードでは 注文番号（任意）・顧客（`CustomerSelector`）・メール本文（`textarea`）・
  添付アップロード（複数可）・明細行の繰り返し（`ProductSelector` + 数量 + 希望納期、追加／削除）
  を表示し、`useCreateEmailOrderIntake` で一括登録する。手動フォームモードの既存UI
  （3ステップ・シミュレーション）は変更なし

### 最初のユースケース

`gmail_message_id=1a04679c33ae25b5`（飯野製作所の分納注文書、自動抽出不可）を、本文＋
添付PDF＋複数明細でこのフォームから起票する。

---

## 実装状況

| 機能 | 状況 |
|---|:---:|
| DB: `order_number` nullable 化 | ✅ #155 |
| DB: `source_type` カラム追加 | ✅ #155 |
| DB: `source_raw` カラム追加 | ✅ #155 |
| Backend: `OrderCreate` スキーマ更新 | ✅ #155 |
| Frontend: `Order` 型更新 | ✅ #155 |
| Frontend: 注文番号フィールド任意化 | ✅ #155 |
| Frontend: メール本文折りたたみUI | ✅ #155 |
| Gmail ポーリング (`gmail_service.py`) | ✅ 実装済み |
| Claude API によるメール本文解析 (`email_extraction_service.py`) | ✅ 実装済み |
| pg_trgm 製品名マッチング (`product_matching_service.py`) | ✅ 実装済み |
| 顧客自動解決・作成 (`customer_matching_service.py`) | ✅ 実装済み |
| `seed_scenario.py` の `order_number` 部分ユニークインデックス対応 | ✅ #286 |
| 手動分割UI（`POST /orders/{id}/split`、詳細は[pdf-order-parsing.md](pdf-order-parsing.md)） | ✅ #280 |
| `gmail-poll` / `parse-order-pdfs` の高頻度スケジューリング（Supabase Edge Function + pg_cron、詳細は[supabase-pgcron-parse-order-pdfs.md](../infra/supabase-pgcron-parse-order-pdfs.md)） | ✅ #261 |
| 製品未マッチ明細のNULL product_id下書き起票（詳細は[pdf-order-parsing.md](pdf-order-parsing.md)） | ✅ #296 |
| 製品名の表記ゆれ辞書による自動補完・修正履歴管理（詳細は[pdf-order-parsing.md](pdf-order-parsing.md)、[product-master.md](product-master.md#別名辞書-product_name_aliases)） | ✅ #347 |
| 表記ゆれ辞書の顧客単位スコープ化（`customer_id` 追加、他顧客へフォールバックしない） | ✅ #349 |
| パース成功・起票0件の可視化（`no_order_created` 通知） | ✅ #357 |
| 受信受注メールの処理結果一覧（`GET /orders/email-intake-results` + `/orders/email-intake`） | ✅ #357 |
| 手動での「メール起票」モード（`POST /orders/email-intake`、本文＋添付＋分納の複数明細） | ✅ #358 |
| 複数PDF添付メールの添付ごとステージング（1メール:N添付）＋ 添付収集のネスト再帰化（詳細は[pdf-order-parsing.md](pdf-order-parsing.md#複数pdf添付の分割ステージングissue-384)） | ✅ #384 |
| 束ね添付メールでのPDF単位の顧客解決（パース時に PDF 文面の企業名で `customers` を突合し、一意なら添付ごとに `customer_id` を再解決。詳細は[pdf-order-parsing.md](pdf-order-parsing.md#束ね添付での-pdf-単位の顧客解決issue-385)） | ✅ #385 |
