-- order_number を nullable に変更
ALTER TABLE orders ALTER COLUMN order_number DROP NOT NULL;

-- 既存の UNIQUE 制約を削除
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_tenant_id_order_number_key;

-- NULL を除外した部分ユニークインデックスに置き換え
CREATE UNIQUE INDEX orders_tenant_id_order_number_idx
  ON orders (tenant_id, order_number)
  WHERE order_number IS NOT NULL;

-- 起票元区分カラム追加 (manual: 手動入力, email: メール起票)
ALTER TABLE orders
  ADD COLUMN source_type text NOT NULL DEFAULT 'manual'
  CHECK (source_type IN ('manual', 'email'));

-- 生メール本文カラム追加 (nullable、メール起票時のみ使用)
ALTER TABLE orders ADD COLUMN source_raw text;
