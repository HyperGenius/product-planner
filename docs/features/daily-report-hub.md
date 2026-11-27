# 日報の実績のハブ（Issue #707、Epic #701）

旧「日報の名寄せ」（`/master/daily-report-names`、#489 / #643）と「日報の照合状況」（`/master/daily-report-coverage`、#542 / #639）を、
利用者が**次に何をするか**の順に並べた1つのハブにまとめた。「名寄せ」は仮称で、ページ名はハブの名前（仮称「日報の実績」）にする。
構成の前例は送品の消し込みのハブ（#692 / #693、[shipment-file-import.md](shipment-file-import.md)）。

Backend は変更していない。ハブは既存の API（`GET /daily-reports/unmatched-names`・`GET /daily-reports/coverage`・
`GET /daily-reports/stock-estimates`）の結果をフロントで振り分ける。どれも1回ずつしか呼ばないので、件数だけの API は足していない。

## ページと URL

| URL | 中身 | 件数の単位 |
|---|---|---|
| `/master/daily-reports` | ハブ（前提バナー・作業のキュー①②③・参考） | － |
| `/master/daily-reports/customers` | 前提: アプリに未登録の日報の顧客先・顧客先が決まっていない日報の製品 | 顧客先は「件」、製品は「品名」 |
| `/master/daily-reports/products` | ① 日報の製品をつなぐ | 品名（(顧客先, 商品名) の組） |
| `/master/daily-reports/processes` | ② 製品の工程を日報に合わせる（製品の行＋工程マスタに無い日報の工程名） | 製品（工程名は「工程名」で別に数える） |
| `/master/daily-reports/unordered` | ③ 受注の無い製造を確かめる | 件（(製品, 工程名, 理由) のまとまり） |
| `/master/daily-reports/stock` | 参考: 作り置き（推定） | 製品（推定は (製品, 工程) ごとに出るので製品の数） |
| `/master/daily-reports/aliases` | 参考: 登録済みの対応付け・対象外・日報の設備（管理のためのページ） | － |

- ページの外枠は `DailyReportPageLayout`（`components/daily-reports/daily-report-page-layout.tsx`。ハブへ戻るリンク・件数付きの見出し・
  ヘルプ `DailyReportHelp`・データの鮮度「日報 11/25 09:15」）。一覧は `ListPageLayout` の残りの高さでスクロールする
- マスタのタブ（`app/master/constants.ts`）・サイドバーは「日報の実績」1つ。マスタのタブはハブ配下のページでも選択中にする
  （`app/master/layout.tsx` は `pathname.startsWith(href + "/")` も選択中にする）
- ②③のページには加工日の期間（既定は直近3か月）がある。ハブの②③の件数は既定の期間で数える

### 旧 URL

`components/daily-reports/legacy-redirect.tsx` が `router.replace` で移す。ハッシュはハイドレーションの後でないと読めないので、
`useLocationHash()` ではなくエフェクトの中で `window.location.hash` を読む（`useLocationHash()` は最初にサーバーの値 `""` を返し、
先にハブへ移ってしまう）。

| 旧 URL | 移り先 |
|---|---|
| `/master/daily-report-names` | ハブ |
| `/master/daily-report-coverage#unallocated` | ③ |
| `/master/daily-report-coverage#routing` | ② |
| `/master/daily-report-coverage#stock` | 作り置き |
| `/master/daily-report-coverage#unmatched`・ハッシュなし・知らない値 | ハブ |

他の画面からのリンク（送品の消し込みの「日報が未入力の出荷済み注文」の原因の見出し、`lib/shipping-review-utils.ts`）も新しい URL に直した。

## 分類ルール

振り分けは純粋関数 `classifyDailyReportWorklist()`（`lib/daily-report-worklist-utils.ts`）。日報の表記・未割当のまとめは、
前提・①②③・対象外の**どれか1か所にだけ**置く（テストの `expectEachPlacedOnce()`）。ハブの件数と各ページの行は必ずこの結果から出す。
行き先・見出し・単位の定数も同じファイルに置く。

### 日報の表記（`GET /daily-reports/unmatched-names`）

| 表記 | 行き先 | 理由 |
|---|---|---|
| 顧客先 | 前提 | 顧客先が決まらないと製品を結び付けられない（製品の別名は顧客単位） |
| 製品（顧客先が決まっている） | ① | |
| 製品（顧客先が未登録・空欄・対象外） | 前提 | ①②③には数えない |
| 工程 | ② | 表記→工程名はテナント共通。#708 で製品単位の入口にするまで②のページに一覧を置く |
| 設備 | 対象外 | 割り付けに使わない。#709 で設備マスタ側へ移すまで、登録済みの対応付けのページの「日報の設備」タブに置く |

### 未割当のまとめ（`GET /daily-reports/coverage` の `groups`）

| 分類 | 行き先 |
|---|---|
| `no_routing_process`（工程ルートに無い工程・工程ルートが無い製品） | ②（製品ごとにまとめる。`groupProcessProducts()`） |
| `untracked_process`（日報で追わない工程に実績がある） | ②（直す先が同じ製品の工程ルートのため） |
| それ以外（`other_customer_order` / `unapproved_order` / `closed_order_only` / `no_order` / `before_order_date` / `stocked` / `exceeds_order_qty` / `no_work_date`） | ③（今の分類のまま。どれを残すかは #706 で本番のデータを見て決める） |

- ③のページの絞り込みの既定は「すべて」（見出しの件数と行数を一致させる）。「要確認」等で絞れる
- 照合状況の割り付け済み・未割当・未照合の割合は、ハブの参考「受注に結び付いた実績」に3色のバーで出す（振り分けの対象ではない）

## 件数の表示

- `useDailyReportWorklist(months)`（`hooks/use-daily-report-worklist.ts`）をハブと各ページで共有する。件数は `WorkCount`（`lib/work-count.ts`。
  送品の消し込みと共通）で、取得中は「－」、失敗は「取得できませんでした」にし、途中の件数を出さない
- 作業が0件のキューは消さずに小さく「済み」と出す（名寄せは一巡すると開く頻度が下がるので、一巡したことが分かるように）
- ②は製品と工程名の単位が違うので足さず、「2製品」の下に「日報の工程名 1工程名」と並べる

## 文言

UI文言ガイドライン（[docs/ui-writing-guidelines.md](../ui-writing-guidelines.md)）に従い、仕組み・判定条件・期間・反映のタイミングはヘルプ
（`components/daily-reports/daily-report-help.tsx`）に書く。行ごとに繰り返していた「顧客先「…」を先に「顧客」で対応付けてください」は出さず、
前提のページの見出し（顧客先が決まっていない日報の製品）に1回だけ置く。各ページの行の中の文言（「未照合」等）の見直しは #702。

## テスト

- 振り分け: `lib/daily-report-worklist-utils.test.ts`
- ハブ・各ページ・旧 URL: `app/master/daily-reports/pages.test.tsx`
- 見た目: `e2e/daily-report-hub.spec.ts`（API は `page.route()` の固定応答。スクリーンショットは `frontend/test-results/daily-report-hub/`）
