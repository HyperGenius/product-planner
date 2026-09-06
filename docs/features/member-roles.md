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
- `backend/__tests__/api/routers/tenant/test_members.py`: `test_create_member_allowed_for_president_with_each_role`
  （Issue #328）— president が `order_handler` / `iso_officer` / `president` のいずれのロールでもメンバーを
  招待でき、`email_confirm: True` によるメール確認スキップの即時発行フローが維持されていることを検証

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

受注承認・却下ワークフロー本体は Issue #325 で実装済み。詳細は
[approval-workflow.md](approval-workflow.md) を参照。

## メンバー招待フローの新ロール対応（Issue #328）

Issue #328 は、上記の本Issue（#323）実装により大部分の要件がすでに満たされていることを確認した
（招待者ロールを `president` のみに限定するかどうかについては後述の通り別途方針判断がある）:

- `MemberCreateSchema.role` は既に新ロール四値（`president` / `iso_officer` / `order_handler` / `platform_admin`）に
  対応済みで、`create_member`（`backend/app/routers/tenant/members.py`）もそのまま新ロール値を受け付ける
- 招待フォーム（`frontend/src/app/settings/members/page.tsx`）のロール選択肢は既に新ロール名（社長 / ISO担当 /
  受注担当 / プラットフォーム管理者）で表示されている
- パスワード初期発行（president がその場で設定・共有）、`email_confirm: True` によるメール確認スキップの即時
  ログインフローは変更なく維持されている

追加対応として、president が三ロール（`order_handler` / `iso_officer` / `president`）いずれでも招待できることを
明示的に検証するテスト（`test_create_member_allowed_for_president_with_each_role`）を追加した。

招待可能ロールを本Issueの要件通り「president のみ」に限定するかどうかは、#323 で `platform_admin` にも
メンバー管理系エンドポイントを開放する方針（本ドキュメント「Backend / 権限チェック」参照、[CLAUDE.md](../../CLAUDE.md)
にも明記）が既に採用されているため、本Issueではその方針を踏襲し `platform_admin` にも招待操作を残した
（#323 の設計判断を優先）。

初回ログイン時のパスワード変更強制の要否は、本Issueのスコープ外として明示的に切り出す（要検討事項として残存）。

## 削除済みメンバーと同じメールアドレスでの再作成（Issue #386-A）

`delete_member`（`backend/app/routers/tenant/members.py`）は `organization_members` と
`member_pins` の行のみを削除し、**Supabase Auth のユーザー（`auth.users`）と `profiles` は残す**
（マルチテナントで1ユーザーが複数テナントに所属し得るため、テナントからの除外＝アカウント物理削除
にはできない）。このため削除済みメンバーと同じメールアドレスで `create_member` を呼ぶと、
`admin.create_user` が `already registered`（GoTrue のバージョンにより
`...has already been registered` / `email_exists` などメッセージは揺れる）で失敗していた。

`create_member` はこの失敗を捕捉し、`_recreate_deleted_member_or_conflict()` で以下のように分岐する:

1. メールアドレスから既存の `auth.users` の id を引く（`_find_auth_user_id_by_email()`。
   `delete_member` が `profiles` を残すため、まず `profiles.email` で引き、見つからなければ
   `auth.admin.list_users()` をページングして突き合わせる）
2. その user_id の `organization_members` を全テナント横断で確認する:
   - **どのテナントにも所属していない孤児ユーザー** → リクエストで指定されたパスワードを
     `admin.update_user_by_id` で再設定し、`profiles` を upsert（氏名の上書きを兼ねる）、
     このテナントの `organization_members` に再紐付けして 201 を返す
   - **既にこのテナントに所属** → 409「このメールアドレスはすでにこのテナントに登録されています」
   - **別テナントで使用中** → 409「このメールアドレスは別のテナントで使用されています」
   - **id を特定できない** → 安全側に倒して従来どおり 409「このメールアドレスはすでに登録されています」

フロントエンド（`frontend/src/app/settings/members/page.tsx`）は変更なし。再紐付け成功時は
新規追加と同じ 201 レスポンス・初期パスワード表示フローに乗る。

### テスト

`backend/__tests__/api/routers/tenant/test_members.py`:

- `test_create_member_relinks_orphaned_auth_user` — 孤児 auth user は再紐付けで 201、
  指定パスワードで `update_user_by_id` が呼ばれ、`organization_members` に insert される
- `test_create_member_conflict_when_email_used_in_another_tenant` — 別テナント使用中は 409、
  `update_user_by_id` は呼ばれない
- `test_create_member_conflict_when_already_in_this_tenant` — 同一テナント所属済みは 409
- `test_create_member_conflict_when_auth_user_not_locatable` — id を特定できない場合は汎用 409

### スコープ外（後続Issue）

- 対象メンバー本人へのアプリ内通知（`notifications.user_id` 追加）: Issue #388

## メンバーのパスワードリセット（Issue #386-B）

パスワードを失念したメンバーの復旧経路。初期パスワードは president がその場で発行して
口頭／紙で共有する運用（[Issue #328](#メンバー招待フローの新ロール対応issue-328)）だが、
失念時に再発行する手段が PIN リセットしかなく、パスワード自体を出し直せなかった。
メール送信基盤がない（`supabase/config.toml` の SMTP はコメントアウト）ため、
リセット結果はメール通知ではなく **president の画面表示 → 本人へ口頭／紙で共有** で完結させる。

### エンドポイント

`POST /tenant/members/{user_id}/password/reset`（`reset_member_password`,
`backend/app/routers/tenant/members.py`）

- `_require_member_admin` で `president` / `platform_admin` に限定（それ以外は 403）
- 対象ユーザーが同一テナントに所属しているか確認（未所属なら 404。テナント越えの操作を防ぐ）
- リクエストボディの新パスワード（`MemberPasswordResetSchema.password`, `min_length=8`）で
  `admin.auth.admin.update_user_by_id(user_id, {"password": ...})` を実行
- レスポンス `MemberPasswordResetResponse`（`user_id` / `new_password`）で新パスワードを
  そのまま返し、フロントで一度だけ表示する
- **PIN（`member_pins`）は変更しない**（PIN リセットは既存の
  `POST /tenant/members/{user_id}/pin/reset` で別操作）

### スキーマ

`backend/app/models/tenant/member_schemas.py` に `MemberPasswordResetSchema` /
`MemberPasswordResetResponse` を追加。

### フロントエンド

- `frontend/src/types/member.ts`: `MemberPasswordResetResponse` 型
- `frontend/src/hooks/use-tenant-members.ts`: `useResetMemberPassword()`（`{ userId, password }` を
  受け取り `new_password` を返す `useMutation`）
- `frontend/src/app/settings/members/page.tsx`: メンバー行に「パスワードをリセット」ボタン（`Lock`
  アイコン。`KeyRound` は PIN リセットで使用済み）。`Dialog` で新パスワード（`generatePassword()` で
  生成、編集・再生成可）を確認 → リセット実行 → 完了後に新パスワードをコピーボタン付きで一度だけ表示
  （新規追加時の初期パスワード表示 UI と同じパターン）

### テスト

`backend/__tests__/api/routers/tenant/test_members.py`:

- `test_reset_member_password_forbidden_for_non_admin` — `order_handler` / `iso_officer` は 403
- `test_reset_member_password_allowed_for_admin` — `president` / `platform_admin` は 200、
  レスポンスに `new_password` が返り、`update_user_by_id` がそのパスワードで呼ばれ、
  `member_pins` には触れない
- `test_reset_member_password_rejects_short_password` — 8文字未満は 422

### スコープ外（後続Issue）

- 対象メンバー本人へのアプリ内通知（`notifications.user_id` 追加）: Issue #388
- パスワードリセット時に PIN も同時に無効化するオプション（要検討事項として残存）
- 初回ログイン時のパスワード変更強制（#328 からの継続検討事項）
