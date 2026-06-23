# 稼働カレンダー機能 使用ガイド

## 概要

稼働カレンダー機能を使用すると、データベースで稼働日/非稼働日を管理し、祝日や臨時休業、土曜出勤などに柔軟に対応できます。

## データベーステーブル

### work_calendars テーブル

```sql
- id: bigint (primary key)
- tenant_id: uuid (テナントID)
- date: date (日付)
- is_holiday: boolean (休日フラグ)
- note: text (備考)
- created_at: timestamptz
- updated_at: timestamptz
```

**デフォルト動作**: レコードが存在しない日は、土日を休日、月〜金を稼働日として扱います。

## 使用方法

### 1. 休日情報の登録

```python
from datetime import date
from app.repositories.supa_infra.common.calendar_repo import CalendarRepository

# リポジトリの初期化（Supabase クライアント必要）
calendar_repo = CalendarRepository(supabase_client)

# 休日を登録
calendar_repo.create_or_update_holiday(
    target_date=date(2025, 1, 1),
    is_holiday=True,
    note="元日"
)

# 土曜出勤日を登録
calendar_repo.create_or_update_holiday(
    target_date=date(2025, 1, 11),  # 土曜日
    is_holiday=False,
    note="臨時出勤日"
)
```

### 2. CalendarConfig の構築

```python
from app.services.calendar_service import build_calendar_config

# データベースから休日情報を取得してCalendarConfigを構築
calendar_config = build_calendar_config(
    calendar_repo,
    start_date=date(2025, 1, 1),
    end_date=date(2025, 3, 31)  # 3ヶ月分
)
```

### 3. スケジューリングでの使用

```python
from app.scheduler_logic import schedule_order

# スケジュール作成時にCalendarConfigを渡す
schedules = schedule_order(
    order_id=order_id,
    product_id=product_id,
    quantity=quantity,
    product_repo=product_repo,
    schedule_repo=schedule_repo,
    tenant_id=tenant_id,
    calendar_config=calendar_config,  # カスタムカレンダー設定
    dry_run=False
)
```

### 4. カレンダー関数の直接使用

```python
from datetime import datetime
from app.utils.calendar import (
    CalendarConfig,
    is_workday,
    get_next_work_start,
    split_work_across_days
)

# 休日セットを指定してCalendarConfigを作成
holidays = {date(2025, 1, 1), date(2025, 1, 13)}  # 元日と成人の日
config = CalendarConfig(holidays=holidays)

# 稼働日判定
dt = datetime(2025, 1, 1, 10, 0)
if is_workday(dt, config):
    print("稼働日です")
else:
    print("休日です")

# 次の稼働開始時刻を取得
next_start = get_next_work_start(dt, config)

# 作業を複数日に分割
segments = split_work_across_days(
    start_dt=datetime(2025, 1, 6, 14, 0),
    duration_minutes=600,  # 10時間
    calendar_config=config
)
```

## API エンドポイント

実装ファイル: `backend/app/routers/master/calendars.py`

### GET `/calendars?year={year}&month={month}`

指定月のカレンダー情報（`work_calendars` レコード）を返す。

```
GET /calendars?year=2026&month=1
→ [{date, is_holiday, note, ...}, ...]
```

### POST `/calendars`

1件のカレンダー情報を作成または更新（upsert）。

```json
POST /calendars
{
  "date": "2026-01-01",
  "is_holiday": true,
  "note": "元日"
}
```

### POST `/calendars/import-national-holidays?year={year}`

内閣府の祝日 CSV（`https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv`、Shift-JIS 形式）を取得し、指定年の国民の祝日を一括 upsert する。

```
POST /calendars/import-national-holidays?year=2026
→ {"imported_count": 16, "year": 2026}
```

エラー時は HTTP 502（外部 CSV 取得失敗）を返す。

### POST `/calendars/batch`

複数日のカレンダー情報を一括更新。

```json
POST /calendars/batch
{
  "dates": ["2026-08-10", "2026-08-11", "2026-08-12"],
  "is_holiday": true,
  "note": "夏季休業"
}
→ {"updated_count": 3, "total_count": 3}
```

個別の日付で失敗しても処理は継続され、`updated_count` に成功件数のみを反映する。

## テストのベストプラクティス

```python
from datetime import date, datetime
from app.utils.calendar import CalendarConfig, is_workday

def test_custom_holiday():
    """カスタム休日のテスト"""
    # 2025-01-06（月曜日）を休日に設定
    holidays = {date(2025, 1, 6)}
    config = CalendarConfig(holidays=holidays)
    
    monday = datetime(2025, 1, 6, 10, 0)
    assert not is_workday(monday, config)  # 休日なのでFalse
    
    tuesday = datetime(2025, 1, 7, 10, 0)
    assert is_workday(tuesday, config)  # 通常の平日
```

## 後方互換性

- `calendar_config` パラメータは全ての関数でオプショナルです
- 指定しない場合、デフォルトの動作（土日のみ休日）が適用されます
- 既存のコードは変更なしで動作し続けます

## パフォーマンス最適化

- 期間を限定して休日情報を取得（デフォルト90日）
- CalendarConfig をキャッシュして複数回使用
- データベースへの問い合わせは最小限に

```python
# 推奨: スケジューリング開始前に一度だけ構築
calendar_config = build_calendar_config(calendar_repo, days_ahead=90)

# この config を複数の注文のスケジューリングで再利用
for order in orders:
    schedule_order(..., calendar_config=calendar_config)
```

## 注意事項

- RLSが有効なので、各テナントは自分のカレンダーのみアクセス可能
- 日付の重複は `unique(tenant_id, date)` 制約で防止
- `is_holiday=False` のレコードは、デフォルトの土日判定を上書きします
