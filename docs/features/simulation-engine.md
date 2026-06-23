# シミュレーションエンジン 仕様書

受注に対して「工程ごとの生産スケジュール」を自動算出する機能の設計・実装仕様。

---

## 概要

シミュレーションエンジンは、製品の工程ルーティング・設備の空き状況・稼働カレンダーを参照し、
受注の生産スケジュール（各工程の開始・終了日時）を算出する。  
算出結果は **ドライラン（DB 非保存）** と **確定（DB 保存）** の 2 モードで動作する。

---

## ワークフロー全体図

```
[ユーザー: 受注入力]
       ↓
POST /orders/simulate          ← dry_run=True, DB 書き込みなし
       ↓
[シミュレーション結果表示]
  - 算出納期 (calculated_deadline)
  - 実現可能フラグ (is_feasible)
  - 工程別スケジュール一覧
       ↓
[ユーザー: 内容を確認して「確定」]
       ↓
POST /orders/{id}/confirm      ← dry_run=False, DB に production_schedules 保存
       ↓
[受注ステータス = confirmed / ガントチャートに反映]
       ↓
PATCH /production-schedules/{id}  ← ガントチャート上でドラッグ手動修正（任意）
```

---

## スケジューリングアルゴリズム

**実装ファイル**: `backend/app/scheduler_logic.py` — `schedule_order()`

### 入力パラメータ

| パラメータ | 型 | 説明 |
|---|---|---|
| `order_id` | `int \| None` | 既存受注 ID。新規シミュレーション時は `None` |
| `product_id` | `int` | 製品 ID |
| `quantity` | `int` | 生産数量 |
| `tenant_id` | `str` | テナント ID（RLS 用） |
| `start_time` | `datetime \| None` | シミュレーション開始基準時刻。`None` の場合は現在時刻 |
| `dry_run` | `bool` | `True` = 算出のみ / `False` = DB 保存 |
| `calendar_config` | `CalendarConfig \| None` | 稼働カレンダー設定 |
| `settings_repo` | `SchedulingSettingsRepository \| None` | スケジューリング設定リポジトリ |
| `standalone` | `bool` | `True` = 既存スケジュールを無視した単体換算モード（後述） |
| `desired_deadline` | `str \| None` | 顧客希望納期。`RoutingUnconfirmedError` に付与して呼び出し側で利用 |

### 工程確定ガード（#197 / #198 追加）

`dry_run=False`（確定モード）の場合、スケジューリング処理の冒頭で工程確定状態をチェックする。

```
routings = get_routings_by_product(product_id)

if not routings:
    raise ValueError("工程が見つかりません")          # HTTP 400

if not dry_run and not routings_are_confirmed(routings):
    raise RoutingUnconfirmedError(desired_deadline)  # HTTP 422
```

| 状態 | `dry_run=True` | `dry_run=False` |
|---|---|---|
| 工程なし | `ValueError` (400) | `ValueError` (400) |
| 未確定工程あり | 通過（シミュレーション可） | `RoutingUnconfirmedError` (422) |
| 全工程確定済み | 通過 | 通過 |

**`RoutingUnconfirmedError`** は `ValueError` のサブクラスで `desired_deadline` 属性を持つ。  
`confirm_order` エンドポイントはこれを HTTP 422 + `{"error": "routing_unconfirmed", "desired_deadline": "..."}` に変換する。

**`routings_are_confirmed(routings) -> bool`** は `scheduler_logic.py` に定義されたヘルパー関数。  
工程が 0 件、または任意の工程の `is_confirmed=False`（フィールド不在を含む）で `False` を返す。

---

### アルゴリズムステップ

```
1. products → process_routings を sequence_order 昇順で取得
   ↓ 工程確定ガード（dry_run=False 時のみ）

2. 工程ごとにループ:

   a. 所要時間の計算
      duration_sec = setup_time_seconds + (unit_time_seconds × quantity)

   b. 設備の選択（equipment_group_id が NULL の場合は設備不要）
      equipment_group_members から設備 ID 一覧を取得
      各設備について以下の順で候補時刻を計算:

      [ギャップ詰め込みフロー]
      1. スケジューリングパラメータを解決（設備 > グループ > グローバルの優先度）
         - guard_time_minutes: スケジュール間のバッファ時間
         - min_slot_minutes:   利用可能と見なすギャップの最低時間
         - max_fragments:      1 工程の最大分割数
      2. 既存スケジュールのギャップリストを構築（guard_time を考慮）
      3. greedy にギャップへ詰め込み（split_work_in_window）
      4. 断片数 > max_fragments または全量未収容 → フォールバックへ
      5. [フォールバック] 末尾追加: max(last_end_time, 前工程終了) から開始

      最も早く完了できる設備を選定

   c. 複数日への分割
      ギャップ詰め込み成功時 → 算出済みセグメントをそのまま使用
      フォールバック時 → split_work_across_days() で分割

   d. スケジュールレコードの生成（dry_run=False 時は DB INSERT）

   e. current_process_start を今工程の最終セグメント end_datetime に更新

3. 全工程分のスケジュールセグメントを返す
```

### スケジューリングパラメータ設定

| パラメータ | デフォルト | 説明 |
|---|---|---|
| `guard_time_minutes` | 0 | スケジュール間の最小バッファ（段取り替え時間） |
| `min_slot_minutes` | 0 | ギャップを利用可能と見なす最低時間 |
| `max_fragments` | 10 | 1 工程あたりの最大セグメント分割数 |

設定の優先度: **設備 > 設備グループ > グローバル（テナント全体）**

- グローバル設定: `GET/PUT /scheduling-settings` または `/settings/scheduling` ページ
- 設備グループ・設備: 各マスタ管理画面の「スケジューリング設定」欄

### dry_run フラグの動作

| `dry_run` | 動作 |
|---|---|
| `True` | スケジュールを計算して返すのみ。DB への書き込みなし |
| `False` | 計算後に `production_schedules` へ INSERT。受注ステータスも更新 |

### standalone モード

`standalone=True` を渡すと、設備の選択時に `production_schedules` の参照をスキップし、
稼働カレンダーのみに基づいた純粋な工程所要時間を計算する。

| `standalone` | 動作 |
|---|---|
| `False`（デフォルト） | 確定済みスケジュールのギャップ埋め・末尾追加を行う通常モード |
| `True` | 既存スケジュールを無視。`current_process_start` から即時割り当て |

**用途**: 工程管理モーダルの「個数からの目安」カード。  
単位時間の入力ミス検出のため「他の受注がない場合に N 個でおよそ何日かかるか」を表示する際に使用する。  
受注管理側の通常シミュレーション（`standalone=False`）とは計算ロジックを共有しており、  
カレンダー・稼働時間・複数日分割のルールは同一のエンジンが適用される。

---

## カレンダーロジック

**実装ファイル**: `backend/app/utils/calendar.py`, `backend/app/services/calendar_service.py`

### デフォルト稼働条件

| 項目 | 値 |
|---|---|
| 稼働時間 | 9:00 〜 17:00 |
| 昼休憩 | 12:00 〜 13:00（スケジュール計算から除外） |
| 1 日の最大稼働時間 | 7 時間（`MAX_DAILY_WORK_HOURS`） |
| 定休日 | 土・日（デフォルト） |

### work_calendars テーブルによるオーバーライド

`work_calendars` テーブルの `is_holiday` フラグで、祝日追加・休日出勤を設定できる。

| `is_holiday` | 意味 | 優先度 |
|---|---|---|
| `true` | その日を休日として扱う（平日でも休み） | 高 |
| `false` | その日を稼働日として扱う（土日でも稼働） | 高 |

DB に登録がない日は「土日 = 休日、平日 = 稼働」のデフォルトに従う。

### CalendarConfig の役割

```python
class CalendarConfig:
    holidays: set[date]   # is_holiday=True のレコード
    workdays: set[date]   # is_holiday=False のレコード（土日出勤など）

    def is_holiday(self, dt: datetime) -> bool:
        # workdays に含まれる → False（稼働）
        # holidays に含まれる → True（休日）
        # それ以外 → weekday() >= 5 で判定
```

`build_calendar_config()` が DB から直近 90 日分を読み込んで `CalendarConfig` を返す。

---

## API インターフェース

### POST `/orders/simulate` — 新規受注シミュレーション（DB 保存なし）

**リクエスト**
```json
{
  "product_id": 100,
  "quantity": 50,
  "desired_deadline": "2024-12-31T17:00:00+00:00",
  "standalone": false
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `product_id` | `int` | 製品 ID |
| `quantity` | `int` | 生産数量 |
| `desired_deadline` | `string \| null` | 希望納期（ISO 8601）。未指定時は `is_feasible` が常に `true` |
| `standalone` | `bool` | `true` = 単体換算モード（既存スケジュール無視）。デフォルト `false` |

**レスポンス**
```json
{
  "calculated_deadline": "2024-12-25T17:00:00+00:00",
  "is_feasible": true,
  "process_schedules": [
    {
      "process_name": "切削工程",
      "start_time": "2024-12-20T09:00:00+00:00",
      "end_time": "2024-12-20T17:00:00+00:00",
      "equipment_name": "CNC Machine 1"
    },
    {
      "process_name": "研削工程",
      "start_time": "2024-12-23T09:00:00+00:00",
      "end_time": "2024-12-24T14:30:00+00:00",
      "equipment_name": "Grinder 2"
    }
  ]
}
```

| フィールド | 説明 |
|---|---|
| `calculated_deadline` | 最終工程の `end_datetime`（ISO 8601） |
| `is_feasible` | `calculated_deadline ≤ desired_deadline` なら `true`。`desired_deadline` が未指定の場合は常に `true` |
| `process_schedules` | 工程ごとの開始・終了・設備名 |

---

### POST `/orders/{order_id}/simulate` — 既存受注の再シミュレーション

パスパラメータで受注を特定し、その `product_id`・`quantity`・`desired_deadline` を使ってシミュレーション。  
レスポンス形式は上記と同じ。

---

### POST `/orders/{order_id}/confirm` — スケジュール確定・DB 保存

`dry_run=False` で `schedule_order()` を実行し、スケジュールを `production_schedules` に保存。  
受注テーブルも以下のフィールドを更新する。

| フィールド | 値 |
|---|---|
| `status` | `"confirmed"` |
| `is_scheduled` | `true` |
| `confirmed_deadline` | 算出された最終工程終了日（date 型） |
| `confirmed_at` | 確定操作のタイムスタンプ |

**エラーレスポンス**

| HTTP | 条件 | レスポンスボディ |
|---|---|---|
| 404 | 受注が見つからない | `{"detail": "Order not found"}` |
| 422 | 未確定工程あり | `{"detail": {"error": "routing_unconfirmed", "desired_deadline": "YYYY-MM-DD"}}` |
| 400 | 工程なし・その他 ValueError | `{"detail": "<メッセージ>"}` |

未確定工程エラー（422）はシミュレーション自体はできても「ガントへ登録できない」状態を示す。  
フロントエンドはこの `error: "routing_unconfirmed"` を判定し、工程確定を促すメッセージを表示する（✅ #199 にて実装済み）。

---

### GET `/production-schedules` — スケジュール一覧取得

**クエリパラメータ**

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `start_date` | `YYYY-MM-DD` | 必須 | 取得範囲の開始日 |
| `end_date` | `YYYY-MM-DD` | 必須 | 取得範囲の終了日 |
| `equipment_group_id` | `int` | 任意 | 設備グループでの絞り込み |

受注番号・製品名・顧客名・工程名・設備名・設備グループ名を JOIN して返す（ガントチャート用）。

---

### PATCH `/production-schedules/{schedule_id}` — スケジュール手動更新

ガントチャート上でのドラッグ操作によるスケジュール修正に対応。

**リクエスト（全フィールド省略可）**
```json
{
  "start_datetime": "2024-12-23T10:00:00+00:00",
  "end_datetime": "2024-12-23T16:00:00+00:00",
  "equipment_id": 5
}
```

バリデーション: `start_datetime < end_datetime`（両方指定時のみチェック）

---

## データモデル

### `production_schedules` テーブル

| カラム | 型 | 説明 |
|---|---|---|
| `id` | `bigint PK` | |
| `tenant_id` | `uuid` | RLS 用 |
| `order_id` | `bigint FK` | `orders.id`（CASCADE DELETE） |
| `process_routing_id` | `bigint FK` | `process_routings.id` |
| `equipment_id` | `bigint FK \| NULL` | `equipments.id`。設備不要工程は NULL |
| `start_datetime` | `timestamptz` | |
| `end_datetime` | `timestamptz` | |

インデックス:
- `(tenant_id, equipment_id, end_datetime DESC)` — 設備の最終終了時刻を高速取得
- `(tenant_id, order_id)` — 受注ごとのスケジュール取得

### `process_routings` テーブル（関連マスタ）

| カラム | 型 | 説明 |
|---|---|---|
| `id` | `bigint PK` | |
| `product_id` | `bigint FK` | |
| `sequence_order` | `int` | 工程の実行順序 |
| `process_name` | `text` | |
| `equipment_group_id` | `bigint FK \| NULL` | NULL = 設備不要 |
| `setup_time_seconds` | `int` | 段取り時間（秒） |
| `unit_time_seconds` | `numeric(10,4)` | 1個あたり加工時間（秒） |
| `is_confirmed` | `boolean DEFAULT false` | 工程確定フラグ。`false` の工程を含む受注はガント登録不可 |
| `confirmed_by` | `uuid FK \| NULL` | 確定操作を行ったユーザーの ID（audit 用） |
| `confirmed_at` | `timestamptz \| NULL` | 確定操作のタイムスタンプ（audit 用） |

### `orders` テーブルの確定フィールド

| カラム | 型 | 説明 |
|---|---|---|
| `status` | `text` | `draft \| confirmed \| completed \| canceled` |
| `is_scheduled` | `bool` | スケジュール確定済みかどうか |
| `confirmed_deadline` | `date` | 確定時に算出された生産完了予定日 |
| `confirmed_at` | `timestamptz` | 確定操作のタイムスタンプ |

### `work_calendars` テーブル

| カラム | 型 | 説明 |
|---|---|---|
| `tenant_id` | `uuid` | |
| `date` | `date` | |
| `is_holiday` | `bool` | true = 休日指定 / false = 稼働日指定 |
| `note` | `text \| NULL` | 備考 |

---

## 主要ファイル一覧

| ファイル | 役割 |
|---|---|
| `backend/app/scheduler_logic.py` | コアスケジューリングアルゴリズム |
| `backend/app/utils/calendar.py` | カレンダーユーティリティ（稼働時間・複数日分割） |
| `backend/app/services/simulation_service.py` | シミュレーションレスポンスの整形 |
| `backend/app/services/calendar_service.py` | DB から `CalendarConfig` を構築 |
| `backend/app/routers/transaction/orders.py` | `/orders/simulate`, `/orders/{id}/confirm` エンドポイント |
| `backend/app/routers/transaction/production_schedules.py` | スケジュール取得・更新エンドポイント |
| `backend/app/repositories/supa_infra/transaction/schedule_repo.py` | `production_schedules` DB 操作 |
| `backend/app/models/transaction/order_schema.py` | `OrderSimulateRequest`, `OrderSimulateResponse` Pydantic スキーマ |
| `frontend/src/hooks/use-orders.ts` | `useSimulateOrder`, `useConfirmOrder` TanStack Query フック |
| `frontend/src/types/order.ts` | `OrderSimulateRequest`, `OrderSimulateResponse`, `ProcessSchedule` TypeScript 型 |
| `frontend/src/components/product-routings-dialog.tsx` | 工程管理モーダル（`standalone: true` でカードの単体換算表示） |
| `frontend/src/types/schedule.ts` | `Schedule` TypeScript 型 |
| `frontend/src/components/simulation-result.tsx` | シミュレーション結果表示コンポーネント |

---

## 制約・既知の挙動

- **設備選択は最小負荷方式**: グループ内で「最も早く空く設備」を選択。設備の均等配分は保証しない
- **既存スケジュールは再計算されない**: confirm 実行時に他の受注の確定済みスケジュールは変更されない。設備の空き時間は `production_schedules` の最終 `end_datetime` を基準とするため、手動でキャンセルした受注のスケジュールが残っている場合は空き時間の判定に影響する
- **start_time デフォルト**: `schedule_order()` の `start_time=None` の場合、現在時刻（`datetime.now()`）が基準になる。テストや過去日付での計算が必要な場合は明示的に渡す
- **タイムゾーン**: 全 datetime は UTC（`timestamptz`）で保存。フロントエンドの表示は日本語ロケールに変換
- **複数日分割**: 1 工程が 7 時間を超える場合、翌稼働日の 9:00 に続きが割り当てられる。分割された各セグメントが個別の `production_schedules` レコードとなる
- **工程確定ガード**: `is_confirmed=false` の工程が 1 件でもある場合、`dry_run=False`（ガント登録）はブロックされる。`dry_run=True`（シミュレーション）はブロックされない。詳細は「工程確定ガード」セクション参照
- **`is_confirmed` フィールド不在の扱い**: `routings_are_confirmed()` は `r.get("is_confirmed", False)` で評価するため、マイグレーション前のレコード（フィールドなし）も未確定として扱われる
