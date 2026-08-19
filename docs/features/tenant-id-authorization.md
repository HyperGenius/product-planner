# x-tenant-id ヘッダーのサーバー側検証（Issue #343）

## 課題

`x-tenant-id` ヘッダーはクライアント（フロントエンドの `localStorage.currentTenantId`）が自由に指定できる値であるにも関わらず、
`get_current_tenant_id`（`backend/app/dependencies.py`）はヘッダー値をそのまま返しており、JWTで認証されたユーザーが
実際にそのテナントの `organization_members` に所属しているかの照合を行っていなかった。

各テーブルの RLS（`is_tenant_member(tenant_id)`）が最終防衛線として機能する想定だったが、アプリ層の権限判定
（`_require_member_admin` 等）は未検証の `tenant_id` をそのままクエリ条件に使っており、将来 RLS の実装漏れが
あるテーブルが追加された場合に多層防御が効かない構造だった。

## 修正内容

`get_current_tenant_id` を、JWTから取得した `user_id`（`get_current_user_id` 依存）を用いて `organization_members`
テーブルを照合し、そのユーザーが実際に所属しているテナントであることを検証したうえで返す実装に変更した。

- 所属していない場合: `403 Forbidden`（`指定されたテナントのメンバーではありません`）
- 所属している場合: 従来通り `x-tenant-id` の値をそのまま返す

`get_current_tenant_id` は `backend/app/routers/` 配下のほぼ全てのエンドポイントで `Depends` されているため、
この一箇所の修正で全ルーターに対して所属検証がかかる。

## 影響範囲・注意点

- 既存の `get_current_user_role()` は同じ `organization_members` を再度クエリしてロールを取得する。所属チェック自体は
  `get_current_tenant_id` で先に行われるため冗長だが、ロール取得という別の責務のため実装は変更していない。
- `tenant/members.py` の `GET /tenant/members/me` は、対象テナントのメンバーでない場合に自前で `404` を返す分岐を
  持っていたが、`get_current_tenant_id` の検証が先に走るため、この分岐はレスポンスとしては到達不能になった
  （呼び出し前に `403` で弾かれる）。ハンドラ内のチェック自体は防御的コードとして残してある。
- フロントエンド（`frontend/src/lib/api-client.ts`）は引き続き `localStorage.currentTenantId` を `x-tenant-id` として
  送信するのみで変更なし。改ざんされた値が送られてきても、サーバー側の所属検証で `403` になるため対処範囲。

## テスト

- `backend/__tests__/unit/test_dependencies.py`: `get_current_tenant_id` の所属あり/なしの単体テスト
- 既存の API テストのうち、`get_current_user_id` / `get_supabase_client` を未モックだったルーター
  （`test_customers_router.py` / `test_equipments.py` / `test_equipment_groups.py`）にモックを追加
- `test_members.py` の `test_get_my_membership_not_found` は期待値を `404` → `403` に修正
