# 受注管理画面 UI 設計ガイド

受注管理画面（`/orders`）を「ユーザーの関心ごとベース」で再設計する際の設計思想・改善方針・実装パターンをまとめる。

---

## 設計の基本方針

受注管理は「今何をすべきか」が常にわかる画面を目指す。マスタ管理が「探して編集する」操作主体であるのに対し、受注管理は「未対応の受注を見つけて次の行動を取る」ことが主体。

1. **関心ごとを先に見せる** — 画面上部に「対応が必要な受注」のサマリーを表示し、一覧を下にスクロールする前に状況を把握できるようにする
2. **欠けた情報を促す** — 入力が任意のフィールド（顧客・希望納期）が未設定の注文は警告を表示し、補完を促す
3. **次のアクションを文脈で変える** — 注文のステータス・シミュレーション実行状況に応じて表示するボタンを変える
4. **確定納期を永続化する** — シミュレーション確定時に算出された生産完了予定日を `confirmed_deadline` として保存し、一覧で参照できるようにする

---

## 現状の課題

| 課題 | 詳細 |
|---|---|
| 確定ボタンのみ | 下書き注文への操作が「確定」しかない。再シミュレーション・編集ができない |
| 欠損情報が見えない | 顧客未設定・希望納期未設定の注文が視覚的に区別されない |
| 確定納期が保存されない | confirm 実行後に生産完了予定日が DB に残らず、一覧で確認できない |
| ステータスフィルターなし | draft/confirmed/completed/canceled を絞り込む手段がない |
| 注文の編集手段がない | 一度作成した注文を修正するには API を直接叩くしかない |

---

## 注文一覧ページ改善設計 (`/orders`)

### ページ構成

```
[ページヘッダー] 受注管理                     [+ 新規注文]

┌─────────────────────────────────────────────────────────┐
│  アテンションカード（サマリー）                          │
│  ┌─────────────────────┐  ┌────────────────────────────┐│
│  │ 下書き               │  │ 情報不足                   ││
│  │ 3件 未確定           │  │ 2件（顧客・希望納期 未設定）││
│  │ [下書きを見る]       │  │ [確認する]                 ││
│  └─────────────────────┘  └────────────────────────────┘│
└─────────────────────────────────────────────────────────┘

[ステータスフィルター: すべて | 下書き | 確定済 | 完了 | キャンセル]

[注文テーブル]

[ページネーション]
```

### アテンションカード

画面上部に 2 枚のサマリーカードを並べる。

**カード1: 下書き件数**
- `status === 'draft'` の件数を表示
- クリックでステータスフィルターを「下書き」に絞り込み

**カード2: 情報不足件数**
- `customer_id === null` または `desired_deadline === null` の件数を表示（ステータス問わず）
- クリックでフィルターを「情報不足」に絞り込み

件数が 0 の場合はカードを非表示にする（画面を圧迫しない）。

### ステータスフィルター

URL クエリパラメータ `?status=` で管理（マスタ画面と同じパターン）。

| フィルター値 | 表示ラベル | 対象 |
|---|---|---|
| (なし) | すべて | 全注文 |
| `draft` | 下書き | status='draft' |
| `confirmed` | 確定済 | status='confirmed' |
| `incomplete` | 情報不足 | customer_id IS NULL OR desired_deadline IS NULL |
| `completed` | 完了 | status='completed' |
| `canceled` | キャンセル | status='canceled' |

### テーブル設計

| 列 | 表示内容 | 補足 |
|---|---|---|
| 注文番号 | order_no | |
| 製品 | 製品コード - 製品名 | |
| 顧客 | 顧客名 / ⚠ 未設定 | 未設定時は警告アイコン + `text-muted-foreground` |
| 数量 | quantity | |
| 希望納期 | desired_deadline の日付 / ⚠ 未設定 | 未設定時は警告アイコン |
| 確定納期 | confirmed_deadline の日付 / — | 確定前は `—` |
| ステータス | バッジ（色分け） | 下記参照 |
| 操作 | プライマリボタン + ケバブメニュー | 下記参照 |

**ステータスバッジ配色**

| ステータス | ラベル | バッジカラー |
|---|---|---|
| `draft` | 下書き | `bg-yellow-100 text-yellow-800` |
| `confirmed` | 確定済 | `bg-green-100 text-green-800` |
| `completed` | 完了 | `bg-blue-100 text-blue-800` |
| `canceled` | キャンセル | `bg-gray-100 text-gray-500` |

### アクション体系

注文の状態によってプライマリアクションを切り替える。

| 状態 | プライマリボタン | ケバブメニュー |
|---|---|---|
| `draft` かつ `is_scheduled=false` | シミュレーション実行 | 編集 / 削除 |
| `draft` かつ `is_scheduled=true` | 確定 | 再シミュレーション / 編集 / 削除 |
| `confirmed` | (なし) | 詳細確認 / 削除 |
| `completed` | (なし) | 詳細確認 |
| `canceled` | (なし) | 削除 |

**シミュレーション実行**（`POST /orders/{order_id}/simulate`）の結果は、行展開またはサイドシート（右側パネル）で表示する。シミュレーション結果を確認後、「この内容で確定」ボタンで confirm へ移行する。

### 入力不足の警告表示

```tsx
// 顧客未設定
{!order.customer_id && (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger>
        <AlertCircle className="h-3 w-3 text-yellow-500" />
      </TooltipTrigger>
      <TooltipContent>顧客が設定されていません</TooltipContent>
    </Tooltip>
  </TooltipProvider>
)}
```

---

## 新規注文ページ改善設計 (`/orders/new`)

### ステップ表示

現在はフォームとシミュレーション結果が横並びになっているが、「何をするべきか」が分かりにくい。ステップインジケーターで手順を明示する。

```
① 注文情報入力  →  ② シミュレーション実行  →  ③ 確認・確定
```

各ステップのアクティブ状態：
- ① 初期表示時はアクティブ
- ② シミュレーション実行後にアクティブ
- ③ シミュレーション結果が出たらアクティブ（確定ボタンが有効化）

### 入力フォームの改善

**必須フィールドのマーキング**

```tsx
<Label htmlFor="order_no">
  注文番号 <span className="text-destructive">*</span>
</Label>
```

必須: 注文番号・製品・数量  
任意（ただし推奨）: 顧客・希望納期

**任意フィールドへの促し**

希望納期が空のままシミュレーション実行ボタンを押した場合、インラインヒントを表示する：

```
ℹ 希望納期を入力すると、納期に間に合うかどうかを判定できます
```

顧客が未設定の場合も同様のヒントを表示。

### 確定前確認画面

シミュレーション結果が表示された後、確定ボタンを押す前に以下の情報をサマリー表示する：

- 注文番号・製品・数量
- 希望納期 vs 確定納期（計算値）
- 間に合う / 間に合わない のバッジ
- 未入力フィールドの警告（「このまま確定しますか？」）

---

## 注文編集ダイアログ（新規追加）

一覧ページのケバブメニュー「編集」から開くダイアログ。マスタ管理と同じ Dialog パターンを使用。

### 編集可能フィールド

| フィールド | 編集可否 | 備考 |
|---|---|---|
| 注文番号 | ✅ | ユニーク制約あり |
| 製品 | ✅ | 変更後は is_scheduled をリセット |
| 顧客 | ✅ | |
| 数量 | ✅ | 変更後は is_scheduled をリセット |
| 希望納期 | ✅ | |
| ステータス | ❌ | 専用操作（確定・キャンセル）経由 |

**製品・数量を変更した場合の注意**
スケジュール計算結果が無効になる。変更後は「再シミュレーションが必要です」の警告を表示し、is_scheduled を false にリセットする。

エンドポイント: `PATCH /orders/{order_id}`（実装済み）

---

## バックエンド追加事項

### `confirmed_deadline` カラム追加

現在、注文確定時にスケジュール計算で算出された「生産完了予定日」が注文テーブルに保存されていない。

**マイグレーション**

```sql
-- supabase/migrations/YYYYMMDD000000_add_confirmed_deadline_to_orders.sql
ALTER TABLE orders ADD COLUMN confirmed_deadline date;
```

**confirm エンドポイントの更新**

`POST /orders/{order_id}/confirm` の処理に以下を追加：

```python
# schedules の最終終了日時から confirmed_deadline を算出
last_end = max(s["end_datetime"] for s in result)
confirmed_deadline = datetime.fromisoformat(last_end).date().isoformat()

order_repo.update(
    order_id,
    {
        "status": "confirmed",
        "is_scheduled": True,
        "confirmed_at": datetime.now(UTC).isoformat(),
        "confirmed_deadline": confirmed_deadline,  # 追加
    },
)
```

**Pydantic スキーマ**

`backend/app/models/transaction/order_schema.py` の `OrderResponse` に `confirmed_deadline: str | None = None` を追加。

### キャンセルエンドポイント（将来対応）

現在 `status='canceled'` への変更は `PATCH /orders/{order_id}` で `{"status": "canceled"}` を送れば可能だが、専用エンドポイント `POST /orders/{order_id}/cancel` を追加すると、キャンセル時の副作用（スケジュール削除等）を整理しやすい。現時点では PATCH で対応。

---

## 実装パターン

### URL クエリパラメータ

マスタ画面と統一した管理。

```tsx
const searchParams = useSearchParams()
const router = useRouter()

// ステータスフィルター変更
const params = new URLSearchParams(searchParams.toString())
params.set("status", newStatus)
router.push(`?${params.toString()}`)
```

| パラメータ | 用途 | 例 |
|---|---|---|
| `?status=` | ステータスフィルター | `?status=draft` |
| `?page=` | ページ番号 | `?page=2` |
| `?sort=` | ソートキー | `?sort=created_at` |

### フィルター実装パターン

```tsx
const PAGE_SIZE = 20

// フィルター（サマリーカードのカウントにも使用）
const draftOrders = useMemo(() =>
  orders?.filter(o => o.status === 'draft') ?? [], [orders])

const incompleteOrders = useMemo(() =>
  orders?.filter(o => !o.customer_id || !o.desired_deadline) ?? [], [orders])

// 表示用フィルター
const filteredOrders = useMemo(() => {
  if (!orders) return []
  return orders.filter(order => {
    if (statusFilter === 'incomplete') return !order.customer_id || !order.desired_deadline
    if (statusFilter) return order.status === statusFilter
    return true
  })
}, [orders, statusFilter])

// ページスライス
const pagedOrders = useMemo(() => {
  const offset = (page - 1) * PAGE_SIZE
  return filteredOrders.slice(offset, offset + PAGE_SIZE)
}, [filteredOrders, page])
```

### `useUpdateOrder` フック追加

`frontend/src/hooks/use-orders.ts` に追加：

```tsx
export function useUpdateOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<OrderCreate> }) =>
      apiClient.patch(`/orders/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] })
    },
  })
}
```

---

## フロントエンド コード構成

### orders/page.tsx リファクタリング後の構成 (#130)

`page.tsx` の肥大化（645行）を解消するため、責務ごとにファイルを分割。

```
frontend/src/
  app/orders/
    page.tsx                              # エントリーポイント（~160行）
  components/orders/
    edit-order-dialog.tsx                 # 注文編集ダイアログ
    delete-order-dialog.tsx               # 削除確認 AlertDialog
    order-notification-cards.tsx          # 下書き/情報不足サマリーカード
    orders-filter-bar.tsx                 # ステータスタブ + ソートセレクト
    order-table-row.tsx                   # テーブル行 + Sim展開行
  hooks/
    use-orders-page.ts                    # URL state・データ取得・ハンドラー一式
  lib/
    order-utils.ts                        # filterOrder / compareOrders / 定数・型
```

**`use-orders-page.ts` が提供する値**

| カテゴリ | 主な内容 |
|---|---|
| URL state | `statusFilter`, `sortKey`, `page`, `setParam()` |
| データ | `orders`, `products`, `customers`, `isLoading` |
| 派生値 | `draftCount`, `incompleteCount`, `filteredOrders`, `pagedOrders` |
| ダイアログ state | `selectedOrder`, `deleteTargetOrder`, `expandedOrderId`, `expandedSimResult` |
| ハンドラー | `handleSimulate`, `handleConfirmFromRow`, `handleOpenEditDialog`, `handleConfirmDelete`, `closeSimResult` |

---

## 実装状況

| 機能 | 優先度 | 状況 |
|---|---|:---:|
| confirmed_deadline カラム追加 | 高 | ❌ 未実装 |
| confirm エンドポイントの confirmed_deadline 保存 | 高 | ❌ 未実装 |
| 一覧ページ: アテンションカード | 高 | ✅ 実装済 (#113) |
| 一覧ページ: ステータスフィルター（タブ形式） | 高 | ✅ 実装済 (#114) |
| 一覧ページ: ソート（登録日・希望納期） | 高 | ✅ 実装済 (#114) |
| 一覧ページ: ページネーション (PAGE_SIZE=20) | 低 | ✅ 実装済 (#114) |
| 一覧ページ: 入力不足の警告表示（Tooltip付き） | 高 | ✅ 実装済 (#115) |
| 一覧ページ: ステータスバッジのカラーコード化 | 高 | ✅ 実装済 (#115) |
| 一覧ページ: アクション体系の整備（is_scheduled連動） | 高 | ✅ 実装済 (#115) |
| 一覧ページ: シミュレーション結果の行内展開 | 高 | ✅ 実装済 (#115) |
| 一覧ページ: AlertDialogによる削除確認 | 高 | ✅ 実装済 (#115) |
| 注文編集ダイアログ | 中 | ✅ 実装済 (#116) |
| 新規注文: 3ステップインジケーター | 中 | ✅ 実装済 (#117) |
| 新規注文: 入力促進ヒント | 中 | ✅ 実装済 (#117) |
| 新規注文: 確定前サマリー表示 | 中 | ✅ 実装済 (#117) |
| 一覧ページ: コード分割リファクタリング | - | ✅ 実装済 (#130) |
| キャンセル専用エンドポイント | 低 | ❌ 未実装 |
