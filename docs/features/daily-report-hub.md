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
| `/master/daily-reports/customers` | 前提: アプリに未登録の日報の顧客先ごとのまとまり（その顧客先の製品を含む）・顧客先が空欄・対象外の日報の製品（#703） | まとまりは「顧客先」、空欄・対象外の製品は「品名」 |
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
| 製品（顧客先が未登録・空欄・対象外） | 前提 | ①②③には数えない。未登録の顧客先の製品はその顧客先のまとまりに入れて別に数えず、空欄・対象外の顧客先の製品だけを「品名」で数える（#703） |
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

### 前提のページの顧客先のまとまり（Issue #703）

前提の表記は `groupProductsByCustomerRaw()`（`lib/daily-report-name-utils.ts`）で顧客先の表記ごとにまとめ、
`classifyDailyReportWorklist()` の `prerequisite.groups` に入れる。ページ（`components/daily-report-names/customer-raw-groups.tsx`）は
このまとまりだけを描く。

| まとまり | 中身 | 操作 | 件数 |
|---|---|---|---|
| `unregistered`（未登録の顧客先） | 顧客先の表記＋その顧客先の製品（製品が無い顧客先も出す） | 顧客先に [顧客を選択]・対象外。製品は対象外だけ | バナー・見出しの「n顧客先」＝まとまりの数 |
| `ignored`（対象外にした顧客先） | 未登録の顧客先の一覧に無い顧客先の製品 | 製品は対象外だけ | 「顧客先が空欄・対象外の日報の製品」の「n品名」 |
| `blank`（顧客先が空欄） | `customer_raw` が null の製品 | 製品は対象外だけ | 同上 |

- 顧客先は割り付けで受注の顧客と比べるので、製品の行が無い顧客先もまとまりとして出して数える
- 製品の顧客先が未登録の一覧に無い（`customer_id` が null）のは、バックエンドの `list_unmatched_names()` が対象外にした顧客先を返さないため
- 顧客を選ぶと、確認ダイアログ（#645）を経て `POST /daily-reports/name-aliases/customer` で顧客の別名を登録する。`["daily-report-names"]` の
  無効化で一覧を取り直すと、その顧客先の製品は `customer_id` が付いて①へ移る。トーストは「顧客先「…」を顧客Aに結び付けました」＋
  「n品名を製品に結び付けられるようになりました」（品名の数は登録前のまとまりから数える。0品名なら出さない）と、①のページへ移るアクション
- まとまりの中の製品の行には顧客先（見出しに出している）も、結び付けられない理由の文章も出さない
- 行の部品は `UnmatchedNameRow` を使い回す（`showCustomerRaw={false}`・見出しの品名の数 `summary`・トーストを差し替える `onMapped`）

## 件数の表示

- `useDailyReportWorklist(months)`（`hooks/use-daily-report-worklist.ts`）をハブと各ページで共有する。件数は `WorkCount`（`lib/work-count.ts`。
  送品の消し込みと共通）で、取得中は「－」、失敗は「取得できませんでした」にし、途中の件数を出さない
- 作業が0件のキューは消さずに小さく「済み」と出す（名寄せは一巡すると開く頻度が下がるので、一巡したことが分かるように）
- ②は製品と工程名の単位が違うので足さず、「2製品」の下に「日報の工程名 1工程名」と並べる

## 文言

UI文言ガイドライン（[docs/ui-writing-guidelines.md](../ui-writing-guidelines.md)）に従い、仕組み・判定条件・期間・反映のタイミングはヘルプ
（`components/daily-reports/daily-report-help.tsx`）に書く。行ごとに繰り返していた「顧客先「…」を先に「顧客」で対応付けてください」は出さず、
前提のページで顧客先ごとにまとめ、顧客先は見出しに1回だけ出す（#703）。

### 行・ダイアログの文言（Issue #702）

#707 で各ページに移した部品（表記の行・確認ダイアログ・受注の表・登録済みの対応付け・対象外・③・作り置きの指摘）の文言を
ガイドラインに合わせた。

| 箇所 | 修正前 | 修正後 |
|---|---|---|
| 表記の行の件数 | 7 件 | 7明細（日報の明細の数） |
| 行を開いたときの明細の表 | 新しい順に 10 件を表示しています（全 30 件） | 全30明細のうち新しい10明細 |
| 確認ダイアログ（対応付け） | 過去・今後の日報にも自動で反映されます（集計は10〜15分ごと）。 | （削除。ヘルプへ） |
| 確認ダイアログ（対象外） | 未照合の一覧に出なくなります。元に戻すには「対象外」タブから解除します。 | （削除。対象外にしたときのトーストに「元に戻す」を付ける） |
| 製品の受注の警告 | この顧客に、この製品の確定済み・生産中の受注がありません。割り付け先がないため、実績は未割当に残ります。 | この顧客にこの製品の受注がありません／この顧客のこの製品の受注は承認前です |
| 確認ダイアログの受注の見出し | 割り付け先の受注（n 件） | この製品の受注（n注文） |
| 受注の表のバッジ | 割り付け対象外 | （削除。状態の列に「下書き」「承認待ち」と出ているので重ねない） |
| 展開部の受注の見出し | この顧客の未出荷の受注（n 件） | この顧客の未出荷の受注（n注文） |
| 似ている製品のボタン | 受注あり n件、`title` に類似度 | 受注あり n注文、`title` は直近の希望納期だけ |
| 類似度 n%（ダイアログ・ピッカー） | 類似度 82% | （削除。ピッカーの似ている製品にも品番を添える） |
| 登録済みの対応付け（製品） | 製品の別名はメール起票と共通です（顧客ごと）。変更・削除はメール起票の照合にも反映されます。 | （削除。ヘルプへ） |
| 対応付けの削除の確認 | …照合できなくなった表記は未照合キューに戻ります。 | 「…」の対応付けを削除します。（行き先はヘルプへ） |
| 重複のエラー | この表記は既に登録されています（「登録済みの対応付け」で変更できます） | この表記は既に対応付けてあります（「登録済みの対応付け」で変更できます） |
| ③の空表示 | 割り付けできなかった実績はありません | 確かめる製造はありません |
| 作り置きの指摘 | 次の集計（10〜15分ごと）で推定に反映されます。／いつの時点の数か／数を入れると、その日の作業を終えた時点の数として… | （説明を削除してヘルプへ。トーストの「次の集計で反映されます」は残す）／数えた日（作業の後） |

- 種別のカード（`KindTabsList`）の件数は、#707 で作業の件数をハブに移してから使われていなかったので props ごと外した
  （登録済みの対応付けの種別の切り替えにだけ使う）
- 対象外の取り消しは、トーストのアクションから `DELETE /daily-reports/ignored-names/{id}`（登録のレスポンスの `id`）を呼ぶ。
  対象外にした行は一覧から消えて unmount するので、`mutate` のコールバックではなく `mutateAsync()` の結果でトーストを出す
- ヘルプ（`DailyReportHelp`）には、製品は顧客ごとに結び付けること・メール起票と共通なこと・承認前の受注の扱い・並び順（明細の多い順）・
  対象外の戻し方・対応付けの削除後の行き先・作り置きの実際の数の扱いを足した

## テスト

- 振り分け: `lib/daily-report-worklist-utils.test.ts`
- 画面に出さない語: `DAILY_REPORT_FORBIDDEN_UI_TEXT`（`test-utils/daily-report.ts`。送品の消し込みの `FORBIDDEN_UI_TEXT` に
  「割り付け・未割当・類似度・キュー」を足したもの）を、ハブ・各ページ（`pages.test.tsx`）・表記の行・対象外・登録済みの対応付けのテストで検査する
- ハブ・各ページ・旧 URL: `app/master/daily-reports/pages.test.tsx`
- 前提のページのまとまり: `lib/daily-report-name-utils.test.ts`（`groupProductsByCustomerRaw()`）・
  `components/daily-report-names/customer-raw-groups.test.tsx`（顧客を選ぶと①へ移り、トーストで知らせる）
- 見た目: `e2e/daily-report-hub.spec.ts`（API は `page.route()` の固定応答。スクリーンショットは `frontend/test-results/daily-report-hub/`）
