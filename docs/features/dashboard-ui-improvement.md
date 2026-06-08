# ダッシュボード UI 改善・ナビゲーション日本語化 計画

## 背景と目的

現在のダッシュボードおよびサイドバーナビゲーションは英語表記が残っており、
中小製造業の生産管理者（現場・事務所勤務）が直感的に操作できない状態にある。

本改善では以下の 2 点を同時に実施する。

1. **ナビゲーション全項目の日本語化** — 英語ラベルを現場用語に合わせた日本語へ統一
2. **ダッシュボードの大幅デザイン改善** — KPI の視認性・情報量・視覚的完成度を向上

---

## 対象ファイル

| ファイル | 変更内容 |
|---|---|
| `frontend/src/components/layout/app-sidebar.tsx` | メニュー項目を日本語化、グループラベル変更 |
| `frontend/src/components/layout/authenticated-layout.tsx` | ヘッダーの "Dashboard" をルートに応じた動的タイトルへ変更 |
| `frontend/src/app/page.tsx` | ダッシュボード全体のリデザイン |

---

## 1. ナビゲーション日本語化

### 変更マッピング

| 現在（英語） | 変更後（日本語） | 備考 |
|---|---|---|
| `Navigation`（グループラベル） | `メニュー` | SidebarGroupLabel |
| `Dashboard` | `ダッシュボード` | トップページ |
| `Orders` | `受注管理` | 製造業らしい用語 |
| `Schedule` | `生産スケジュール` | ガントチャート画面 |
| `Master Data` | `マスタデータ` | 親メニュー |
| `Products` | `製品マスタ` | サブメニュー |
| `Customers` | `顧客マスタ` | サブメニュー |
| `Equipments` | `設備マスタ` | サブメニュー |
| `Equipment Groups` | `設備グループ` | サブメニュー |
| `Work Calendar` | `稼働カレンダー` | サブメニュー |
| `Settings` | `設定` | 親メニュー |
| `Members` | `メンバー管理` | サブメニュー |

### Collapsible の defaultOpen 条件

`item.title` の比較を日本語変更後の値に合わせて更新する必要がある（現在は英語で条件分岐）。

```tsx
// 変更前
defaultOpen={
  (item.title === "Master Data" && pathname.startsWith("/master")) ||
  (item.title === "Settings" && pathname.startsWith("/settings"))
}

// 変更後
defaultOpen={
  (item.title === "マスタデータ" && pathname.startsWith("/master")) ||
  (item.title === "設定" && pathname.startsWith("/settings"))
}
```

### ヘッダーの動的タイトル

`authenticated-layout.tsx` の `<div className="font-semibold">Dashboard</div>` を、
現在のパスに対応する日本語タイトルを返すユーティリティに置き換える。

```tsx
// ページタイトルマッピング（authenticated-layout.tsx 内に定義）
const pageTitleMap: Record<string, string> = {
  "/": "ダッシュボード",
  "/orders": "受注管理",
  "/schedule": "生産スケジュール",
  "/master/products": "製品マスタ",
  "/master/customers": "顧客マスタ",
  "/master/equipments": "設備マスタ",
  "/master/equipment-groups": "設備グループ",
  "/master/calendar": "稼働カレンダー",
  "/settings/members": "メンバー管理",
}
```

---

## 2. ダッシュボード デザイン改善

### 2-1. ヘッダーセクション

**現状**: シンプルな h1 + サブテキスト

**改善後**:
- 今日の日付を右側に表示（例: `2026年6月8日（月）`）
- サブテキストを `今日の生産状況` など具体的な表現へ

```tsx
<div className="mb-8 flex items-start justify-between">
  <div>
    <h1 className="text-3xl font-bold tracking-tight">ダッシュボード</h1>
    <p className="text-muted-foreground mt-1">今日の生産状況をご確認ください</p>
  </div>
  <div className="text-right text-sm text-muted-foreground">
    <p>{format(new Date(), "yyyy年M月d日（E）", { locale: ja })}</p>
  </div>
</div>
```

### 2-2. KPI カード（上段）

**現状**: 2 枚（今日の納期、Draft 未確定）のみ

**改善後**: 4 枚に拡張し、アイコン・カラーを整理

| カード | データソース | アイコン | アクセントカラー |
|---|---|---|---|
| 今日の納期 | `confirmed_deadline` が今日の注文数 | `Clock` | `blue` |
| 未確定注文 | `status === "draft"` の件数 | `FileText` | `orange` |
| 確定済み注文 | `status === "confirmed"` の件数 | `CheckCircle` | `green` |
| 今週の受注 | 今週作成された注文の件数 | `TrendingUp` | `purple` |

各カードのデザイン仕様:
- ボーダーあり、`shadow-sm`
- 上部にカラーラインアクセント（`border-t-4 border-t-blue-500` など）
- アイコンを右上に配置（現在と同様）
- 件数下に補足テキスト（例: `前日比 +2件` ）は将来拡張用として `—` で仮置き

### 2-3. クイックアクション

**現状**: カード内に単一ボタン

**改善後**: 2 ボタン構成で頻度高い操作を並列配置

| ボタン | 遷移先 | スタイル |
|---|---|---|
| 新規注文を入力する | `/orders/new` | Primary (filled) |
| 生産スケジュールを確認する | `/schedule` | Outline |

### 2-4. 最新の注文リスト

**現状**: フラットなリスト、ステータスバッジが `bg-primary/10` 一色

**改善後**:
- ステータスバッジを色分け: `draft` → 黄 / `confirmed` → 緑 / `in_progress` → 青 / `completed` → グレー
- 注文番号に `→` リンクを追加して詳細画面へ遷移可能にする
- 空状態のデザインをアイコン付きで改善

ステータスバッジ色定義（`getStatusLabel` は既存の `@/lib/order-utils` を流用）:

```tsx
const statusBadgeClass: Record<string, string> = {
  draft: "bg-yellow-100 text-yellow-800",
  confirmed: "bg-green-100 text-green-800",
  in_progress: "bg-blue-100 text-blue-800",
  completed: "bg-gray-100 text-gray-700",
}
```

---

## 実装順序

1. `app-sidebar.tsx` のメニュータイトル・グループラベルを日本語化（Collapsible 条件も合わせて修正）
2. `authenticated-layout.tsx` のヘッダーを動的タイトルに変更
3. `page.tsx` を改善版ダッシュボードへ書き換え

---

## 検証方法

1. `cd frontend && npm run dev` でローカル起動
2. サイドバーの全メニュー項目が日本語表示されていることを確認
3. 各メニューをクリックし、ヘッダータイトルがページに合わせて切り替わることを確認
4. マスタデータ・設定の折りたたみが正常に動作することを確認
5. ダッシュボードの 4 枚の KPI カードが正しい件数を表示していることを確認（注文データが存在する状態で）
6. 注文リストのステータスバッジが色分けされていることを確認
7. クイックアクションの 2 ボタンがそれぞれ正しいページへ遷移することを確認
