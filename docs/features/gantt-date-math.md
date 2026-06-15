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

## 変更履歴

- **#163**: `colEndIdx` を `binarySearchFirstGe` → `binarySearchFirstGt` に変更し、クランプ順序を修正（工程バーの重複・空行バグ修正）
