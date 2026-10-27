# 生産スケジュール画面のガント（`/schedule`）

Epic #577。以降のサブ Issue はこのページに追記する。列位置の計算は [gantt-date-math.md](gantt-date-math.md) を参照。

## 構成（Issue #578: 固定ラベル列＋内部スクロール）

```
スクロールコンテナ（overflow: auto、親の高さに収まる） ← src/gantt の GanttChart
 ├ ヘッダー行（sticky top-0）
 │   ├ 角セル（sticky left-0、ラベル列の見出し）
 │   └ TimelineHeader（日付・時刻の目盛り）
 └ 本体
     └ 行 = ラベルセル（sticky left-0） ＋ タイムラインのグリッド
```

- ヘッダーと全行を**1つ**のスクロールコンテナに入れているので、縦スクロールの同期は不要
- 現在時刻の縦線は、タイムライン列の上にだけ重ねる絶対配置のレイヤー（`z-[5]`）に描く。
  重なり順は バー(1〜2) < 縦線(5) < ラベルセル(10) < ヘッダー(30)
- 同じ `rowId` のタスク（1工程の複数セグメント、#535 / #537）は1行・1ラベル

### `src/gantt`（汎用。ドメイン知識を入れない）

| props | 内容 |
|---|---|
| `renderRowLabel(rowTasks)` | ラベル列の各行の中身。未指定なら先頭タスクの `name` |
| `labelHeader` | 左上の角セルの中身 |
| `labelWidth` | ラベル列の幅（既定 260px） |
| `rowHeight` / `groupRowHeight` | 通常行／グループ行（`isGroupHeader`）の高さ。ラベルを2行にする行だけ高くできる |

- バーの外（右）には何も描かない（工程名・マイルストーンの名前とも）。`GanttTask.hideLabel` は廃止
- グループ行のバーは名前を描かない（`sr-only` のみ）。名前はラベル列に出す
- 日次（列幅 60px 固定）は横にあふれる。開いた直後に現在時刻付近へ横スクロールを合わせる。
  週次・月次は `1fr` の列で画面幅に収まり、横スクロールは出ない

### 画面（`components/schedule/gantt-chart.tsx`, `app/schedule/page.tsx`）

- ラッパーが `renderRowLabel` を渡す。この段階の中身は従来と同じ情報（注文番号・製品名／工程名・設備グループ名）
- ページは `h-[calc(100dvh-6.75rem)]`（レイアウトのヘッダー 3.75rem ＋ 上下余白 3rem を引いた高さ）で、
  ガントのカードが残りの高さを `flex-1 min-h-0` で受ける。`viewWidth` の決め打ちは廃止し、
  `min-w-0` でサイドバーの開閉に追従する。レイアウトのヘッダーや余白を変えたらこの高さも直す

## 注文行・工程行のラベルと見た目（Issue #579）

### API（`GET /production-schedules`）

レスポンスモデル `ProductionScheduleItem`（`backend/app/models/transaction/schedule.py`）。Frontend の `Schedule`（`types/schedule.ts`）と揃える。

| 項目 | 内容 |
|---|---|
| `quantity` / `order_status` / `customer_order_no` | 受注の数量・ステータス・顧客の注文番号 |
| `desired_deadline` | 希望納期。DB 列は `orders.deadline_date`（受注 API と同じく `desired_deadline` で返す） |
| `confirmed_deadline` | 完成見込み（承認確定時） |
| `customer_name` | 顧客不明（`customer_id` が NULL、#521）は null。表示側で「顧客不明」 |
| `sequence_order` | 工程順。オーダー別の工程行の並び順 |
| `equipment_group_id` / `equipment_group_name` | 表示名は、1台グループならメンバーの設備の表示名（グループ名は設備名・呼称の変更に追従しないため。#512） |
| `process_start/end_datetime` | その工程の全セグメントの開始の最小〜終了の最大（**表示期間外を含む**） |
| `order_start/end_datetime` | その受注の全工程の開始の最小〜終了の最大（**表示期間外を含む**） |

- API は表示期間と重なるセグメントしか返さないので、期間の外へ続くかは上の範囲で判定する。範囲は
  `ScheduleRepository._get_extents()` が表示中の受注の全セグメントを `fetch_all_rows()`（`max_rows` 対策）で読んで求める
- 時刻の大小は文字列ではなく `datetime` で比べる（小数秒の有無で文字列順が崩れうる）

### ラベル列

| 表示単位 | グループ行 | 工程行（1行目 / 2行目） |
|---|---|---|
| オーダー別 | 顧客名・製品名（太字、最大2行で省略）/ 数量・納期・注文番号 | 工程名 / 設備（グループ）の表示名。`sequence_order` 順 |
| 設備グループ別 | 設備グループの表示名（`equipment_group_id` でまとめる） | 顧客名・製品名 / 工程名。開始順 |
| フラット | なし | 顧客名・製品名 / 工程名。開始順 |

- 文言は `lib/schedule-label-utils.ts`。納期は「送品の消し込み」と同じ**希望納期 → 無ければ完成見込み**
  （`pickShippingDeadline()` を共有）で、完成見込みのときは「見込 M/d」と出して区別する。日付のみの列なので `parseISO()` でパースする
- 注文番号は `order_number` → `customer_order_no` → `#<内部ID>` の順
- 注文行の全文（長い製品名）はサマリーバーのツールチップで見られる（詳細シートは #581）

### 見た目（`src/gantt` の汎用機能）

| `GanttTask` | 内容 |
|---|---|
| `isGroupHeader` | 細いサマリーバー（高さ 8px の梁＋両端の脚のブラケット形、`data-summary-bar`）。工程のバー（h-7）と太さで区別する。行は背景付き |
| `parentId` | 子行。ラベルをインデントし、グループを折りたたむと隠れる |
| `continuesBefore` / `continuesAfter` | 表示範囲の外へ続く印（外向きの三角）。サマリーバーは脚の代わりに、工程バーは内側に白で描く |

- 折りたたみは `GanttChart` の `collapsedGroupIds` / `onToggleGroup`（制御コンポーネント）。状態は
  `components/schedule/gantt-chart.tsx` の `useState` で持ち、ラベル列の見出しに「すべて展開／すべて折りたたむ」を出す
- 注文行のサマリーバーは注文全体（`order_start/end_datetime`）に張り、範囲外はグリッドの端で切れる。工程の「続き」は、
  週次・月次（同じ工程のセグメントを1行に並べる）では工程全体の範囲で、日次（1セグメント1行）ではそのセグメント自身で判定し、
  行の最初・最後のバーに付ける
- 注文行の高さは 60px（1行目が2行に折り返しても2行目が収まる）、設備グループ行は 36px
- E2E（`frontend/e2e/gantt-order-labels.spec.ts`）で 1180×820 と 1920×1080 のスクリーンショットを撮る
