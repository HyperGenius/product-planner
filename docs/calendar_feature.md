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

## API エンドポイント（実装例）

休日管理用のAPIエンドポイントを追加する場合の例：

```python
from fastapi import APIRouter, Depends
from app.dependencies import get_calendar_repo, get_current_tenant_id
from app.models.common.work_calendar import WorkCalendarCreate

calendar_router = APIRouter(prefix="/calendars", tags=["Calendar"])

@calendar_router.post("/holidays")
def create_holiday(
    holiday_data: WorkCalendarCreate,
    tenant_id: str = Depends(get_current_tenant_id),
    repo: CalendarRepository = Depends(get_calendar_repo)
):
    """休日を登録"""
    result = repo.create_or_update_holiday(
        target_date=holiday_data.date,
        is_holiday=holiday_data.is_holiday,
        note=holiday_data.note
    )
    return result

@calendar_router.get("/holidays/{year}/{month}")
def get_monthly_holidays(
    year: int,
    month: int,
    repo: CalendarRepository = Depends(get_calendar_repo)
):
    """月ごとの休日情報を取得"""
    start_date = date(year, month, 1)
    if month == 12:
        end_date = date(year + 1, 1, 1)
    else:
        end_date = date(year, month + 1, 1)
    
    return repo.get_holidays_in_range(start_date, end_date)
```

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
