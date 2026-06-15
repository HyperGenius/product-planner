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

## 将来の拡張: メール解析パイプライン

本機能はメール解析 Azure Function との接続を想定した土台。以下のフローで注文を自動起票する。

```
[受信メール] → [Azure Function: メール解析]
              → LLM でフィールド抽出 (製品コード, 数量, 希望納期)
              → POST /orders/ {source_type: "email", source_raw: "<メール本文>"}
              → [人間によるレビュー・確定]
```

`source_raw` を保存することで、解析ミスが発生した場合に原文を参照して修正できる。

### 注意事項

- メール解析の精度向上まで、`source_type === 'email'` の注文は `draft` のまま人間がレビューして確定する運用を推奨
- 注文番号は解析できた場合のみ設定し、不明な場合は NULL のまま起票する
- `source_raw` にはメール本文全体を保存し、個人情報の取り扱いに注意すること

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
| Azure Function: メール受信トリガー | ❌ 未実装 |
| LLM によるメール本文解析 | ❌ 未実装 |
