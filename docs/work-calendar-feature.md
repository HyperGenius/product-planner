# 稼働カレンダー編集画面 - 実装ドキュメント

## 概要

工場管理者が Web 画面から会社の休日や臨時稼働日を設定できる機能です。土曜・日曜はデフォルトで休日として扱われ、毎月の手動設定は不要です。

## 実装された機能

### Backend API

#### エンドポイント

1. **GET /calendars**
   - 指定月のカレンダー情報を取得
   - パラメータ: `year`（年）、`month`（1-12）
   - レスポンス: カレンダー情報の配列

2. **POST /calendars**
   - カレンダー日付を作成/更新（upsert）
   - リクエストボディ:
     ```json
     { "date": "2024-01-01", "is_holiday": true, "note": "元日" }
     ```
   - レスポンス: 作成/更新されたカレンダー情報

3. **POST /calendars/batch**
   - 複数日の一括更新
   - リクエストボディ:
     ```json
     { "dates": ["2024-01-01", "2024-01-02"], "is_holiday": true, "note": "年末年始休暇" }
     ```
   - レスポンス: `{ "updated_count": 2, "total_count": 2 }`

4. **POST /calendars/import-national-holidays**
   - 内閣府公開の祝日 CSV から指定年の国民の祝日を一括インポート
   - パラメータ: `year`（2020〜2100）
   - 処理内容: `https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv` を `httpx` で取得し Shift-JIS デコード → 指定年の行のみ抽出して upsert
   - レスポンス: `{ "imported_count": 16, "year": 2026 }`

#### 実装ファイル

- `backend/app/routers/master/calendars.py`: カレンダー API ルーター
- `backend/__tests__/api/routers/master/test_calendars.py`: API テスト

### Frontend UI

#### ページ: `/master/calendar`

##### 機能

1. **土日のデフォルト休日表示**
   - DB レコードなしでも当月の全土日を薄赤（`bg-red-100`）で表示
   - スケジューラの `CalendarConfig` デフォルト動作（土日＝休日）と UI を一致させ、設定忘れによる誤認を防ぐ

2. **国民の祝日インポート**
   - 年セレクター（現在年〜翌々年）＋「インポート」ボタン
   - 内閣府公開 CSV を取得してカレンダーに一括登録
   - インポート件数を toast で表示

3. **臨時休日マルチ選択設定**
   - 「臨時休日設定」ボタンでモード切替
   - カレンダーで複数日をクリック選択（`DayPicker mode="multiple"`）
   - 備考入力 → 「休日に設定」ボタンで一括保存

4. **日付の個別設定（通常モード）**
   - 日付をクリックすると編集ダイアログが開く
   - ステータス（稼働日/休日）と備考を入力して保存

5. **過去日付の編集不可**
   - `DayPicker` の `disabled={{ before: today }}` で過去日付を全モードで無効化

6. **視覚的表示（3種類）**
   - 薄赤（`bg-red-100`）: 土日（デフォルト休日）
   - 赤（`bg-red-300`）: DB 登録済み祝日・臨時休日
   - 青（`bg-blue-200`）: 臨時稼働日（土日の出勤日など）

#### 実装ファイル

- `frontend/src/app/master/calendar/page.tsx`: カレンダーページコンポーネント
- `frontend/src/hooks/use-calendars.ts`: カレンダー操作用カスタムフック（`useImportNationalHolidays` を含む）
- `frontend/src/types/calendar.ts`: TypeScript 型定義
- `frontend/src/components/layout/app-sidebar.tsx`: サイドバーにメニュー追加

## 使用ライブラリ

- **react-day-picker**: カレンダー UI コンポーネント
- **date-fns**: 日付操作ユーティリティ
- **httpx** (backend): 内閣府祝日 CSV の非同期取得

## データベーススキーマ

`work_calendars` テーブルを使用（スキーマ変更なし）:

```sql
CREATE TABLE work_calendars (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  date DATE NOT NULL,
  is_holiday BOOLEAN NOT NULL DEFAULT FALSE,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, date)
);
```

**設計方針**: DB には「デフォルトから逸脱する日付」のみ記録する。
- 土日を明示的に稼働日にした場合: `is_holiday=false` で記録
- 平日を休日にした場合（祝日・臨時休日）: `is_holiday=true` で記録
- 記録のない土日はスケジューラ・UI ともに自動的に休日として扱う

## セキュリティ

- RLS (Row Level Security) によるテナント間のデータ分離
- JWT トークン認証
- テナント ID の検証

## テスト

- バックエンド API のユニットテスト: `backend/__tests__/api/routers/master/test_calendars.py`

## 今後の拡張可能性

- 隔週土曜日稼働などのパターン設定
- カレンダーのコピー（前年のカレンダーをコピー）
- エクスポート/インポート機能
