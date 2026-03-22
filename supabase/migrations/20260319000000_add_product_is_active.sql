-- products テーブルに is_active カラムを追加する
-- 既存データはすべて true（有効）としてマイグレーションする

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
