# 工程確定UI（is_confirmed）

Issue #197 / #199 / #200 で実装。

## 概要

工程ルーティング（`process_routings`）に確定フラグを追加し、`admin` ロールのみが確定操作を行えるよう制限する機能。

## DB スキーマ変更

`supabase/migrations/20260620000000_add_confirmed_fields_to_process_routings.sql` にて追加:

| カラム | 型 | デフォルト | 説明 |
|---|---|---|---|
| `is_confirmed` | boolean NOT NULL | false | 確定フラグ |
| `confirmed_by` | uuid (FK auth.users) | NULL | 確定操作を行ったユーザーID |
| `confirmed_at` | timestamptz | NULL | 確定日時 |

## Backend

### ロール取得ヘルパー

`backend/app/dependencies.py` に `get_current_user_role(tenant_id, user_id, client) -> str` を追加。`organization_members` テーブルから `role` を取得する。

### PATCH エンドポイントのガード

`PATCH /process-routings/{id}` で `is_confirmed` を含むリクエストの場合:
- 呼び出し元ユーザーのロールを確認
- `admin` でなければ HTTP 403 を返す
- `is_confirmed=true` の場合、`confirmed_by` と `confirmed_at` を自動セット
- `is_confirmed=false`（取消）の場合、両フィールドを NULL にリセット

## Frontend

### 型定義

`frontend/src/types/process-routing.ts` の `ProcessRouting` に `is_confirmed`, `confirmed_by`, `confirmed_at` を追加。`ProcessRoutingUpdate` に `is_confirmed?: boolean` を追加。

### UI（`product-routings-dialog.tsx`）

- 工程リストに「確定」列を追加
  - `admin` ユーザー: チェックボックス形式のトグルボタンを表示。クリックで確定/取消
  - `member` ユーザー: 鍵アイコン（`Lock`）を表示し操作不可
- 確定済み工程の工程名に緑色バッジ（「確定済み」）を表示
- 確定取消時は AlertDialog で「確定を取り消しますか？」確認ダイアログを表示
- `useCurrentMember()` フックでロールを判定

---

## 専門家キュー（Issue #200）

工程未確定の draft 注文を残バッファ昇順で可視化する機能。

### Backend

#### `GET /orders` の拡張

`OrderRepository.get_all_with_routing_status()` を追加（2クエリ、N+1なし）。
各注文に `has_unconfirmed_routings: bool` フラグを付与して返す。
- 製品に工程が0件 → `true`
- 1件でも `is_confirmed=false` → `true`
- 全工程が確定済み → `false`

#### `GET /orders/unconfirmed-routing-queue`

新規エンドポイント。`has_unconfirmed_routings=true` の draft 注文を `buffer_days`（希望納期 - 本日）昇順で返す。null 納期は末尾。

レスポンス形式:
```json
{
  "count": 3,
  "items": [
    {
      "order_id": 42,
      "order_no": "ORD-001",
      "product_name": "製品A",
      "buffer_days": 2,
      "desired_deadline": "2026-06-23",
      "unconfirmed_routing_count": 2
    }
  ]
}
```

### Frontend

| ファイル | 変更内容 |
|---|---|
| `types/order.ts` | `has_unconfirmed_routings?: boolean` を `Order` に追加 |
| `lib/order-utils.ts` | `StatusFilter` に `"unconfirmed_routing"` を追加、`filterOrder()` で処理 |
| `hooks/use-orders-page.ts` | `unconfirmedRoutingCount` を追加 |
| `components/orders/order-notification-cards.tsx` | アンバー系 STEP 3 カードを追加 |
| `hooks/use-unconfirmed-routing-queue.ts` | 新規フック（TanStack Query） |
| `app/page.tsx` | 5枚目 KPI カード「工程未確定」を追加（グリッドを `lg:grid-cols-5` に変更） |

---

## 工程未登録製品の注文入力フロー改善（Issue #208）

工程が1件も登録されていない製品に対してシミュレーションを実行した際、エラーではなく選択ダイアログを表示する。

### Backend の変更

| ファイル | 変更内容 |
|---|---|
| `app/scheduler_logic.py` | `RoutingUnconfirmedError` に `no_routing: bool = False` フィールドを追加。工程0件時は `ValueError` ではなく `RoutingUnconfirmedError(no_routing=True)` を送出 |
| `app/routers/transaction/orders.py` | `POST /orders/simulate` で `RoutingUnconfirmedError` を catch し、HTTP 200 + `{"routing_status": "no_routing", ...}` を返す |

### Frontend の変更

| ファイル | 変更内容 |
|---|---|
| `types/order.ts` | `OrderSimulateResponse` に `routing_status?: "no_routing" \| "unconfirmed"` を追加。`calculated_deadline` / `is_feasible` を nullable に変更 |
| `app/orders/new/page.tsx` | `routing_status === "no_routing"` 検出時に選択ダイアログを表示。Path A: `ProductRoutingsDialog` をインライン表示し工程登録後に自動再シミュレーション。Path B: `createMutation` で draft 保存後 `/orders` にリダイレクト |
| `components/simulation-result.tsx` | `calculated_deadline` が null の場合に null ガードを追加 |
| `components/orders/bulk-simulate-summary-dialog.tsx` | `calculated_deadline` が null の場合のフォールバック表示を追加 |

### フロー

```
シミュレーション実行（工程未登録製品）
  → routing_status: "no_routing"（HTTP 200）
  → 選択ダイアログ
      ├─ A: 工程を登録してから注文する
      │      → ProductRoutingsDialog を開く
      │      → ダイアログを閉じると自動再シミュレーション
      │      → 確定まで通常フローで完結
      └─ B: 下書きで保存する
             → draft 注文として保存
             → /orders にリダイレクト
             → 専門家キューに自動表示（has_unconfirmed_routings=true）
```

---

## 注文詳細画面のメッセージ区別（Issue #269）

注文詳細画面で、製品に工程が「1件も登録されていない」場合と「登録済みだが未確定」の場合を区別せず、どちらも「工程が設定されていません。製品マスタから工程を設定してください。」と表示していたため、実態と異なる誤解を招いていた。

### Backend の変更

| ファイル | 変更内容 |
|---|---|
| `app/repositories/supa_infra/transaction/order_repo.py` | `get_all_with_routing_status()` / `get_by_id_with_routing_status()` に `has_no_routings: bool` を追加。`has_unconfirmed_routings` は従来通り「工程0件 または 未確定あり」を表す |

`has_no_routings` は製品に工程が1件も登録されていない場合のみ `true`。`has_unconfirmed_routings` はそれに加えて「登録済みだが `is_confirmed=false` の工程が1件でもある」場合も `true` になる。

### Frontend の変更

| ファイル | 変更内容 |
|---|---|
| `types/order.ts` | `Order` に `has_no_routings?: boolean` を追加 |
| `app/orders/[id]/page.tsx` | `hasNoRouting`（工程0件）と `hasUnconfirmedRouting`（工程はあるが未確定）を分離。前者は「工程が設定されていません」、後者は「未確定の工程があります」とメッセージを出し分け |

---

## 製品マスタの工程確定状態表示（Issue #271）

製品マスタ一覧の「工程」列が「登録済み/未登録」の2状態のみで、工程が登録済みでも確定（`is_confirmed`）済みかどうかが分からなかった。3状態（未登録 / 未確定あり / 確定済み）に分けて表示するよう変更。

### Backend の変更

| ファイル | 変更内容 |
|---|---|
| `app/repositories/supa_infra/master/product_repo.py` | `get_all()` の `process_routings` select に `is_confirmed` を追加し、`has_unconfirmed_process: bool`（登録済み工程のうち未確定が1件でもあれば true）を新設 |

### Frontend の変更

| ファイル | 変更内容 |
|---|---|
| `types/product.ts` | `Product` に `has_unconfirmed_process: boolean` を追加 |
| `app/master/products/page.tsx` | 「工程」列を `未登録`（オレンジ） / `未確定あり`（アンバー） / `確定済み`（緑）の3状態表示に変更 |
| `hooks/use-products.ts` | `PRODUCTS_QUERY_KEY` を export し、他フックから製品一覧キャッシュを invalidate できるように変更 |
| `hooks/use-process-routings.ts` | 工程の作成・更新・削除時に `PRODUCTS_QUERY_KEY` も invalidate するよう修正（**バグ修正**: 従来は工程を追加/確定してもダイアログを閉じるまで製品一覧の状態バッジが更新されなかった） |

### E2E テスト（Playwright、新規導入）

`frontend/e2e/product-routing-status.spec.ts` で、製品マスタ上での工程未登録/未確定/確定済みの3状態表示をブラウザ経由で検証。ローカル実行専用（CI 未組み込み）。前提条件・実行方法は `frontend/e2e/README.md` を参照。
