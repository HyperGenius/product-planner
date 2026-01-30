# ガントチャート編集機能 仕様書

## 概要

ガントチャート上でのドラッグ&ドロップ操作による生産スケジュールの手動調整機能の仕様を定義します。`gantt-task-react` ライブラリを使用し、直感的な操作でスケジュールの時刻変更を実現します。

## 機能要件

### 1. 編集モード切り替え

- **目的**: 誤操作を防ぐため、明示的に編集モードを有効化する
- **UI要素**: 画面上部に「編集モード」ボタンを配置
  - デフォルト状態: 編集無効（ボタンは `outline` スタイル、表示は「編集モード」）
  - 編集中: 編集有効（ボタンは `default` スタイル、表示は「編集中」）
- **実装**: `isEditMode` state で制御

```typescript
const [isEditMode, setIsEditMode] = useState<boolean>(false)
```

### 2. タスクバーのドラッグ操作

編集モードが有効な場合のみ、以下の操作が可能になります：

#### 2.1 時間移動（横方向ドラッグ）

- **操作**: タスクバーを左右にドラッグ
- **効果**: スケジュールの開始時刻と終了時刻を変更
- **制約**:
  - ドラッグ中は視覚的にバーが移動
  - ドロップ時に自動的にバックエンドAPIへ送信
  - 期間の長さは保持される

#### 2.2 期間の変更（端のリサイズ）

- **操作**: タスクバーの左端または右端をドラッグ
- **効果**: 開始時刻または終了時刻のみを変更
- **制約**:
  - 開始時刻が終了時刻より後になることは許可しない（バックエンドでバリデーション）

#### 2.3 設備変更（縦方向ドラッグ）

- **現在の対応状況**: `gantt-task-react` ライブラリが行移動をネイティブサポートしていないため**未実装**
- **代替策**: 将来的にクリック→ダイアログでの設備選択機能を追加予定

### 3. スケジュール更新API連携

#### 3.1 API仕様

- **エンドポイント**: `PATCH /production-schedules/{schedule_id}`
- **リクエストボディ**:
  ```json
  {
    "start_datetime": "2026-01-30T09:00:00.000Z",  // ISO 8601形式
    "end_datetime": "2026-01-30T17:00:00.000Z",    // ISO 8601形式
    "equipment_id": 5                               // オプション（現在未使用）
  }
  ```
- **レスポンス**: 更新後のスケジュールオブジェクト

#### 3.2 データフロー

```
[ユーザー操作]
  ↓
[onDateChange イベント]
  ↓
[handleDateChange ハンドラ]
  ↓ タスクIDの検証
  ↓ ISO 8601形式へ変換
  ↓
[useUpdateSchedule mutation]
  ↓
[PATCH /production-schedules/{id}]
  ↓
[バックエンド更新処理]
  ↓
[レスポンス受信]
  ↓
[onSuccess: クエリキャッシュ無効化]
  ↓
[自動再取得 & 画面更新]
  ↓
[Toast通知表示]
```

### 4. エラーハンドリングとフィードバック

#### 4.1 入力検証

- **タスクIDの検証**:
  ```typescript
  const scheduleId = Number(task.id)
  if (isNaN(scheduleId) || scheduleId <= 0) {
    toast.error("無効なスケジュールIDです")
    return false  // ライブラリに変更をロールバックさせる
  }
  ```

#### 4.2 成功時の通知

- **タイミング**: API更新が成功した後
- **実装場所**: `useUpdateSchedule` の `onSuccess` コールバック
- **表示内容**: 「スケジュールを更新しました」（緑色のToast、Sonnerライブラリ使用）
- **副作用**: クエリキャッシュを無効化して最新データを再取得

#### 4.3 失敗時の通知

- **タイミング**: API呼び出しが失敗した場合
- **実装場所**: `handleDateChange` の `catch` ブロック
- **表示内容**: 「スケジュールの更新に失敗しました」（赤色のToast）
- **副作用**: 
  - `return false` でライブラリに変更を元に戻すよう指示
  - コンソールにエラーログ出力

#### 4.4 ローディング状態

- **現在の実装**: 暗黙的（`useMutation` の `isPending` 状態）
- **改善案**: 将来的にローディングスピナーやバー上のインジケーターを表示

### 5. 非稼働日への移動時の動作

#### 5.1 バックエンドのカレンダー機能

バックエンドでは `work_calendars` テーブルを使用して稼働日・非稼働日を管理しています：

- **デフォルト動作**: レコードが存在しない日は、土日を休日、平日を稼働日として扱う
- **カスタム設定**: `is_holiday` フラグで任意の日を休日/稼働日に設定可能
  - `is_holiday=True`: その日を休日として扱う
  - `is_holiday=False`: デフォルトで休日の日（土日）でも稼働日として扱う

#### 5.2 スケジュール更新時の動作

**重要**: 現在のフロントエンド実装では、非稼働日への移動を**そのまま許可**しています。

- **ユーザーがタスクを非稼働日にドラッグした場合**:
  1. フロントエンドはドラッグ後の日時をそのままバックエンドへ送信
  2. バックエンドは受け取った日時でスケジュールを更新
  3. **自動的な稼働日への補正は行われない**

- **理由**: 
  - ユーザーの意図を尊重（特殊な事情で非稼働日に作業する可能性がある）
  - バックエンドのスケジューリングロジック（`scheduler_logic.py`）では稼働日判定を行うが、手動更新APIでは行わない

#### 5.3 将来的な改善案

非稼働日への移動を制限したい場合は、以下の実装が考えられます：

**オプション1: フロントエンドでの事前検証**
```typescript
// ドロップ前に稼働日かチェック
const isWorkday = await checkWorkday(task.start)
if (!isWorkday) {
  toast.warning("非稼働日が含まれています。稼働日に移動しますか？")
  // ユーザーに確認ダイアログを表示
}
```

**オプション2: バックエンドでの自動補正**
```python
# production_schedules.py の update エンドポイントで
# calendar_service を使用して稼働日へ自動移動
from app.services.calendar_service import build_calendar_config
from app.utils.calendar import get_next_work_start

if not is_workday(new_start_datetime, calendar_config):
    new_start_datetime = get_next_work_start(new_start_datetime, calendar_config)
    # 終了時刻も調整...
```

**オプション3: 警告表示のみ**
```typescript
// 非稼働日でも保存するが、警告を表示
toast.warning("このスケジュールには非稼働日が含まれています")
```

### 6. 技術実装詳細

#### 6.1 コンポーネント構成

```
SchedulePage (app/schedule/page.tsx)
├── 編集モード切替ボタン
├── GanttChart (components/schedule/gantt-chart.tsx)
│   ├── Gantt (gantt-task-react)
│   │   ├── onDateChange -> handleDateChange
│   │   └── isDisabled={!isEditable}
│   └── useUpdateSchedule hook
└── Toast通知 (sonner)
```

#### 6.2 状態管理

- **ローカル状態**: `isEditMode` (編集モードのON/OFF)
- **サーバー状態**: React Query で管理
  - `useSchedules`: スケジュール一覧の取得とキャッシュ
  - `useUpdateSchedule`: スケジュール更新のMutation

#### 6.3 型定義

```typescript
// Schedule型（バックエンドレスポンス）
interface Schedule {
  id: number
  order_id: number
  process_routing_id: number
  equipment_id: number
  start_datetime: string  // ISO 8601
  end_datetime: string    // ISO 8601
  order_number?: string
  product_name?: string
  process_name?: string
  equipment_name?: string
}

// 更新パラメータ
interface ScheduleUpdateParams {
  start_datetime?: string  // ISO 8601
  end_datetime?: string    // ISO 8601
  equipment_id?: number    // 将来の設備変更用
}
```

#### 6.4 Task型への変換

```typescript
function convertScheduleToTask(
  schedule: Schedule,
  colorMode: 'product' | 'process',
  isEditable: boolean
): Task {
  return {
    id: String(schedule.id),
    type: 'task',
    name: `${schedule.process_name} - ${schedule.order_number}`,
    start: new Date(schedule.start_datetime),
    end: new Date(schedule.end_datetime),
    progress: 100,
    isDisabled: !isEditable,  // 編集可否の制御
    styles: { /* 色設定 */ }
  }
}
```

## 制約事項と既知の問題

### 1. 設備変更の未実装

- **理由**: `gantt-task-react` ライブラリが縦方向の行移動をサポートしていない
- **影響**: タスクを別の設備に割り当てるには別の方法が必要
- **対応策**: クリック→ダイアログでの設備選択機能を将来実装予定

### 2. 楽観的UI更新の非対応

- **現状**: サーバーからのレスポンスを待ってから画面更新
- **影響**: ネットワーク遅延時にユーザーが更新を待つ必要がある
- **改善案**: React Query の `onMutate` で楽観的更新を実装

### 3. 同時編集の競合

- **現状**: 複数ユーザーが同じスケジュールを編集した場合、後勝ちで上書き
- **影響**: 先に行った変更が失われる可能性
- **改善案**: 楽観的ロックやバージョン管理の導入

## テスト

### 単体テスト

```typescript
// gantt-chart.test.tsx
describe("GanttChart editing", () => {
  it("should call update API when task is dragged", async () => {
    // テスト実装例
  })

  it("should show error toast when invalid schedule ID", async () => {
    // テスト実装例
  })

  it("should rollback on API error", async () => {
    // テスト実装例
  })
})
```

### E2Eテスト

```typescript
// schedule.e2e.test.ts
describe("Schedule editing flow", () => {
  it("should update schedule via drag and drop", async () => {
    // 1. 編集モードを有効化
    // 2. タスクバーをドラッグ
    // 3. Toast通知を確認
    // 4. 画面が更新されることを確認
  })
})
```

## ユーザーマニュアル

### スケジュールの時刻変更手順

1. **編集モードを有効化**
   - 画面右上の「編集モード」ボタンをクリック
   - ボタンが「編集中」表示に変わることを確認

2. **タスクバーを移動**
   - 変更したいタスクバーの中央部分をクリック＆ホールド
   - 左右にドラッグして希望の時刻へ移動
   - マウスボタンを離してドロップ

3. **期間を変更**
   - タスクバーの左端または右端にマウスを合わせる
   - カーソルが変化したらクリック＆ホールド
   - 左右にドラッグして期間を調整
   - マウスボタンを離してドロップ

4. **結果を確認**
   - 「スケジュールを更新しました」のメッセージが表示される
   - ガントチャートが自動的に更新される
   - エラーの場合は赤いメッセージが表示され、変更が元に戻る

5. **編集を終了**
   - 「編集中」ボタンをクリックして編集モードを解除
   - これで誤操作を防げる

### トラブルシューティング

| 問題 | 原因 | 解決方法 |
|------|------|----------|
| タスクバーがドラッグできない | 編集モードが無効 | 「編集モード」ボタンをクリックして有効化 |
| 「無効なスケジュールIDです」と表示される | データの不整合 | ページをリフレッシュしてデータを再取得 |
| 「更新に失敗しました」と表示される | ネットワークエラーまたはサーバーエラー | ネットワーク接続を確認し、再度操作 |
| ドロップ後に変更が反映されない | API通信中 | 数秒待ってから確認（Toast通知を待つ） |

## 今後の拡張予定

1. **設備変更機能**
   - ダイアログベースでの設備選択UI
   - `equipment_id` の更新API連携

2. **バッチ編集**
   - 複数タスクの同時選択
   - 一括での時刻移動

3. **制約条件の可視化**
   - 非稼働日のハイライト表示
   - ドラッグ時の自動スナップ（稼働日のみ）

4. **undo/redo機能**
   - 変更履歴の管理
   - 操作の取り消し・やり直し

5. **リアルタイム同期**
   - WebSocketでの変更通知
   - 他ユーザーの編集をリアルタイム反映

## 関連ドキュメント

- [稼働カレンダー機能 使用ガイド](./calendar_feature.md)
- [バックエンドAPI仕様](../backend/README.md)
- [gantt-task-react ライブラリドキュメント](https://github.com/MaTeMaTuK/gantt-task-react)
