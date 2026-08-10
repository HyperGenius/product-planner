-- ==========================================
-- public スキーマの標準ロールへの権限復旧
-- ==========================================
-- ローカル Supabase CLI (2.113.0 で確認) で `supabase db reset` を実行すると、
-- anon / authenticated / service_role に対する public スキーマ配下の
-- テーブル・シーケンス・関数への基本権限（SELECT/INSERT/UPDATE/DELETE/EXECUTE等）が
-- 自動付与されず、RLSポリシーの評価より前に
-- "permission denied for table ..." (SQLSTATE 42501) で弾かれる事象を確認した。
-- 通常はSupabase側のブートストラップで自動的に GRANT/ALTER DEFAULT PRIVILEGES が
-- 設定されるはずだが、何らかの理由で欠落していたため、本マイグレーションで明示的に
-- 宣言する。
--
-- 本番 Supabase では既に正しく権限が付与されている想定のため、以下は
-- 冪等な再付与（既存権限の再宣言）にしかならず、実害はない。
-- ==========================================

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;

-- 今後 (このマイグレーション以降) に作成されるテーブル・シーケンス・関数にも
-- 同様の権限が自動付与されるようにする
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
