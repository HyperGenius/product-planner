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
- 注文行の全文（長い製品名）はサマリーバーのツールチップ（PC）と詳細シート（#581）で見られる

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

## 工程の状態と納期（Issue #580）

バーの色は製品ではなく**工程の状態**を表す（製品の識別はラベル列）。状態は `lib/daily-report-progress-utils.ts` の
`processDisplayState()`（`planned_only` / `not_started` / `in_progress` / `completed` / `delayed`）に集約し、遅れの判定は
#491 の `isProgressDelayed()`（バックエンドの `planned_end_datetime` 基準）をそのまま使う。
**進捗の行が無い工程は「計画のみ」**で、未着手・遅れに見せない（進捗を一度も計算していないテナントは全バーが計画のみ）。

| 状態 | `appearance` | バー | バッジ |
|---|---|---|---|
| 計画のみ | `neutral` | グレーの塗り | なし |
| 未着手 | `subtle` | 白地＋基本色の破線枠 | なし |
| 進行中 | `default` | 基本色（青）＋進捗の暗い塗り | `60%` |
| 完了 | `muted` | くすんだグレー | ✓ |
| 遅れ | `danger` | 赤＋斜線（進捗の塗りも残す） | ！ |

- 状態 → 外観の対応は `components/schedule/gantt-chart.tsx` の `STATE_APPEARANCE`（`Record<ProcessDisplayState, …>`）。
  `src/gantt` は汎用の `GanttTask.appearance` / `badge` / `markers` だけを持ち、完了・遅れ等の語は持たない（`isDelayed` は廃止）
- 1工程が複数セグメントに分かれる場合は全セグメントに同じ状態を出す。マイルストーンは外観の色（ひし形）だけ変える
- ラベル列: 工程行に `完了` / `進行中 60%` / `遅れ` / `未着手`（計画のみは出さない）。注文行には注文全体の状態
  （全工程完了 → `完了`、遅れの工程あり → `遅れあり`、それ以外は最終工程＝`sequence_order` 最大の状態。`orderStateLabelText()`）
- 納期マーカー（`GanttTask.markers`、注文行＝オーダー別のみ）: 希望納期 → 無ければ完成見込み（#579 と同じ `pickShippingDeadline()`）の
  **日の終わり**に縦線と `⚑ 納期 M/d` を出す。表示期間の外は端に `→ 納期 M/d` / `← …`。注文の最終工程の計画終了が
  **希望納期**の日を超えるときは線を赤にして注文行に「納期超過」を出す（完成見込みは計画の終了から算出した値なので超過判定しない）
- 凡例（`components/schedule/progress-legend.tsx`）は常時表示。見本は実際の `TaskBar` で描く。進捗の計算時刻（`computed_at`）も出す。
  未計算のテナントは「計画のみ」だけ
- 「遅れのみ」「完了を隠す」の絞り込みトグル（Issue では任意）は未実装

## タブレットのタッチ操作（Issue #581）

想定は工場に置くタブレット（横向き 1180×820〜1280×800、タッチ・ホバー無し）で社長が見て操作すること。PC でも崩れないこと。

### 詳細シート（`components/schedule/schedule-detail-sheet.tsx`）

- 工程バー・工程行のラベルのタップで**工程の詳細**、注文行のラベル・サマリーバーのタップで**注文の詳細**を開く。
  設備グループ行のラベルのタップは折りたたみの切り替え（詳細は開かない）
- シートはモーダルにせず、ガントの右に並べる `aside`（幅 360px、`xl` で 400px）。ガントは隠れないので、開いたまま別の行を
  タップして切り替えられる。開いている行は `src/gantt` の `selectedRowKeys` でハイライトする（日次・設備グループ別は工程が
  区間ごとの行になるので、その工程の行をすべて塗る。注文は注文行、注文行の無い表示単位ではその注文の工程の行）
- 中身は表示中のスケジュールと進捗から `lib/schedule-detail-utils.ts` の `buildScheduleDetail()` で組み立てる（シート用の API は無い）

| 種類 | 内容 |
|---|---|
| 工程 | 工程名・設備（グループ）・計画（表示中の範囲と区間数、工程全体の範囲が違えば併記）／実績（状態・`good_qty / order_quantity`・初回〜最終実績日・計画終了・完了の根拠 `completed_by`）／注文の項目（顧客・製品・数量・希望納期・完成見込み・注文番号・顧客の注文番号・ステータス）と受注詳細へのリンク／操作（編集できるロールだけ） |
| 注文 | 注文の項目・計画（全体）・注文の状態、工程の一覧（工程順。タップでその工程へ）。工程は**表示中の期間にある工程と、進捗の行がある工程**を合わせたもの（確定済み・生産中なら全工程が出る） |

- 選択は `ScheduleSelection`（`order_id` / `process_routing_id`）で持つので、自動更新で取り直しても同じものを指す。
  選んだものが表示中の期間に無くなったらシートは閉じる（`buildScheduleDetail()` が null）
- ホバーのツールチップは PC 用に残すが、情報の正はシート（Radix Tooltip はタッチでは開かない）

### 閲覧と編集の分離

- 「編集モード」トグルは廃止。タップは詳細を開くだけで、開始・終了の編集（既存の `ScheduleEditDialog`）はシートの「操作」で区間ごとに開く
- 編集できるロールは **`president` のみ**（承認系と同じく `platform_admin` を含めない。生産管理者ロールができたら足す）。
  Frontend `SCHEDULE_EDITOR_ROLES`（`types/member.ts`）と Backend `_SCHEDULE_EDITOR_ROLES`（`routers/transaction/production_schedules.py`、
  それ以外は `PATCH /production-schedules/{id}` が 403）を揃える
- 前倒し・後ろ倒し（後工程の連動）は #582

### タップとスワイプ・タップ目標（`src/gantt`）

| props | 内容 |
|---|---|
| `onRowClick(rowTasks)` | ラベル列の行のタップ（折りたたみボタンは除く）。中身は `role="button"`（Enter / Space でも発火） |
| `onTaskClick(task)` | バーのタップ。グループヘッダーのサマリーバーでも発火する（以前は除外していた） |
| `selectedRowKeys` | ハイライトする行（`getRowKey(task)` = `rowId ?? id`） |
| `barHeight` | 通常のバー・マイルストーンの高さ |

- スクロールコンテナの `pointerdown`（capture）で位置とスクロール位置を覚え、クリック時に 10px を超えて動いた・スクロールした
  ものは無視する（スワイプの終わりで誤って開かない）。`detail === 0`（キーボード由来）は常に通す
- タップできるバーには透明な `::before`（44px 四方以上、バーの中心に重ねる）でタップ範囲を広げる。同じ行のバーは同じ工程なので重なっても困らない
- 画面側は工程行 52px・工程バー 36px・設備グループ行 48px・注文行 60px。折りたたみボタン・見出しのボタンも 44px

### ツールバー・置きっぱなし運用（`app/schedule/page.tsx`）

- 表示単位（注文別／設備グループ別／フラット）と期間（日／週／月）は `SegmentedControl`（`role="radiogroup"`、各 44px）。
  設備グループは件数が増えうるので検索付きコンボボックスのまま。「今日」「前へ」「次へ」、日付へのジャンプ（`input type="date"`）を置く
- 幅 1366px 以下で開くとサイドバーを閉じ、画面を離れるときに元へ戻す（`useCollapseSidebarOnTablet()`、`useEffectEvent`）
- スケジュール・進捗は5分ごとに自動更新（`useSchedules` / `useOrderProgressList` の `refetchInterval`）し、最終更新時刻と「更新」ボタンを出す。
  再取得に失敗したら「取得に失敗しました（最終更新 …）」に切り替え、取得済みのガントは出したままにする
- 表示単位・期間・設備グループ・折りたたみは localStorage（`schedule-view-prefs`）に覚える。読み書きは
  `hooks/use-local-storage-state.ts`（`useSyncExternalStore` で SSR 中は既定値、ストレージが使えない端末では開いている間だけ保つ）、
  値の検証は `lib/schedule-view-prefs.ts`（外れた項目は既定値に戻す。削除された設備グループは「すべて」扱い）。折りたたみは新しい 300 件まで
- E2E: `frontend/e2e/gantt-tablet-touch.spec.ts`（1180×820・`hasTouch`。スワイプは CDP の `Input.dispatchTouchEvent` で再現）
