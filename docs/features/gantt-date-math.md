# ガントチャート date-math ユーティリティ

## 概要

`frontend/src/gantt/utils/date-math.ts` は、ガントチャートのグリッド列計算を担うユーティリティモジュール。週次モード（稼働時間スロットあり）と月次・日次モード（均一グリッド）で異なる計算パスを使用する。

## 均一グリッド（月次・日次）の列計算

| 値 | 計算方法 | 備考 |
|---|---|---|
| `colStart` | `floor((start - rangeStart) / unitDurationMs) + 1` | 開始時刻を**含む**列 |
| `colEnd` | `ceil((end - rangeStart) / unitDurationMs) + 1` | 排他の終了線。最小1列幅を保証 |

開始列を切り上げにしていた時期は、月次（1列＝1日）で 09:00 開始のセグメントが翌日の列に描かれ、1日後ろにずれていた（#537）。
日次（1列＝1時間）は○時ちょうどの開始ならずれないので目立たなかった。`getMilestoneGridColumn()` も同じ丸め（切り捨て）にする。
稼働時間スロット（週次）の開始列は `binarySearchFirstGe`（開始以降の最初のスロット）のままで、16:50 開始が翌稼働日 09:00 の列になる件は別件（未対応）。

## 稼働時間スロットモード（週次）

`buildWorkingSlots()` で生成したスロット配列（各稼働時間の開始 Date）を基に、`getTaskGridColumnsFromSlots()` がバイナリサーチでグリッド列位置を算出する。

### 列計算の仕様

| 値 | 計算方法 | 備考 |
|---|---|---|
| `colStart` | `binarySearchFirstGe(slots, taskStartMs) + 1` | タスク開始以降の最初のスロット |
| `colEnd` | `binarySearchFirstGe(slots, taskEndMs) + 1` | タスク終了**以降**の最初のスロット（の手前までを塗る） |

`colEnd` は CSS Grid の終了線（排他）なので、終了時刻ちょうどに始まるスロットは塗らない。前工程の終了と後工程の開始が
同じ時刻（例: 10:00）なら、前工程の `colEnd` と後工程の `colStart` が同じグリッド線になり、バーは重ならずに接する。

> #163 で `binarySearchFirstGt` に変えたが、これだと 10:00 終了のタスクが 10:00 のスロットまで1列長くなり、
> 10:00 開始の後工程と重なっていた。#535 で `binarySearchFirstGe` に戻した（クランプ順序の修正はそのまま）。

### クランプ順序

```
if (colEndIdx > total) colEndIdx = total          // 1. 上限クランプ
if (colEndIdx <= colStartIdx) colEndIdx = colStartIdx + 1  // 2. 最小幅保証
```

`> total` を先に評価することでゼロ幅バーの発生を防ぐ。

## マイルストーン工程（所要時間 0）

検査・承認・出荷判定など `start_datetime == end_datetime` の工程は、幅を持つバーではなく**ひし形マーカー**で描画する（#379）。

- `getMilestoneGridColumn(taskStart, config)`: マーカーを配置する 1 列分のグリッド位置（1 始まり）を返す。通常バーの `getTaskGridColumns()` は `colEnd = Math.max(colStart + 1, ...)` で最小 1 列幅を保証するため、`start == end` の工程も「幅 1 列のバー」になり、マイルストーンとして視認できない。そのためマーカー専用に開始列だけを算出する。
  - 開始列の丸めは `getTaskGridColumns()` の `colStart`（均一グリッドは切り捨て）および稼働時間スロット側（`binarySearchFirstGe` = 開始以降の最初のスロット）と揃える。
  - 稼働時間スロットモード: `binarySearchFirstGe(slots, taskStartMs)` のインデックス（範囲外は端にクランプ）+ 1。
  - 均一グリッド: `floor((taskStart - rangeStart) / unitDurationMs) + 1` を `[1, totalUnits]` にクランプ。
- 描画側（`GanttChart` / `TaskBar`）は `GanttTask.isMilestone === true` のとき `getMilestoneGridColumn()` の結果で `colStart` / `colEnd = colStart + 1` を与え、`TaskBar` がアウトラインのひし形マーカー＋右側ラベルを表示する。

## 1行に複数のバー（`GanttTask.rowId`、#535）

`GanttTask.rowId` が同じタスクは `GanttChart` が1行にまとめて描く（`groupTasksIntoRows()`。行の順序は各 rowId が最初に現れた位置）。
各タスクは自分の `start` / `end` の列にバーを描くので、行をまとめても間の時間は塗らない。`hideLabel` でバー横のラベルを消せる。
各バーには `data-task-id` を付けている（テスト・E2E からバーを特定するため）。

生産スケジュールの週次・月次表示（`components/schedule/gantt-chart.tsx`、月次は #537）はこれを使い、同じ受注・工程（`process_routing_id`）の
セグメントを1行に並べる。以前は「先頭セグメントの開始〜最後のセグメントの終了」の1本のバーにまとめていたため、
既存スケジュールの隙間に詰めて飛び飛びになった工程（`scheduler_logic._greedy_fill_gaps()`）は間の空き時間まで作業中に見え、
工程名で束ねていたので同じ工程名の別工程が合体していた。

- 日次表示と、グルーピング「設備グループ別」は対象外で1セグメント1行のまま
- ラベルは行の最後のセグメントにだけ出す（右端に1つ）
- ツールチップはセグメントの期間を日付付きで出し、セグメントが複数ある行は「この工程（表示中）: 開始〜終了（N区間）」も出す
  （表示中の週に取得したセグメントだけの範囲。週の外へ続く工程の全期間ではない）
- クリックで開く編集ダイアログはクリックしたセグメントを編集する

見た目は `frontend/e2e/gantt-segment-bars.spec.ts` で確認できる（スクリーンショットを `test-results/gantt-segment-bars/` に保存）。

## 変更履歴

- **#163**: `colEndIdx` を `binarySearchFirstGe` → `binarySearchFirstGt` に変更し、クランプ順序を修正（工程バーの重複・空行バグ修正）
- **#379**: `getMilestoneGridColumn()` を追加。所要時間 0 の工程をひし形マーカーで表示（`GanttTask.isMilestone`、`TaskBar` のマーカー描画分岐、シミュレーション結果一覧・手動調整ダイアログのゼロ長対応を含む）
- **#535**: `colEndIdx` を `binarySearchFirstGe` に戻し、終了時刻ちょうどのスロットを塗らないようにした。`GanttTask.rowId` / `hideLabel` を追加し、生産スケジュールの週次表示を「1工程1本の集約バー」から「セグメントごとのバーを1行に並べる」に変更
- **#537**: 均一グリッドの `colStart` / `getMilestoneGridColumn()` を切り上げ→切り捨てにし、月次で平日のバーが1日後ろにずれる不具合を修正。月次表示（オーダー別・フラット）も週次と同じく同じ工程のセグメントを1行に並べる
