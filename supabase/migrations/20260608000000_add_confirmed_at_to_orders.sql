ALTER TABLE orders ADD COLUMN confirmed_at timestamptz;

COMMENT ON COLUMN orders.confirmed_at IS '納期確認日時（confirm操作を行った日時）';
