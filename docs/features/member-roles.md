# メンバーロールの四値拡張（president/iso_officer/order_handler/platform_admin）

Issue #323 で実装。受注確認・承認ワークフロー（#322）の権限基盤として、`organization_members.role` を
`admin`/`member` の二値から `president` / `iso_officer` / `order_handler` / `platform_admin` の四値に拡張した。

## ロール定義

| ロール | 想定業務 | 権限 |
|---|---|---|
| `president`（社長） | 受注承認・却下、メンバー管理、工程マスタ編集 | 旧 `admin` 権限一式 + 監査ログ閲覧 |
| `iso_officer`（ISO担当） | 承認プロセスの監査証跡の閲覧・出力 | 閲覧・出力のみ（編集・承認・メンバー管理は不可） |
| `order_handler`（受注担当） | 下書き注文の表記揺れ修正、承認依頼の送信 | 上記操作のみ（承認・メンバー管理は不可） |
| `platform_admin`（プラットフォーム管理者） | 閲覧全般、メンバー管理、設定サポート | 承認操作（受注承認・工程確定等）は含めない |

`iso_officer` の監査ログ閲覧・出力機能自体は本Issueのスコープ外（#322 以降で実装予定）。本Issueでは
ロール値の追加と、既存の `admin` 限定操作の権限判定の付け替えまでを行う。

`platform_admin` はプラットフォーム運営側がテナントの設定・メンバー管理をサポートするためのロール。
メンバー管理系エンドポイント（`tenant/members.py`）は `president` と同等の権限を持つが、承認操作
（工程確定 `is_confirmed` トグル等）には含めない。

## 既存データの移行方針

`supabase/migrations/20260810000000_expand_member_roles.sql` にて機械的に読み替える:

- `admin` → `president`（受注承認・メンバー管理などの既存 admin 権限一式をそのまま引き継ぐため）
- `member` → `order_handler`（表記揺れ修正・承認依頼送信という現行の一般メンバー運用に相当するため）

同マイグレーションで `organization_members.role` に `CHECK (role IN ('president','iso_officer','order_handler'))`
制約を追加し、カラムのデフォルト値も `order_handler` に変更。サインアップ時のトリガー関数
（`handle_new_user`）が最初のメンバーに付与するロールも `president` に変更した。

続く `supabase/migrations/20260810000001_add_platform_admin_role.sql` で CHECK 制約に `platform_admin` を追加。
`platform_admin` は既存データの機械移行対象ではなく、必要なテナントに手動で付与する想定。

## Backend

### 権限チェック

- `backend/app/dependencies.py` の `get_current_user_role()`: 返り値の想定を四値に更新（ロジックは変更なし）
- `backend/app/routers/tenant/members.py`: `_require_admin` を `_require_member_admin` にリネームし、
  `president` または `platform_admin` を許可するよう変更（`_MEMBER_ADMIN_ROLES` 定数）。メンバー管理系
  エンドポイント（一覧取得・追加・更新・削除）はこの2ロールに開放
  - 「自分自身のメンバー管理権限（president/platform_admin）を降格できない」ガードは、呼び出しユーザー
    自身が現在持つロールを基準に判定するよう一般化（例: platform_admin が自分のロールを order_handler に
    変更しようとすると400）
  - 「テナントに該当ロールが0人になる変更/削除を禁止」するガードも president/platform_admin それぞれ独立に
    適用（例: platform_admin が1人しかいないテナントでその platform_admin を削除しようとすると400）
- `backend/app/routers/master/process_routings.py`: `PATCH /process-routings/{id}` で `is_confirmed` を変更できるのは
  `president` のみ（`platform_admin` は対象外 — 承認操作は含めない方針のため）

### スキーマ

`backend/app/models/tenant/member_schemas.py` に
`MemberRole = Literal["president", "iso_officer", "order_handler", "platform_admin"]` を定義し、
`MemberCreateSchema` / `MemberUpdateSchema` の `role` フィールドの型として使用。新規メンバーのデフォルトロールは `order_handler`。

### テスト

- `backend/__tests__/api/routers/tenant/test_members.py`: `order_handler` / `iso_officer` がメンバー管理系
  エンドポイントで403になること、`president` / `platform_admin` は許可されることを検証。platform_admin の
  自己降格禁止・最後の1人削除禁止のガードも検証
- `backend/__tests__/api/routers/master/test_process_routings.py`: `is_confirmed` 変更が `president` 以外で403、
  `president` で成功することを検証するテストを追加

## Frontend

- `frontend/src/types/member.ts`: `MemberRole` を四値に変更
- `frontend/src/app/settings/members/page.tsx`: ロール選択肢・バッジ表示を四値に対応（社長=default、
  ISO担当=outline、受注担当=secondary、プラットフォーム管理者=outline のバッジ variant）。新規追加時の
  デフォルトロールは `order_handler`
- `frontend/src/app/master/products/page.tsx`: `isAdmin` 判定を `role === "president" || role === "platform_admin"`
  に変更（製品の有効/無効化操作の表示制御。設定サポート業務に該当するため platform_admin にも開放）
- `frontend/src/components/product-routings-dialog.tsx`: `isAdmin` 判定は `role === "president"` のまま
  （工程確定 `is_confirmed` トグルの表示制御。バックエンドの承認操作制限と一致させ、platform_admin には開放しない）

## スコープ外（今後のIssueで対応）

- `iso_officer` 向けの監査ログ・承認履歴閲覧UI/APIの実装
- 受注承認・却下ワークフロー本体（#322）
