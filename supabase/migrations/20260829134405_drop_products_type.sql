-- Issue #352: products.type カラムの廃止
--
-- products.type は「当初 name 単一フィールドしか無かった時代」の旧フィールドで、
-- 新規データでは常に空。製品マスタの意味を code=図番 / name=品名 の 2 列に固定する
-- 方針転換（カラムリネームは行わず、テーブル内データを正規化する）に伴い、
-- 未使用の type 列を削除する。
--
-- 本番適用は CLAUDE.md「本番 Supabase への接続」に従い、session pooler の --db-url +
-- --dry-run 確認 → ユーザー承認 を経てから実施すること。

ALTER TABLE products DROP COLUMN IF EXISTS type;
