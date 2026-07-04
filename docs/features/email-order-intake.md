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

`backend/app/services/` 配下に以下のサービスが実装済み。Vercel Cron または Azure Functions タイマートリガーから `poll_unread_emails()` を呼び出すことで動作する。

### 処理フロー

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
      ├─ 4. Claude API によるフィールド抽出 [email_extraction_service.py]
      │      ツール: extract_order_fields
      │      出力:   product_name, quantity, deadline_date, order_number (全て nullable)
      │
      ├─ 5. 製品マッチング [product_matching_service.py]
      │      pg_trgm RPC `match_products_by_name` で類似度検索
      │      → 単一一致: product_id を確定
      │      → 複数候補: candidates リストを order_row に保存
      │
      ├─ 6. 顧客マッチング [customer_matching_service.py]
      │      送信者メールアドレスで検索 → 未登録の場合は draft 顧客を自動作成
      │
      ├─ 7. draft 注文を Supabase に INSERT
      │      (source_type="email", status="draft", source_raw=メール本文, ...)
      │
      └─ 8. ラベルを `pp-done/{テナント名}` に移動
             （失敗時は `pp-error/{テナント名}` に移動）
```

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
| `GET /api/cron/gmail-poll` | メール取得・フィールド抽出・非PDF添付の即時起票／PDF添付は `order_attachments` へのステージング保存のみ |
| `GET /api/cron/parse-order-pdfs` | ステージング済みPDF（`order_attachments.parse_status='pending'`）をテキスト抽出・製品照合し、`orders` を実際にINSERT |

**設計方針（案1）: 2段目を高頻度で独立実行し、実行順序のズレを許容する。**

- `gmail_service.py` は「Storageへのアップロード完了 → `order_attachments` へのINSERT」の順で処理し、INSERTは単一の `.execute()` で完結する。そのため `order_attachments` に行が見える時点でPDFは必ずアップロード完了済みであり、「半端な状態」の行は存在しない
- `parse_pending_order_pdfs()` は `order_id IS NULL AND parse_status='pending'` の行のみを都度SELECTして処理するため、`gmail-poll` の実行途中で `parse-order-pdfs` が走っても、その時点までにINSERT済みの行だけが正しく処理され、未INSERTの分は `parse_status='pending'` のまま残り次回のポーリングで拾われる
- つまり2段目の実行タイミングが1段目より早くても、起きるのは**データ破損ではなく「今回処理されず次サイクルに持ち越されるだけ」の遅延**。この遅延を実用上無視できる範囲に収めるため、2段目はできるだけ高頻度（5〜15分間隔目安）にスケジュールする

**現状のギャップ（既知の課題、#259で対応中）**

- `frontend/vercel.json` には `gmail-poll` のみ登録されており、`parse-order-pdfs` はどのスケジューラにも登録されていない。そのため現状PDF添付メールは「ステージングまでは自動化されているが、受注確定までは自動実行されない」状態になっている
- Vercel Cronは無料（Hobby）プランでは実行回数制限（1日2回まで）があり、上記の高頻度実行（5〜15分間隔）を満たせない。Cloud Run + Cloud Scheduler等、Vercel Cron以外のスケジューラへの移行を検討中

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
| `EMAIL_EXTRACTION_MODEL` | `claude-haiku-4-5-20251001` | フィールド抽出に使用する Claude モデル |
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

- `source_type === 'email'` の注文は `draft` のまま起票される。人間がレビューして確定する運用を推奨
- 注文番号は解析できた場合のみ設定し、不明な場合は NULL のまま起票する
- `source_raw` にはメール本文全体を保存するため、個人情報の取り扱いに注意すること
- 製品マッチングで候補が複数ある場合、`product_candidates` に候補リストが保存され、`product_id` は NULL になる

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
