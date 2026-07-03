# CLAUDE.md — `__tests__/integration/` での作業ガイドライン

このディレクトリは `@pytest.mark.integration` を付けたテストを置く場所です。
実行には **ローカル Supabase（`supabase start`）のみ** が必要で、Gmail API・Claude API
などの外部サービスには依存しません。

```bash
supabase start
cd backend && pytest __tests__/integration/ -v --run-integration
```

## このtierを使うべき場面

- RLS ポリシーなど、実際の Postgres（RLS込み）でしか検証できない挙動
- SQL RPC 関数（`supabase/migrations/` 内の `CREATE OR REPLACE FUNCTION ...`）の
  分岐ロジック — ステータス優先順位判定・UNIQUE制約による重複処理・トリガーなど、
  **外部APIの出力に依存しない決定的なDB挙動**
- `unit/` のモックでは検証できない、実際のクエリチェーン（`.eq().neq().gt()` 等の
  組み合わせ）が意図通りのSQLになっているかの確認

これらは「外部APIの精度・揺らぎ」とは無関係な決定的ロジックなので、`e2e/` で
Gmail/Claude API を経由させて検証するとテストが不必要に重く・flakyになる。
まず integration tier で書けないかを検討すること。

## 書き方の型

- テストしたいRPC・クエリを **`admin_db` 相当のクライアントで直接呼ぶ**。
  service層・router層を経由させる必要はない（それらは `unit/` でモック済み）
- RLS検証のように認証ユーザーの視点が必要な場合のみ、`conftest.py` の
  `auth_token` フィクスチャ経由で JWT を使い、`TestClient(app)` 経由でAPIを叩く
  （`test_rls_scenarios.py` を参照）
- テストデータは各テストで作成し、teardownで確実に削除する
  （`yield` フィクスチャ + `finally`、または明示的な `.delete()`）。
  他のテストや開発中のデータと衝突しないよう、識別用の一意な値
  （`uuid.uuid4()` 等）をテナントID・注文番号等に含める

## 現状の制約

- `conftest.py` の `TEST_USER_EMAIL` / `TEST_TENANT_ID` は事前にDBへ手動seedしておく
  前提のプレースホルダ。新しいシナリオを追加する際、既存ユーザーで足りない場合は
  seed方法をコメントで明記するか、テスト内で管理者クライアントを使ってセットアップ
  してから通常クライアントで検証する2段構成にする
- CI では自動実行されない（`--run-integration` を明示しない限りスキップされる）ため、
  実装者が手元でローカルSupabaseを起動して実行することが前提
