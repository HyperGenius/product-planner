# SaaS管理者向け週次納期確認件数ダッシュボード

## 概要

SaaS管理者がテナント別の週次納期確認件数をグラフで確認できる管理機能。

## 実装内容

### データモデル

`orders` テーブルに `confirmed_at timestamptz` カラムを追加。
`POST /orders/{id}/confirm` 実行時に記録される。
入力手段（手入力・メール・カメラ）に関わらず同一エンドポイントを通るため、全入力経路を一元カウントできる。

### API

`GET /admin/metrics/weekly-confirmations`

- 認可: JWT のユーザーが `PLATFORM_ADMIN_EMAIL` 環境変数と一致する場合のみ
- レスポンス: `[{ tenant_id, tenant_name, week_start, count }]`（直近12週分）
- 非管理者は 403 を返す

### フロントエンド

- `/admin` ページにテナント別・週次棒グラフ（Recharts）を表示
- テナントプルダウンで個別テナントの推移を確認可能
- 直近12週の全テナント合計サマリーカードを表示

## 環境変数

| 変数名 | 説明 | 設定場所 |
|--------|------|----------|
| `PLATFORM_ADMIN_EMAIL` | プラットフォーム管理者のメールアドレス | `backend/.env`、本番環境の環境変数 |

## 関連ファイル

- `supabase/migrations/20260608000000_add_confirmed_at_to_orders.sql`
- `backend/app/routers/admin/metrics.py`
- `backend/app/routers/transaction/orders.py`（confirm エンドポイント）
- `frontend/src/app/admin/page.tsx`
- `frontend/src/hooks/use-admin-metrics.ts`
