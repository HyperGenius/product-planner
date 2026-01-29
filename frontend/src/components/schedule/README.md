# ガントチャートコンポーネント

スケジュールデータを視覚的に表示するための再利用可能なガントチャートコンポーネントです。

## 使用ライブラリ

- [gantt-task-react](https://github.com/MaTeMaTuK/gantt-task-react) (MIT License)

## ファイル構成

- `src/types/schedule.ts` - スケジュールデータ型の定義
- `src/components/schedule/gantt-chart.tsx` - ガントチャート表示コンポーネント
- `src/components/schedule/index.ts` - エクスポート定義
- `src/app/schedule-test/page.tsx` - テストページ（ダミーデータを使用）

## 基本的な使用方法

```tsx
import { GanttChart } from '@/components/schedule'
import { Schedule } from '@/types/schedule'

// バックエンドAPIからスケジュールデータを取得
const schedules: Schedule[] = [
  {
    id: 1,
    order_id: 1,
    process_routing_id: 1,
    equipment_id: 1,
    start_datetime: '2024-01-10T09:00:00Z',
    end_datetime: '2024-01-10T12:00:00Z',
    order_number: 'ORD-001',
    product_name: '製品A',
    process_name: '切削',
    equipment_name: '設備1',
  },
  // ... 他のスケジュール
]

// コンポーネントの使用
<GanttChart
  tasks={schedules}
  viewMode="Day"
  colorMode="product"
/>
```

## Props

### `tasks` (必須)

- 型: `Schedule[]`
- 説明: 表示するスケジュールデータの配列

### `viewMode` (オプション)

- 型: `'Day' | 'Week' | 'Month'`
- デフォルト: `'Day'`
- 説明: ガントチャートの表示モード

### `colorMode` (オプション)

- 型: `'product' | 'process'`
- デフォルト: `'product'`
- 説明: バーの色分けモード
  - `'product'`: 製品ごとに異なる色を自動生成
  - `'process'`: 工程ごとに事前定義された色を使用

## カスタマイズ

### バーの色

#### 製品別（`colorMode="product"`）

製品名からハッシュ値を生成し、色相（Hue）を決定します。同じ製品は常に同じ色で表示されます。

#### 工程別（`colorMode="process"`）

事前定義された色マッピング:

- 切削: 赤 (#ef4444)
- 組立: 青 (#3b82f6)
- 検査: 緑 (#10b981)
- 塗装: オレンジ (#f59e0b)
- 梱包: 紫 (#8b5cf6)
- その他: グレー (#6b7280)

色を追加する場合は、`gantt-chart.tsx` の `getBarColor` 関数内の `processColors` オブジェクトに追加してください。

### ツールチップ

バーにマウスカーソルを合わせると、以下の情報を表示します:

- 工程名
- 注文番号
- 開始時刻
- 終了時刻

ツールチップの内容をカスタマイズする場合は、`CustomTooltip` コンポーネントを編集してください。

## データ変換

バックエンドAPIレスポンス（`Schedule`型）をgantt-task-reactライブラリが要求する`Task`型に変換する関数が提供されています:

```tsx
import { convertScheduleToTask } from '@/components/schedule'

const task = convertScheduleToTask(schedule, 'product')
```

## テストページ

`/schedule-test` にアクセスすることで、ダミーデータを使用したガントチャートの動作を確認できます。

テストページでは以下の機能を試すことができます:

- 表示モードの切り替え（日/週/月）
- 色分けモードの切り替え（製品別/工程別）
- ダミーデータの確認

## 今後の拡張案

- [ ] バーのドラッグ&ドロップによるスケジュール変更
- [ ] 依存関係の表示（前工程完了後に次工程開始）
- [ ] マイルストーンの表示
- [ ] フィルタリング機能（製品別、設備別など）
- [ ] エクスポート機能（PDF、画像など）

## ライセンス

このプロジェクトは、gantt-task-react (MIT License) を使用しています。
