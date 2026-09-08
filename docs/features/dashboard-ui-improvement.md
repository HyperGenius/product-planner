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

---

## 3. ロール別ダッシュボードへの分割（Issue #401）

Epic #399 の一環として、巨大化した `app/page.tsx` を `components/dashboard/` 配下の
ロール別コンポーネントに分割し、`president` だけ別レイアウトへ段階的に切り替えられる
フックポイントを用意した。**このリファクタでは表示・挙動を変えていない。**

### コンポーネント構成

| ファイル | 役割 |
|---|---|
| `app/page.tsx` | `<DashboardRouter />` を描画するだけ |
| `components/dashboard/DashboardRouter.tsx` | `useCurrentMember().role` で分岐。`"president"` → `PresidentDashboard`、それ以外・ロール未取得（ローディング）中は `DefaultDashboard` をフォールバック。`useOrders()` / `useProducts()` / `useDashboardMetrics()` はここで1回だけ呼び、結果を props で各ダッシュボードへ渡す（ロール判明時の再マウントで再フェッチさせないため） |
| `components/dashboard/DefaultDashboard.tsx` | 現行ダッシュボードそのまま（承認待ちバナーは非表示）。表示専用 |
| `components/dashboard/PresidentDashboard.tsx` | president 向けの器。承認待ちキューカード＋KPI＋クイックアクション＋最新の注文。表示専用 |
| `components/dashboard/DashboardHeader.tsx` | ページヘッダー（タイトル＋当日日付）。両ダッシュボード共通 |
| `components/dashboard/KpiCards.tsx` | KPI カード 4 枚のグリッド。`buildKpiCards()` で定義を組み立て |
| `components/dashboard/ApprovalQueueCard.tsx` | 承認待ちキューカード（Issue #402）。旧 `PendingApprovalBanner`（件数のみ）を置換。`PresidentDashboard` のみで使用 |
| `components/dashboard/QuickActions.tsx` | クイックアクション 2 ボタン |
| `components/dashboard/RecentOrders.tsx` | 最新の注文リスト（最大 5 件） |
| `hooks/use-dashboard-metrics.ts` | `useDashboardMetrics(orders)` で集計値（`todayDueCount` / `draftOrdersCount` / `pendingApprovalCount` / `confirmedOrdersCount` / `weeklyOrdersCount` / `recentOrders`）を導出 |

### 後続 Issue との関係

- KPI の中身の差し替え → #ISSUE_D
- 承認待ちのキュー化 → #402（実装済み。下記「4.」参照）
- リスクカード → #ISSUE_C

いずれも `PresidentDashboard` および `components/dashboard/` 配下のパーツに差し込む。

### 検証方法（追加分）

1. `president` でログインし `PresidentDashboard`（承認待ちキューカードあり）が描画されること
2. `president` 以外でログイン、およびロール取得中は `DefaultDashboard` が描画されること
3. KPI・クイックアクション・最新の注文の表示・遷移が従来と変わらないこと
4. `npx tsc --noEmit` / `npm run lint` がエラーなく通ること

---

## 4. 承認待ちキューカード（Issue #402）

`PresidentDashboard` の「承認待ちバナー」（件数のみ表示）を、承認待ち注文の
**実リストを出すキューカード**へ置き換えた。社長がログイン直後に「誰から・いつ・
何の承認を頼まれているか」を把握し、そのまま承認へ進めるようにする。

### Frontend

| ファイル | 変更内容 |
|---|---|
| `components/dashboard/ApprovalQueueCard.tsx` | 新規。`orders` prop（`DashboardRouter` が 1 回だけ取得した全ステータスの注文一覧）を `status === "pending_approval"` で絞り込んで描画。0 件・ロード中は何も描画しない（旧バナー踏襲） |
| `components/dashboard/PresidentDashboard.tsx` | `PendingApprovalBanner` を `ApprovalQueueCard` へ差し替え。`orders` prop を追加 |
| `components/dashboard/DashboardRouter.tsx` | `PresidentDashboard` へ `orders` を渡す |
| `components/dashboard/PendingApprovalBanner.tsx` | 削除（唯一の利用箇所だった `PresidentDashboard` から外れたため） |
| `types/order.ts` | `Order` に `approval_requested_at` / `approval_requested_by` / `approval_requested_by_name` を追加 |

各行の表示: 注文番号 / 製品名 × 数量 / 希望納期（`desired_deadline`）/ シミュ納期
（`simulated_deadline`、Issue #394）/ 依頼者 / 依頼からの経過時間
（`formatDistanceToNow`）。`simulated_deadline > desired_deadline` の行は
`isDeadlineOverdue()`（`lib/order-utils.ts`、#394-B と同じ判定）で「納期遅延」を
強調する。`simulated_deadline` 未算出の行は「シミュ納期なし」表示・遅延判定なし。
依頼者・依頼日時が NULL（既存の pending_approval 注文）の行は「依頼者不明」/
「依頼時刻不明」でフォールバックする。

導線: 行クリック → `/orders/{id}`、見出し／フッターボタン →
`/orders?status=pending_approval`（既存の一括承認画面）。

### Backend

| ファイル | 変更内容 |
|---|---|
| `supabase/migrations/20260909000000_add_approval_requested_to_orders.sql` | `orders.approval_requested_at timestamptz` / `orders.approval_requested_by uuid REFERENCES auth.users(id)` を追加。既存の `pending_approval` 注文は `order_approval_log` の最新 `request_approval` 行からバックフィル |
| `routers/transaction/orders.py` `request_order_approval` | `orders` の上記 2 カラムを `request-approval` 実行時に更新（監査ログ `order_approval_log` とは別に非正規化） |
| `routers/transaction/orders.py` `reject_order` / `withdraw_order_approval` | `draft` へ戻す際に 2 カラムを NULL クリア |
| `routers/transaction/orders.py` `get_orders` | `_attach_approval_requester_names()` で `approval_requested_by`（auth.users.id）から `profiles` を 1 クエリで引き、`full_name` → なければ `email` を `approval_requested_by_name` として付与。依頼者のいない注文は `null` |

依頼者名は `order_approval_log` 経由でも取得できるが、ダッシュボード表示のたびに
ログテーブルを join するのを避けるため `orders` へ非正規化する方針。

### 検証方法（追加分）

1. `order_handler` で下書き注文の承認依頼を送信 → `orders.approval_requested_at` /
   `approval_requested_by` が更新されること
2. `president` のダッシュボードに承認待ちキューカードが表示され、各行に依頼者・
   経過時間・シミュ納期・遅延強調（`simulated_deadline > desired_deadline` の行）が出ること
3. 行クリックで注文詳細、見出しから一括承認画面へ遷移できること
4. 承認待ち 0 件のときカードが非表示になること
5. `president` が差し戻し（reject）／`order_handler` が取り下げ（withdraw）すると
   2 カラムが NULL に戻ること
