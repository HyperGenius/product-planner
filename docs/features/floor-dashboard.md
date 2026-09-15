# 現場ダッシュボード（大型ディスプレイ向け）

## 背景と目的

50インチ以上の大型ディスプレイをホワイトボード脇に設置し、常時表示する専用ダッシュボード。
既存の管理画面ダッシュボード（`/`、サイドバー付き、ロール別パーソナライズ。Epic #399）とは目的が異なり、
常時表示・大きめフォント・自動更新前提のフルスクリーン画面として新設した（Epic #437、本Issueは基盤部分の #440）。

後続Issueで検索/フィルタ・顧客別受注情報・出荷予定表を `FloorDashboardLayout` の中に差し込んでいく（KPIサマリーカードは #441 で実装済み）。

## 対象ファイル

| ファイル | 役割 |
|---|---|
| `frontend/src/app/floor-dashboard/page.tsx` | ルートページ。`useOrders()` を自動更新間隔付きで呼び出し、最終更新時刻・KPI集計結果を子に渡す |
| `frontend/src/components/floor-dashboard/FloorDashboardLayout.tsx` | フルスクリーン用の器（サイドバー・通常ヘッダー無し） |
| `frontend/src/components/floor-dashboard/FloorDashboardHeader.tsx` | 画面タイトル＋最終更新時刻 |
| `frontend/src/components/floor-dashboard/FloorDashboardPhaseBanner.tsx` | 「フェーズ1: 計画データのみ表示中」注記バナー |
| `frontend/src/components/floor-dashboard/KpiSummaryCards.tsx` | KPIサマリーカード（受注中件数・納期超過件数・本日出荷予定件数。Issue #441） |
| `frontend/src/hooks/use-floor-dashboard-metrics.ts` | KPI集計ロジック。`computeFloorDashboardMetrics()`（純粋関数）＋ `useFloorDashboardMetrics()` フック（Issue #441） |
| `frontend/src/components/layout/authenticated-layout.tsx` | `/floor-dashboard` 配下をフルスクリーン扱いする分岐を追加 |
| `frontend/src/hooks/use-orders.ts` | `useOrders()` に `{ refetchInterval }` オプションを追加（既存呼び出しは省略可、後方互換） |

## 実装メモ

- **サイドバー無しレイアウトの実現方法**: `frontend/src/app/layout.tsx` はサーバーコンポーネントで、
  ログイン済みなら常に `AuthenticatedLayout` で `children` をラップする構造になっている。専用ルートを
  新設する他の方法（`app/floor-dashboard` 配下だけ別の root layout にする等）もあったが、Next.js の
  App Router で `app/floor-dashboard/layout.tsx` を足しても親の `app/layout.tsx` は必ず適用されるため
  根本的な回避にはならない。今回は `AuthenticatedLayout`（クライアントコンポーネントで `usePathname()` を
  既に使っている）に `FULLSCREEN_ROUTE_PREFIXES` によるパス判定を追加し、該当パスでは `children` をそのまま
  返す形にした。今後フルスクリーン画面を増やす場合はこの配列にプレフィックスを追記する
- **最終更新時刻の連動**: 要件は「データ取得成功時刻に連動」。TanStack Query の `useQuery` が返す
  `dataUpdatedAt`（成功時のみ更新されるタイムスタンプ）をそのまま使えば `onSuccess` 等の追加実装は不要
- **自動更新間隔**: Issue 本文で「5分（要検討）」とされていたため一旦 5分（`REFETCH_INTERVAL_MS`）で実装。
  後続Issueで負荷や体感を見て調整する
- **認証**: この画面専用の認証方式は用意していない。既存のログインセッションをそのまま利用する
  （「大型ディスプレイに紐づくブラウザで一度ログインしたままにしておく」運用を想定。共有端末PIN認証
  [Issue #342](https://github.com/HyperGenius/product-planner/issues/342) とは別の話）
- **フルスクリーン判定のルートセグメント境界**: `AuthenticatedLayout` の `FULLSCREEN_ROUTE_PREFIXES` 判定は
  単純な `pathname.startsWith(prefix)` だと `/floor-dashboard-old` のような無関係なルートまで巻き込む。
  `pathname === prefix || pathname.startsWith(prefix + "/")` でセグメント境界を明示すること（PR #445 Copilotレビュー指摘）
- **データ取得失敗時の表示**: 常時表示画面のため、`useOrders()` が失敗し続けても最終更新時刻表示が
  「取得中...」のまま固まっていると、現場側が通信断・認証切れに気づけない。`FloorDashboardHeader` は
  `isError` を受け取り、取得失敗時は「データ取得に失敗しました」（`text-destructive`）に切り替える
  （PR #445 Copilotレビュー指摘）。`refetchInterval` は失敗時も継続してリトライされるため、追加の
  リトライ制御は不要

- **KPI集計のスコープ（Issue #441）**: 3枚のKPIカード（受注中件数・納期超過件数・本日出荷予定件数）は
  すべて「受注中」（`status` が `confirmed` / `in_progress`）を母集団とする。Issue本文では「本日出荷予定」
  （`confirmed_deadline` が本日）の定義に明示的な絞り込み条件が無かったが、`shipped` / `completed`（出荷・完了
  済み）や `canceled` の受注は `confirmed_deadline` が過去のまま残るため、他の2指標と同様に受注中スコープに
  絞らないと「出荷済みなのに本日出荷予定に数える」ような誤カウントが起こるため、3指標とも受注中スコープに統一した。
- **納期フィールドの優先順位**: `overdueCount`（納期超過）は `confirmed_deadline ?? simulated_deadline`
  （CLAUDE.md の受注の納期フィールド方針どおり、承認確定前は `simulated_deadline` にフォールバック）で判定する。
  一方 `todayShippingCount`（本日出荷予定）は `confirmed_deadline` のみを見る（Issue本文の「`confirmed_deadline`
  が本日の件数」という定義どおり。未確定の受注は確定した納期が無いため「出荷予定」に含めない）
- **「今日」の判定**: `jstTodayIso()`（`frontend/src/lib/order-utils.ts`、Issue #372 で導入済み）をそのまま再利用。
  `computeFloorDashboardMetrics(orders, todayIso)` を純粋関数として切り出し、`today` の文字列注入だけでシステム
  時刻に依存せずユニットテストできるようにした（`use-dashboard-metrics.ts` の構成を踏襲）。`useFloorDashboardMetrics()`
  は毎レンダーで `jstTodayIso()` を呼び直す（`useMemo` の空配列キャッシュにしない）。常時表示画面のため、
  日付が変わった後も次の自動更新（5分間隔）で「今日」の判定が追随するようにするため
- 日付のみのフィールド（`confirmed_deadline` 等）同士の前後比較は、ISO 8601 形式（`"YYYY-MM-DD"`）が辞書順＝
  時系列順に一致することを利用し、`Date` オブジェクト化せず文字列比較のみで行っている（TZ変換によるズレの
  リスクそのものを無くすため）

## 完了条件（Issue #440）

- [x] `/floor-dashboard` にアクセスすると専用レイアウトの画面が表示される（サイドバー無し、フルスクリーン）
- [x] ヘッダーに画面タイトル・最終更新時刻・フェーズ1の注記バナーが表示される
- [x] 一定間隔（5分）でデータが自動再取得され、最終更新時刻が更新される
- [x] 後続Issue（KPI・検索/フィルタ・顧客別受注情報・出荷予定表）を差し込める構造になっている
- [x] `npx tsc --noEmit` / `npm run lint` がエラーなく通ること

## 完了条件（Issue #441）

- [x] 3枚のKPIカード（受注中件数・納期超過件数・本日出荷予定件数）が正しい件数を表示する
- [x] 「今日」判定が日付のみフィールドのTZズレを起こさず正しく動く（ユニットテストでシステム時刻を固定して検証）
- [x] `cd frontend && npm run test` で新規テストがパスすること

## 関連

- Epic: [#437](https://github.com/HyperGenius/product-planner/issues/437)
- Issue: [#440](https://github.com/HyperGenius/product-planner/issues/440)（基盤）
- Issue: [#441](https://github.com/HyperGenius/product-planner/issues/441)（KPIサマリーカード）
