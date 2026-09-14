# 現場ダッシュボード（大型ディスプレイ向け）

## 背景と目的

50インチ以上の大型ディスプレイをホワイトボード脇に設置し、常時表示する専用ダッシュボード。
既存の管理画面ダッシュボード（`/`、サイドバー付き、ロール別パーソナライズ。Epic #399）とは目的が異なり、
常時表示・大きめフォント・自動更新前提のフルスクリーン画面として新設した（Epic #437、本Issueは基盤部分の #440）。

後続Issueで KPI・検索/フィルタ・顧客別受注情報・出荷予定表を `FloorDashboardLayout` の中に差し込んでいく。

## 対象ファイル

| ファイル | 役割 |
|---|---|
| `frontend/src/app/floor-dashboard/page.tsx` | ルートページ。`useOrders()` を自動更新間隔付きで呼び出し、最終更新時刻を子に渡す |
| `frontend/src/components/floor-dashboard/FloorDashboardLayout.tsx` | フルスクリーン用の器（サイドバー・通常ヘッダー無し） |
| `frontend/src/components/floor-dashboard/FloorDashboardHeader.tsx` | 画面タイトル＋最終更新時刻 |
| `frontend/src/components/floor-dashboard/FloorDashboardPhaseBanner.tsx` | 「フェーズ1: 計画データのみ表示中」注記バナー |
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

## 完了条件（Issue #440）

- [x] `/floor-dashboard` にアクセスすると専用レイアウトの画面が表示される（サイドバー無し、フルスクリーン）
- [x] ヘッダーに画面タイトル・最終更新時刻・フェーズ1の注記バナーが表示される
- [x] 一定間隔（5分）でデータが自動再取得され、最終更新時刻が更新される
- [x] 後続Issue（KPI・検索/フィルタ・顧客別受注情報・出荷予定表）を差し込める構造になっている
- [x] `npx tsc --noEmit` / `npm run lint` がエラーなく通ること

## 関連

- Epic: [#437](https://github.com/HyperGenius/product-planner/issues/437)
- Issue: [#440](https://github.com/HyperGenius/product-planner/issues/440)
