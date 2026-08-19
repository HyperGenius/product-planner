# 共有端末向けPIN認証・端末信頼（Issue #342）

工場現場の共有端末（担当者ごとの専用PC・タブレットがない運用）を前提に、パスワードに代わる4桁PINを
主要な本人識別手段とし、信頼済み端末上での操作者切り替えを軽量化する。パスワードは初期発行・アカウント
復旧など例外的な操作にのみ残す。Issue #322（受注確認・承認ワークフロー）から派生し、前提Issue #343
（`x-tenant-id` のサーバー側検証）の解消後に着手した。

## 全体設計

1. **端末信頼**: `president` / `platform_admin` が使用中の端末を「信頼済み端末」として登録する
   （`POST /auth/device/register`）。発行された `device_id`（暗号乱数、`secrets.token_urlsafe(32)`）を
   ブラウザの `localStorage` に保存する。信頼は1年で自動失効し、運営側（`president`/`platform_admin`）が
   いつでも手動失効できる（`DELETE /auth/device/{device_id}`）。
2. **PINログイン**: 信頼済み端末のログイン画面では、ログイン前でもテナントメンバーの名前一覧を表示し
   （`GET /auth/device/status`）、名前を選んで4桁PINを入力するだけでログインできる
   （`POST /auth/device/pin-login`）。各メンバーは事前に自分のPINを設定しておく必要がある
   （`PATCH /tenant/members/me/pin`、`/settings/pin` 画面）。
3. **セッション長期化**: `supabase/config.toml` の `jwt_expiry` を上限値の604800秒（1週間）に延長し、
   共有端末でのリフレッシュ頻度を下げた。既存の `enable_refresh_token_rotation` によるリフレッシュ機構
   （`frontend/src/utils/supabase/middleware.ts`）はそのまま使用しており、独自のセッション機構は導入していない。

## PINログインのセッション発行方式

`supabase-py==2.26.0` の Admin API には「パスワードなしで任意ユーザーのセッションを発行する」直接的な
メソッドが存在しない。そこで以下の2段階で本物のSupabase JWTセッションを発行している
（`backend/app/routers/auth/device.py` の `pin_login`）:

1. `admin_client.auth.admin.generate_link({"type": "magiclink", "email": ...})` でハッシュ化トークンを生成
   （メール送信は発生しない）
2. `admin_client.auth.verify_otp({"token_hash": ..., "type": "magiclink"})` でセッション
   （access_token / refresh_token）を取得

発行されるのは通常のSupabase JWTであるため、`backend/app/dependencies.py` の `get_current_user_id` や
既存のRLS、既存の監査ログ（Issue #326 `order_approval_log`）を一切変更せずにそのまま整合する。

## データモデル

`supabase/migrations/20260819000000_add_device_trust_and_member_pins.sql`

- `device_trust_registrations`: 端末信頼レコード（`tenant_id`, `device_id`, `registered_by`, `created_at`,
  `expires_at`＝登録から1年後, `revoked_at`）。RLSのSELECTポリシーは `president`/`platform_admin` の
  端末管理画面用のみで、INSERT/UPDATEポリシーは設定せず全て service role（`admin_client`）経由に限定
  （`notifications` テーブルと同じ default-deny パターン）。
- `member_pins`: PINハッシュ（`tenant_id`, `user_id` 複合PK, `pin_hash`, `failed_attempts`,
  `locked_until`）。SELECTポリシーを一切設けず、PINハッシュはクライアントJWTから直接読めない。全アクセスは
  service role 経由のバックエンドロジックのみ。

## PINのブルートフォース耐性

4桁PIN（1万通り）は総当たりに弱いため、5回連続失敗で5分間ロックする
（`_MAX_FAILED_ATTEMPTS` / `_LOCKOUT_DURATION`、`backend/app/routers/auth/device.py`）。ハッシュ化は
`bcrypt` を使用。

## セキュリティリスクと運用上の前提

- **端末＝スキルトンキー化のリスク**: 信頼済み端末上ではPINのみでテナント内の任意メンバーとして
  操作できるため、端末の盗難・不正利用時の影響範囲はテナント全体に及ぶ。設置場所の施錠管理など、
  物理的なセキュリティ対策を運用側の前提とする。
- **失効経路**: `president`/`platform_admin` が `/settings/devices` 画面からいつでも端末信頼を失効できる。
  失効・期限切れの端末では、ID/パスワードによる既存のログインフローに自動的にフォールバックする
  （`frontend/src/app/login/page.tsx`）ため、アクセス手段は失われない。
- **PIN紛失時の復旧**: `president`/`platform_admin` が対象メンバーのPINを削除できる
  （`POST /tenant/members/{user_id}/pin/reset`、`/settings/members` 画面のPINリセットボタン）。削除後は
  本人が新しいPINを再設定するまでPINログインが使えず、ID/パスワードでのログインのみとなる。
- **許容しているリスク**: 4桁PIN・5回失敗ロックはブルートフォース耐性より現場での記憶容易性・入力速度を
  優先した設計判断であり、パスワードと同等の強度は意図していない。信頼済み端末という限定された経路
  でのみ有効という前提のもとで許容している。

## Backend

- `backend/app/routers/auth/device.py`（`device_router`, prefix `/auth/device`）
  - `POST /register`, `GET ""`, `DELETE /{device_id}`: 要JWT、`president`/`platform_admin` 限定
  - `GET /status`, `POST /pin-login`: 認証不要（ログイン画面から呼び出す）
- `backend/app/routers/tenant/members.py` に追加:
  - `PATCH /tenant/members/me/pin`: 本人のみ、ロール制限なし
  - `POST /tenant/members/{user_id}/pin/reset`: `president`/`platform_admin` 限定
- スキーマ: `backend/app/models/auth/device_schemas.py`, `backend/app/models/tenant/pin_schemas.py`

## Frontend

- `frontend/src/app/login/page.tsx`: `localStorage` の `deviceId` を元に端末信頼状態を確認し、信頼済みなら
  メンバー選択＋PIN入力を主表示にする。「パスワードでログイン」で既存フォームに切替可能。
- `frontend/src/app/settings/devices/page.tsx`: 端末登録・一覧・失効（`president`/`platform_admin` のみ）
- `frontend/src/app/settings/pin/page.tsx`: 自分のPIN設定（全ロール）
- `frontend/src/app/settings/members/page.tsx`: メンバー行にPINリセットボタンを追加
- `frontend/src/lib/device-auth-client.ts`: 未ログイン状態から呼び出す `/auth/device/status`,
  `/auth/device/pin-login` 用の認証不要fetchラッパー（既存の `apiClient` はセッションJWT必須のため別実装）
- `frontend/src/hooks/use-device-trust.ts`, `frontend/src/hooks/use-member-pin.ts`: 認証済みエンドポイント用
  のTanStack Queryフック

## テスト

- `backend/__tests__/api/routers/auth/test_device.py`: 権限境界・端末信頼の有効/失効/期限切れ判定・PIN照合
  （成功/失敗/ロックアウト）のFunctionalテスト
- `backend/__tests__/api/routers/tenant/test_members.py`: PIN設定・PINリセットのFunctionalテストを追加

## 運用手順

顧客向けの操作手順（端末登録・PIN設定・PINログイン・失効等）は、開発者向けの本ドキュメントとは
分離し、Wikiにまとめている:
[共有端末PIN認証 運用マニュアル](https://github.com/HyperGenius/product-planner/wiki/共有端末PIN認証-運用マニュアル)

### 開発環境（ローカル動作確認）での操作

顧客環境とは異なり、Docker・Supabase CLI・バックエンド/フロントエンドの起動が必要。

```bash
# 1. ローカルSupabaseを起動（初回はDocker必須）
supabase start

# 2. マイグレーション未適用の場合は反映（ローカルDBを全消去して再構築する）
supabase db reset

# 3. デモデータ投入（製品・設備・注文等。認証用テストユーザーはsupabase/seed.sqlで自動投入済み）
cd backend
source .venv/bin/activate
python scripts/seed_scenario.py standard_demo

# 4. バックエンド起動
uvicorn app.main:app --reload --port 8000

# 5. フロントエンド起動（別ターミナル）
cd frontend
npm run dev
```

- テストユーザー（`supabase/seed.sql` で自動投入、パスワードは共通で `Test123!`）:
  `test@example.com`（president）/ `order_handler@example.com`（order_handler）/ `iso_officer@example.com`（iso_officer）
- 上記起動後、`http://localhost:3000/login` からID/パスワードでログイン → 設定 > 端末管理 → 「この端末を信頼済みにする」→ 設定 > PIN設定、で顧客環境と同じ手順をローカルでも再現できる。
- バックエンドの自動テストのみで確認する場合はサーバー起動不要:
  ```bash
  cd backend
  pytest __tests__/unit/ __tests__/api/          # DB不要
  pytest __tests__/integration/ --run-integration # ローカルSupabase起動が必要
  ```
- 動作確認後にローカルDBをクリーンな状態へ戻す場合は `supabase db reset` を再実行し、必要に応じて手順3のシードを再投入する（本番Supabaseに対しては絶対に実行しないこと。CLAUDE.mdの本番接続手順を参照）。
