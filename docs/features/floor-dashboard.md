# 現場ダッシュボード（大型ディスプレイ向け）

## 背景と目的

50インチ以上の大型ディスプレイをホワイトボード脇に設置し、常時表示する専用ダッシュボード。
既存の管理画面ダッシュボード（`/`、サイドバー付き、ロール別パーソナライズ。Epic #399）とは目的が異なり、
常時表示・大きめフォント・自動更新前提のフルスクリーン画面として新設した（Epic #437、本Issueは基盤部分の #440）。

後続Issueで検索/フィルタを `FloorDashboardLayout` の中に差し込んでいく（KPIサマリーカードは #441、顧客別受注情報エリアは #442、出荷予定表エリアは #443 で実装済み）。

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
| `frontend/src/lib/floor-dashboard-utils.ts` | `IN_PRODUCTION_STATUSES` / `getEffectiveDeadline()` / 納期状態判定 `getDeadlineStatus()` / 残日数 `getDaysRemaining()`（Issue #442。検索・フィルタ #444 の凡例と閾値を共有する想定で `use-floor-dashboard-metrics.ts` からも参照） |
| `frontend/src/components/floor-dashboard/CustomerOrderList.tsx` | 顧客別受注情報エリア。`groupOrdersByCustomer()`（純粋関数）＋表示コンポーネント（Issue #442） |
| `frontend/src/components/floor-dashboard/DeadlineBadge.tsx` | 納期状態バッジ（納期超過／残りN日／予定通り。Issue #442） |
| `frontend/src/components/floor-dashboard/ShipmentScheduleList.tsx` | 出荷予定表エリア。`groupSchedulesByShipmentDate()`（純粋関数）＋表示コンポーネント（Issue #443） |
| `frontend/src/components/floor-dashboard/UnreportedActualBadge.tsx` | 実績「未報告」固定バッジ（フェーズ2 #438 で差し替え予定。Issue #443） |
| `frontend/src/hooks/use-schedules.ts` | 既存の `useSchedules()` を出荷予定表エリアでも再利用（変更なし） |
| `frontend/src/lib/floor-dashboard-utils.ts` | `toJstDateIso()`（timestamptz → JST日付）／`addDaysToIsoDate()`のexport化／`SHIPMENT_SCHEDULE_WINDOW_DAYS` を追加（Issue #443） |

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

- **顧客別受注情報エリアの対象スコープ（Issue #442）**: KPIサマリー（#441）と同じく `status` が
  `confirmed` / `in_progress`（`IN_PRODUCTION_STATUSES`、`floor-dashboard-utils.ts` に集約）の受注のみを対象にする。
  Issue本文で「`pending_approval` を含めるかは要確認」とされていたが、`pending_approval` は計画納期
  （`confirmed_deadline`）がまだ確定していない（承認前）ため、KPIの「受注中」定義と揃えて対象外とした
- **納期状態バッジの判定ロジックの共有先**: `getDeadlineStatus(deadline, todayIso)`（`overdue` / `due_soon` /
  `on_track` を返す純粋関数）と、残日数を計算する `getDaysRemaining()` を `lib/floor-dashboard-utils.ts` に
  切り出した。検索・フィルタ（凡例。Issue #444）から閾値がズレないよう同じ関数を再利用する前提で設計している。
  閾値は `DEADLINE_DUE_SOON_THRESHOLD_DAYS`（7日）の1箇所のみで管理する
- **納期状態の判定基準**: 表示納期は KPI と同様 `confirmed_deadline ?? simulated_deadline`
  （`getEffectiveDeadline()`）。日付のみの文字列同士の比較のため、TZ変換を挟まず文字列比較・UTC固定の
  日付演算（`Date.UTC` ベース）で行い、端末TZの影響を受けないようにしている
- **製品名のフォールバック**: 既存の `getProductDisplayParts()`（`order-utils.ts`）をそのまま再利用。
  `product_id` が未確定でも `extracted_product_name`（「〇〇（製品未確定）」表記）で表示できる
- **グルーピング・並び順**: 顧客ごとにグループ化し、グループは顧客名（`getCustomerDisplayName()`、通称優先）の
  50音順、各グループ内の注文は納期の早い順（未設定は末尾）に並べる。`customer_id` が無い受注は「顧客未設定」
  グループにまとめる（本来 `confirmed` / `in_progress` では稀だが、データ不整合時にサイレントに消さない）
- **テスト用MSWデフォルトハンドラの追加**: `GET /customers` のデフォルトハンドラが無かったため
  `test-utils/msw/handlers.ts` に `sampleCustomers` ＋ハンドラを追加した（`GET /products` の `sampleProducts` と
  同じ構成）。個別テストは従来どおり `server.use()` で上書き可能

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

## 完了条件（Issue #442）

- [x] 受注が顧客ごとにグループ化されて表示される
- [x] 各行に製品名・計画数量・納期が表示される
- [x] 納期に応じて3色のバッジ（納期超過／残りN日／予定通り）が正しく表示される
- [ ] 検索・フィルタと連動して絞り込める（検索・フィルタ本体は #444 で実装。本Issueでは連動できる構造を残すのみ）
- [x] `npx tsc --noEmit` / `npm run lint` がエラーなく通ること

## 完了条件（Issue #443）

- [x] 出荷予定が日付ごとにグループ化されて表示される
- [x] 各行に製品名・設備名・計画数量が表示される
- [x] 各行に固定で「実績未報告」バッジが表示される
- [ ] 検索・フィルタと連動して絞り込める（検索・フィルタ本体は #444 で実装）
- [x] `npx tsc --noEmit` / `npm run lint` がエラーなく通ること

- **「最終工程の完了予定日」の求め方**: `GET /production-schedules` は工程（`process_routing`）単位の
  レコードを返す（1注文につき複数行）。Issue本文の「最終工程の完了予定日でグルーピング」は、
  取得期間内に含まれる同一 `order_id` の行のうち `end_datetime` が最も遅いものを最終工程とみなして
  求めている（`groupSchedulesByShipmentDate()`）。取得期間の外側に本当の最終工程がある場合
  （期間の境界をまたぐ受注）は正しく求まらない既知の制約で、フェーズ1では許容している
- **表示は1行＝1注文**: 各行の設備名は最終工程で使用する設備、計画数量は工程ごとではなく
  注文（`orders.quantity`）そのものを表示する。数量はスケジュール側に無いため `orders` 一覧
  （ページで既に取得済み）を `order_id` で突き合わせて取得する
- **取得期間**: Issue本文で「本日以降 N 日間」が要確認とされていたため、暫定で本日（JST）〜13日後
  （14日間）とした（`SHIPMENT_SCHEDULE_WINDOW_DAYS`、`floor-dashboard-utils.ts`）。長すぎる／短すぎる
  場合は後続Issueで調整する
- **対象スコープ**: `orders` に一致する注文が見つかる場合は `IN_PRODUCTION_STATUSES`
  （confirmed / in_progress。KPI・顧客別受注情報と同じ定義）以外を除外する。一致しない場合
  （データ不整合等）はスケジュール側の非正規化データ（`product_name` 等）のみでフォールバック表示する
  （「ないものをあるように見せない」原則で、サイレントに行を消さない）
- **JSTでの日付グルーピング**: `end_datetime` は時刻・TZ付きのタイムスタンプ（timestamptz）のため、
  `new Date()` で正しくパースできるが、暦日への丸めは端末TZ依存になる。`toJstDateIso()`
  （`jstTodayIso()` と同じ `en-CA` ロケール変換）で Asia/Tokyo 基準に固定した
  （CLAUDE.md 日付の「今日」判定の方針に準拠）
- **実績「未報告」バッジの設計**: `UnreportedActualBadge` は props を持たない固定表示のみ。
  フェーズ2（実績入力、#438）でコンポーネントごと差し替える前提のため、`actualQuantity` のような
  未実装のロジックを先回りして作り込まない方針とした（Issue本文の過剰設計回避の指示どおり）
- **常時表示画面での自動更新（PR #448 Copilotレビュー指摘）**: `useOrders` は `refetchInterval` を
  受け取れるが `useSchedules` には無く、出荷予定表だけ自動更新されない（日付ウィンドウも日付跨ぎで
  進まない）状態だった。`useSchedules(params, options)` に `useOrders` と同じ `{ refetchInterval }`
  オプションを追加し、`floor-dashboard/page.tsx` から `KpiSummaryCards` 等と同じ `REFETCH_INTERVAL_MS`
  （5分）を渡すようにした
- **最終工程判定は `Date` 比較で行う（PR #448 Copilotレビュー指摘）**: `end_datetime` の大小判定を
  ISO文字列の辞書順比較で行うと、タイムゾーンオフセット表記や小数秒の有無など文字列フォーマットの
  差异で誤判定しうる。`new Date(a) > new Date(b)` に変更した。あわせて `orders?.find()` を注文ごとに
  呼ぶと件数の2乗の計算量になるため、事前に `Map<number, Order>` 化してから参照するようにした
- **JST日付グルーピングのテスト（PR #448 Copilotレビュー指摘）**: `toJstDateIso()` は要件の中心のため、
  UTC日付境界を跨いで JST では翌日になるケース（例: `2026-09-10T15:30:00Z` → JST `2026-09-11`）を
  ユニットテストで固定し、端末TZや実装変更による回帰を防ぐようにした

## 関連

- Epic: [#437](https://github.com/HyperGenius/product-planner/issues/437)
- Issue: [#440](https://github.com/HyperGenius/product-planner/issues/440)（基盤）
- Issue: [#441](https://github.com/HyperGenius/product-planner/issues/441)（KPIサマリーカード）
- Issue: [#442](https://github.com/HyperGenius/product-planner/issues/442)（顧客別受注情報エリア）
- Issue: [#443](https://github.com/HyperGenius/product-planner/issues/443)（出荷予定表エリア）
- Issue: [#444](https://github.com/HyperGenius/product-planner/issues/444)（検索・フィルタ。本Issueの納期状態判定ロジックを共有する予定）
