# マスタ管理画面 設計ガイド

製品マスタ（`/master/products`）を基準実装として、他のマスタ画面をリファクタリングする際の設計思想・実装パターンをまとめる。

---

## 設計の基本方針

マスタ画面は「特定レコードを探して編集する」操作が主体。この前提から以下を方針とする。

1. **URL に状態を持つ** — 検索・フィルター・ソート・ページをクエリパラメータで管理し、リロードや共有 URL で状態が復元される
2. **操作に摩擦を持たせる** — データ変更（特に影響範囲が広い操作）は確認モーダルを経由させる
3. **権限でUIを制御する** — 編集操作は `admin` ロールのみ表示する
4. **共通コンポーネントを再利用する** — 幅制限・ページネーションは共通実装を使用し、個別ページには書かない

---

## ディレクトリ構成

```
frontend/src/
  app/master/
    layout.tsx                  # 全マスタページ共通: max-w-[860px] 幅制限
    page.tsx                    # マスタトップ（カード一覧）
    products/page.tsx           # 基準実装（最も機能が揃っている）
    customers/page.tsx
    equipments/page.tsx
    equipment-groups/page.tsx
    calendar/page.tsx           # 例外: カレンダー専用UI、幅制限のみ適用

  components/
    master-pagination.tsx       # 共通ページネーション
```

---

## 共通コンポーネント

### `master/layout.tsx` — コンテンツ幅制限

```tsx
<div className="max-w-[860px] w-full mx-auto px-6">
  {children}
</div>
```

- すべてのマスタページに自動適用される（layout による継承）
- **個別ページで `container mx-auto` を書かない**。`py-10` だけ書く

### `MasterPagination` — ページネーション

```tsx
import { MasterPagination } from "@/components/master-pagination"

// テーブルの直後に配置
<MasterPagination totalCount={filteredItems.length} pageSize={PAGE_SIZE} />
```

- `totalCount <= pageSize` のときは何も表示しない（条件分岐不要）
- `?page=N` クエリパラメータで制御。既存の `?sort=` `?status=` と共存する
- `PAGE_SIZE = 20` を各ページで定数定義する

---

## URL クエリパラメータ

マスタページの状態はすべて URL に保持する。

| パラメータ | 対象 | 例 |
|---|---|---|
| `?sort=` | ソートキー | `?sort=product_code` |
| `?page=` | ページ番号（1始まり） | `?page=2` |
| `?status=` | ステータスフィルター（必要なページのみ） | `?status=active` |

### URL 操作の実装パターン

```tsx
const searchParams = useSearchParams()
const router = useRouter()

// 変更時: 既存パラメータを保持しつつ1つだけ上書き
const params = new URLSearchParams(searchParams.toString())
params.set("sort", newValue)
router.push(`?${params.toString()}`)
```

> **注意**: `router.push` ではなく `router.replace` を使うと履歴スタックを汚染しないが、ブラウザバックが使えなくなるためマスタ画面では `push` を採用している。

---

## フィルター・ソート・ページネーションの実装パターン

`useMemo` を 2 段階に分ける:

```tsx
const PAGE_SIZE = 20

// 第1段階: フィルタ + ソート（全件）
const filteredItems = useMemo(() => {
  if (!items) return []
  return items
    .filter((item) => { /* 検索・ステータスフィルタ */ })
    .sort((a, b) => { /* ソートキーによる比較 */ })
}, [items, searchQuery, statusFilter, sortKey])

// 第2段階: ページスライス
const pagedItems = useMemo(() => {
  const offset = (page - 1) * PAGE_SIZE
  return filteredItems.slice(offset, offset + PAGE_SIZE)
}, [filteredItems, page])
```

- `filteredItems.length` を `MasterPagination` の `totalCount` に渡す（フィルタ後の件数でページ数を計算するため）
- テーブルには `pagedItems` を渡す

---

## ソート

ソート可能なカラムが少ない場合は、カラムヘッダークリックではなくツールバーのセレクトボックスを使用する。

```tsx
type SortKey = "created_at" | "name" | ...

const SORT_OPTIONS: { label: string; value: SortKey }[] = [
  { label: "並び順: 登録順", value: "created_at" },
  ...
]
```

- デフォルトは `created_at`（登録順）
- ソート比較は `localeCompare` を使用し、`undefined` / `null` は `|| ""` でフォールバックする

```tsx
(a.name || "").localeCompare(b.name || "")
```

---

## 権限制御

`useCurrentMember` フックで現在のユーザーのロールを取得し、`admin` のみ編集操作を表示する。

```tsx
import { useCurrentMember } from "@/hooks/use-tenant-members"

const { data: currentMember } = useCurrentMember()
const isAdmin = currentMember?.role === "admin"

// ケバブメニュー内
{isAdmin && (
  <DropdownMenuItem onClick={...}>削除</DropdownMenuItem>
)}
```

- `admin` / `member` の 2 種類（`frontend/src/types/member.ts`）
- `member` ロールは一覧の閲覧のみ。作成・編集・削除・状態変更は非表示
- 削除ボタンは `isAdmin` で制御するが、ケバブメニュー自体は全ユーザーに表示してもよい（「詳細を見る」など閲覧系操作を入れる場合）

---

## ダイアログパターン

### 基本（CRUD）

各操作ごとに独立した `Dialog` を用意する。状態は `useState` でページコンポーネントが管理する。

```tsx
const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
const [selectedItem, setSelectedItem] = useState<Item | null>(null)
```

### 削除確認ダイアログ

```tsx
<Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>XXXの削除</DialogTitle>
      <DialogDescription>
        本当に「{selectedItem?.name}」を削除しますか？この操作は取り消せません。
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>キャンセル</Button>
      <Button variant="destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>
        {deleteMutation.isPending ? "削除中..." : "削除"}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### 影響範囲がある操作のモーダル（例: 有効/無効切り替え）

操作が他のデータに波及する場合、影響範囲を説明するテキストをモーダルに含める。

```tsx
<DialogDescription asChild>
  <div>
    <p>「{item?.name}」を無効化しますか？</p>
    <p className="mt-2">無効化すると新規受注時の製品選択に表示されなくなります。</p>
    <p>既存の受注・生産計画には影響しません。</p>
  </div>
</DialogDescription>
```

---

## ケバブメニュー（⋮）の構成

```tsx
<DropdownMenuContent align="end">
  <DropdownMenuItem onClick={() => handleOpenEditDialog(item)}>編集</DropdownMenuItem>
  {/* 追加の閲覧系操作があればここに */}
  {isAdmin && (
    <DropdownMenuItem onClick={() => handleOpenToggleActiveDialog(item)}>
      {item.is_active ? "無効化" : "有効化"}
    </DropdownMenuItem>
  )}
  <DropdownMenuSeparator />
  {isAdmin && (
    <DropdownMenuItem className="text-destructive" onClick={() => handleOpenDeleteDialog(item)}>
      削除
    </DropdownMenuItem>
  )}
</DropdownMenuContent>
```

- 破壊的操作（削除）は `DropdownMenuSeparator` で区切る
- 破壊的操作は `className="text-destructive"` で赤色表示

---

## 状態表示（is_active）

`is_active` を持つエンティティの状態表示は以下のパターンを統一する。

```tsx
import { Circle } from "lucide-react"

<div className="flex items-center gap-2">
  <Circle className={`h-2 w-2 fill-current ${item.is_active ? "text-green-500" : "text-gray-400"}`} />
  <span className="text-sm">{item.is_active ? "有効" : "無効"}</span>
</div>
```

---

## 各ページのリファクタリング状況

| ページ | 幅制限 | ソート | ページネーション | 権限制御 | 状態変更モーダル |
|---|:---:|:---:|:---:|:---:|:---:|
| `products` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `customers` | ✅ | ❌ | ❌ | ❌ | — |
| `equipments` | ✅ | ❌ | ❌ | ❌ | — |
| `equipment-groups` | ✅ | ❌ | ❌ | ❌ | — |
| `calendar` | ✅ | — | — | ❌ | — |

> `—` は当該機能が設計上不要なページ。

---

## リファクタリング手順（他ページへの適用）

1. `container mx-auto` の除去を確認（layout.tsx が適用済みなら `py-10` のみ残す）
2. `useSearchParams` + `useRouter` を追加し、`?sort=` `?page=` を URL 管理に移行
3. `useMemo` を filter/sort と pageSlice の 2 段に分割
4. `MasterPagination` をテーブル直後に追加
5. `useCurrentMember` を使用し `isAdmin` で編集操作を制御
6. `is_active` を持つエンティティは状態変更を確認モーダル経由に変更
