# ガントチャート date-math ユーティリティ

## 概要

`frontend/src/gantt/utils/date-math.ts` は、ガントチャートのグリッド列計算を担うユーティリティモジュール。週次モード（稼働時間スロットあり）と月次・日次モード（均一グリッド）で異なる計算パスを使用する。

## 稼働時間スロットモード（週次）

`buildWorkingSlots()` で生成したスロット配列（各稼働時間の開始 Date）を基に、`getTaskGridColumnsFromSlots()` がバイナリサーチでグリッド列位置を算出する。

### 列計算の仕様

| 値 | 計算方法 | 備考 |
|---|---|---|
| `colStart` | `binarySearchFirstGe(slots, taskStartMs) + 1` | タスク開始以降の最初のスロット |
| `colEnd` | `binarySearchFirstGt(slots, taskEndMs) + 1` | タスク終了より**厳密に後**の最初のスロット |

`colEndIdx` に `binarySearchFirstGt`（strictly greater than）を使うことで、前工程の終了時刻と後工程の開始時刻が同一スロット境界を指す場合でも colEnd と colStart が重複せず、バーが隙間なく接続する。

### クランプ順序

```
if (colEndIdx > total) colEndIdx = total          // 1. 上限クランプ
if (colEndIdx <= colStartIdx) colEndIdx = colStartIdx + 1  // 2. 最小幅保証
```

`> total` を先に評価することでゼロ幅バーの発生を防ぐ。

## マイルストーン工程（所要時間 0）

検査・承認・出荷判定など `start_datetime == end_datetime` の工程は、幅を持つバーではなく**ひし形マーカー**で描画する（#379）。

- `getMilestoneGridColumn(taskStart, config)`: マーカーを配置する 1 列分のグリッド位置（1 始まり）を返す。通常バーの `getTaskGridColumns()` は `colEnd = Math.max(colStart + 1, ...)` で最小 1 列幅を保証するため、`start == end` の工程も「幅 1 列のバー」になり、マイルストーンとして視認できない。そのためマーカー専用に開始列だけを算出する。
  - 開始列の丸めは `getTaskGridColumns()` の `colStart`（切り上げ）および稼働時間スロット側（`binarySearchFirstGe` = 開始以降の最初のスロット）と揃える。
  - 稼働時間スロットモード: `binarySearchFirstGe(slots, taskStartMs)` のインデックス（範囲外は端にクランプ）+ 1。
  - 均一グリッド: `ceil((taskStart - rangeStart) / unitDurationMs) + 1` を `[1, totalUnits]` にクランプ。
- 描画側（`GanttChart` / `TaskBar`）は `GanttTask.isMilestone === true` のとき `getMilestoneGridColumn()` の結果で `colStart` / `colEnd = colStart + 1` を与え、`TaskBar` がアウトラインのひし形マーカー＋右側ラベルを表示する。

## 変更履歴

- **#163**: `colEndIdx` を `binarySearchFirstGe` → `binarySearchFirstGt` に変更し、クランプ順序を修正（工程バーの重複・空行バグ修正）
- **#379**: `getMilestoneGridColumn()` を追加。所要時間 0 の工程をひし形マーカーで表示（`GanttTask.isMilestone`、`TaskBar` のマーカー描画分岐、シミュレーション結果一覧・手動調整ダイアログのゼロ長対応を含む）
