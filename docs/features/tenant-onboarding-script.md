# テナントオンボーディングスクリプト

## 概要

`backend/scripts/create_tenant.py` は、新規顧客テナントを本番 Supabase へコマンド一発で作成する CLI スクリプト。

## 使い方

```bash
cd backend
python scripts/create_tenant.py \
  --company-name "株式会社〇〇" \
  --owner-email "xxx@example.com" \
  --owner-name "山田太郎"
```

### 出力例

```
=== テナント作成完了 ===
テナント名  : 株式会社〇〇
テナント ID : xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
ユーザー ID : yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy
メール     : xxx@example.com
初期パスワード: Xy7#mK2pQ9!rNvLw
======================
※ 初期パスワードを安全に顧客へ伝達してください
```

初期パスワードは **標準出力のみ** に表示される。ファイルには保存されない。

## 必要な環境変数

| 変数名 | 説明 |
|---|---|
| `SUPABASE_URL` | 本番 Supabase の URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service Role Key |

`backend/.env` に設定するか、環境変数として渡す。

## 処理フロー

1. ランダムパスワード生成（英大小数記号混在、16文字以上）
2. `admin.create_user()` でユーザー作成
   - `user_metadata.tenant_name` を渡すことで signup trigger が `tenants` + `organization_members(role='admin')` を自動作成
3. `profiles` テーブルへ upsert（`full_name` / `email`）
4. `organization_members` から `tenant_id` を取得して結果表示

## エラーハンドリング

| 失敗箇所 | 挙動 |
|---|---|
| `create_user()` 失敗（重複メール含む） | エラーメッセージを表示して終了 |
| `profiles` INSERT 失敗 | Auth ユーザー削除 + `tenants` レコード削除してロールバック |
| ロールバック失敗 | `user_id` / `tenant_id` を stderr に出力して手動対応を促す |

## 関連ファイル

- `backend/app/routers/tenant/members.py` — admin.create_user() の参照実装
- `supabase/migrations/20260318000000_create_signup_trigger.sql` — signup trigger 定義
- `supabase/migrations/20260318100000_create_profiles.sql` — profiles テーブル定義
