# メンバーロールの三値拡張（president/iso_officer/order_handler）

Issue #323 で実装。受注確認・承認ワークフロー（#322）の権限基盤として、`organization_members.role` を
`admin`/`member` の二値から `president` / `iso_officer` / `order_handler` の三値に拡張した。

## ロール定義

| ロール | 想定業務 | 権限 |
|---|---|---|
| `president`（社長） | 受注承認・却下、メンバー管理、工程マスタ編集 | 旧 `admin` 権限一式 + 監査ログ閲覧 |
| `iso_officer`（ISO担当） | 承認プロセスの監査証跡の閲覧・出力 | 閲覧・出力のみ（編集・承認・メンバー管理は不可） |
| `order_handler`（受注担当） | 下書き注文の表記揺れ修正、承認依頼の送信 | 上記操作のみ（承認・メンバー管理は不可） |

`iso_officer` の監査ログ閲覧・出力機能自体は本Issueのスコープ外（#322 以降で実装予定）。本Issueでは
ロール値の追加と、既存の `admin` 限定操作の権限判定の付け替えまでを行う。

## 既存データの移行方針

`supabase/migrations/20260810000000_expand_member_roles.sql` にて機械的に読み替える:

- `admin` → `president`（受注承認・メンバー管理などの既存 admin 権限一式をそのまま引き継ぐため）
- `member` → `order_handler`（表記揺れ修正・承認依頼送信という現行の一般メンバー運用に相当するため）

同マイグレーションで `organization_members.role` に `CHECK (role IN ('president','iso_officer','order_handler'))`
制約を追加し、カラムのデフォルト値も `order_handler` に変更。サインアップ時のトリガー関数
（`handle_new_user`）が最初のメンバーに付与するロールも `president` に変更した。

## Backend

### 権限チェック

- `backend/app/dependencies.py` の `get_current_user_role()`: 返り値の想定を三値に更新（ロジックは変更なし）
- `backend/app/routers/tenant/members.py`: `_require_admin` を `_require_president` にリネーム。メンバー管理系エンドポイント
  （一覧取得・追加・更新・削除）はすべて `president` 限定のまま。「テナントに president が0人になる変更/削除を禁止」する
  ガード（旧: admin 0人ガード）も同様に読み替え
- `backend/app/routers/master/process_routings.py`: `PATCH /process-routings/{id}` で `is_confirmed` を変更できるのは
  `president` のみ（旧: `admin`）

### スキーマ

`backend/app/models/tenant/member_schemas.py` に `MemberRole = Literal["president", "iso_officer", "order_handler"]` を追加し、
`MemberCreateSchema` / `MemberUpdateSchema` の `role` フィールドの型として使用。新規メンバーのデフォルトロールは `order_handler`。

### テスト

- `backend/__tests__/api/routers/tenant/test_members.py`（新規）: `order_handler` / `iso_officer` がメンバー管理系
  エンドポイントで403になること、`president` は許可されることを検証
- `backend/__tests__/api/routers/master/test_process_routings.py`: `is_confirmed` 変更が `president` 以外で403、
  `president` で成功することを検証するテストを追加

## Frontend

- `frontend/src/types/member.ts`: `MemberRole` を三値に変更
- `frontend/src/app/settings/members/page.tsx`: ロール選択肢・バッジ表示を三値に対応（社長=default、ISO担当=outline、
  受注担当=secondary のバッジ variant）。新規追加時のデフォルトロールは `order_handler`
- `frontend/src/app/master/products/page.tsx`, `frontend/src/components/product-routings-dialog.tsx`:
  `isAdmin` 判定を `currentMember?.role === "president"` に変更（工程確定操作・製品の有効/無効化操作の表示制御）

## スコープ外（今後のIssueで対応）

- `iso_officer` 向けの監査ログ・承認履歴閲覧UI/APIの実装
- 受注承認・却下ワークフロー本体（#322）
