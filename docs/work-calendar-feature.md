# 稼働カレンダー編集画面 - 実装ドキュメント

## 概要

この機能は、工場管理者が Web 画面から会社の休日や臨時稼働日を設定できるようにするものです。

## 実装された機能

### Backend API

#### エンドポイント

1. **GET /calendars**
   - 指定月のカレンダー情報を取得
   - パラメータ:
     - `year`: 年（例: 2024）
     - `month`: 月（1-12）
   - レスポンス: カレンダー情報の配列

2. **POST /calendars**
   - カレンダー日付を作成/更新（upsert）
   - リクエストボディ:
     ```json
     {
       "date": "2024-01-01",
       "is_holiday": true,
       "note": "元日"
     }
     ```
   - レスポンス: 作成/更新されたカレンダー情報

3. **POST /calendars/batch**
   - 複数日の一括更新
   - リクエストボディ:
     ```json
     {
       "dates": ["2024-01-01", "2024-01-02", "2024-01-03"],
       "is_holiday": true,
       "note": "年末年始休暇"
     }
     ```
   - レスポンス: 
     ```json
     {
       "updated_count": 3,
       "total_count": 3
     }
     ```

#### 実装ファイル

- `backend/app/routers/master/calendars.py`: カレンダー API ルーター
- `backend/__tests__/api/routers/master/test_calendars.py`: API テスト

### Frontend UI

#### ページ: `/master/calendar`

##### 機能

1. **月次カレンダー表示**
   - 現在の月のカレンダーを表示
   - 前月/翌月への移動ボタン

2. **日付の個別設定**
   - 日付をクリックすると編集ダイアログが開く
   - ステータス（稼働日/休日）の選択
   - 備考（例：創立記念日、臨時出勤）の入力

3. **一括設定機能**
   - 「土日を休日に設定」ボタン: 現在月の全ての土曜日・日曜日を休日に設定
   - 「土曜日を稼働日に設定」ボタン: 現在月の全ての土曜日を稼働日に設定

4. **視覚的表示**
   - 休日: 赤色の背景
   - 臨時稼働日: 青色の背景
   - 凡例表示

#### 実装ファイル

- `frontend/src/app/master/calendar/page.tsx`: カレンダーページコンポーネント
- `frontend/src/hooks/use-calendars.ts`: カレンダー操作用カスタムフック
- `frontend/src/types/calendar.ts`: TypeScript 型定義
- `frontend/src/components/layout/app-sidebar.tsx`: サイドバーにメニュー追加

## 使用ライブラリ

- **react-day-picker**: カレンダー UI コンポーネント
- **date-fns**: 日付操作ユーティリティ

## データベーススキーマ

既存の `work_calendars` テーブルを使用:

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

## セキュリティ

- RLS (Row Level Security) によるテナント間のデータ分離
- JWT トークン認証
- テナント ID の検証
- CodeQL スキャンでセキュリティ脆弱性なし

## テスト

- バックエンド API のユニットテスト: 3 件（全て合格）
- セキュリティスキャン: 問題なし

## 使用方法

1. サイドバーの「Master Data」→「Work Calendar」をクリック
2. カレンダーが表示される
3. 日付をクリックして個別に設定、または一括設定ボタンを使用
4. 変更は即座にデータベースに保存される

## 今後の拡張可能性

- 祝日の自動取り込み
- 隔週土曜日稼働などのパターン設定
- カレンダーのコピー（前年のカレンダーをコピー）
- エクスポート/インポート機能
