-- ==========================================
-- Gmail Order Intake v2
-- ==========================================

-- pg_trgm: 製品名の類似度検索
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS products_name_trgm_idx
  ON products USING gin (name gin_trgm_ops);

-- ==========================================
-- orders: email 起票向けカラム追加
-- ==========================================

-- product_id を nullable に（メール起票時は抽出できない場合あり）
ALTER TABLE orders ALTER COLUMN product_id DROP NOT NULL;

-- quantity を nullable に（抽出できない場合は 0 でなく null として担当者が確認）
ALTER TABLE orders ALTER COLUMN quantity DROP NOT NULL;

-- Claude が抽出した生の製品名文字列
ALTER TABLE orders ADD COLUMN IF NOT EXISTS extracted_product_name text;

-- pg_trgm 候補リスト: [{"product_id": 12, "name": "...", "score": 0.82}, ...]
ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_candidates jsonb;

-- ==========================================
-- gmail_label_tenants: ラベル名 → tenant_id マッピング
-- ==========================================
CREATE TABLE IF NOT EXISTS gmail_label_tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label_name  text NOT NULL UNIQUE,  -- e.g. "テナントA"
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE gmail_label_tenants ENABLE ROW LEVEL SECURITY;
-- Cron は Service Role Key でアクセスするため RLS ポリシーは不要

-- ==========================================
-- customers: email 検索用インデックス
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_customers_tenant_email
  ON customers (tenant_id, email)
  WHERE email IS NOT NULL;

-- ==========================================
-- match_products_by_name: pg_trgm RPC 関数
-- ==========================================
CREATE OR REPLACE FUNCTION match_products_by_name(
  query_text          text,
  p_tenant_id         uuid,
  similarity_threshold float DEFAULT 0.3
)
RETURNS TABLE (id bigint, name text, score float)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    p.id,
    p.name,
    similarity(p.name, query_text)::float AS score
  FROM products p
  WHERE p.tenant_id = p_tenant_id
    AND similarity(p.name, query_text) >= similarity_threshold
  ORDER BY score DESC;
$$;
