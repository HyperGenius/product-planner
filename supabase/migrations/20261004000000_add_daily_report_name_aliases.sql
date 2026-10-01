-- 日報の表記の名寄せ（マスタとの照合）と別名辞書 (Issue #488, 親Issue #485)
--
-- 日報の明細（daily_report_entries、#487）の設備・工程・顧客・製品の表記をマスタに照合する。
-- 照合結果は明細に保存せず、割り付け（#490）・未照合一覧の取得のたびに
-- 明細＋マスタ＋辞書から都度解決する（services/daily_report_name_matcher.py）。
-- 辞書やマスタを変えれば過去の明細にもそのまま反映される。
--
-- 照合の順序（いずれも別名辞書が最優先。誤った自動照合を辞書で上書きできるようにする）:
--   設備: 別名辞書 → 「N号機」の N と equipments.ledger_no（#486）→ 設備名・呼称の一致
--   工程: 別名辞書（1:N）→ process_routings.process_name の一致
--   顧客: 別名辞書 → customers.name / alias の一致（法人格・記号を無視）
--   製品: product_name_aliases（顧客単位、source='daily_report'）→ 製品名・品番の一致 → 正規化後の一致
--
-- 辞書の書き込みはユーザー JWT（事務担当者のロールに限るのは API 側で確認する）。

-- ---------------------------------------------------------------------------
-- 設備の別名辞書: 日報の「使用設備No」→ 設備
-- ---------------------------------------------------------------------------
-- 番号の無い表記（「フィルターコンプ自動組立機」等）や、台帳番号で引けない表記を吸収する。
CREATE TABLE equipment_name_aliases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  raw_text      text NOT NULL CHECK (btrim(raw_text) <> ''),
  equipment_id  bigint NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  created_by    uuid NOT NULL REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT equipment_name_aliases_tenant_id_raw_text_key UNIQUE (tenant_id, raw_text)
);

-- ---------------------------------------------------------------------------
-- 工程の別名辞書: 日報の工程名 → マスタの工程名（1:N）
-- ---------------------------------------------------------------------------
-- 「カシメ、仕上げ加工」→ {カシメ, クグシ} のように1つの表記が複数の工程を指しうるので配列で持つ。
-- 対応は工程名のレベル（製品をまたいで共通）で持ち、製品ごとの process_routings の行には
-- 割り付け時（#490）に引き当てる。
CREATE TABLE process_name_aliases (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  raw_text       text NOT NULL CHECK (btrim(raw_text) <> ''),
  process_names  text[] NOT NULL CHECK (cardinality(process_names) >= 1),
  created_by     uuid NOT NULL REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT process_name_aliases_tenant_id_raw_text_key UNIQUE (tenant_id, raw_text)
);

-- ---------------------------------------------------------------------------
-- 顧客の別名辞書: 日報の「顧客先」→ 顧客
-- ---------------------------------------------------------------------------
-- 製品の別名辞書 product_name_aliases は顧客単位（#349）なので、製品の別名を引くには
-- 先に顧客を照合する必要がある。customers.alias（1件のみ）で吸収できない表記用。
CREATE TABLE customer_name_aliases (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  raw_text     text NOT NULL CHECK (btrim(raw_text) <> ''),
  customer_id  bigint NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  created_by   uuid NOT NULL REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_name_aliases_tenant_id_raw_text_key UNIQUE (tenant_id, raw_text)
);

-- ---------------------------------------------------------------------------
-- RLS・トリガー（3テーブル共通）
-- ---------------------------------------------------------------------------
-- product_name_aliases と同じ方針: テナントメンバーが読み書きでき、created_by は
-- INSERT 時に auth.uid() と一致させ、UPDATE では変更させない。
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['equipment_name_aliases', 'process_name_aliases', 'customer_name_aliases']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format(
      'CREATE POLICY "tenant members can view %1$s" ON %1$I FOR SELECT '
      'USING (is_tenant_member(tenant_id))', t);
    EXECUTE format(
      'CREATE POLICY "tenant members can insert %1$s" ON %1$I FOR INSERT '
      'WITH CHECK (is_tenant_member(tenant_id) AND created_by = auth.uid())', t);
    EXECUTE format(
      'CREATE POLICY "tenant members can update %1$s" ON %1$I FOR UPDATE '
      'USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id))', t);
    EXECUTE format(
      'CREATE POLICY "tenant members can delete %1$s" ON %1$I FOR DELETE '
      'USING (is_tenant_member(tenant_id))', t);

    EXECUTE format(
      'CREATE TRIGGER %1$s_set_updated_at BEFORE UPDATE ON %1$I '
      'FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at()', t);
    -- preserve_product_name_alias_created_by() は「created_by を OLD の値に戻す」だけの
    -- テーブル非依存の関数なので流用する（20260819000001_add_product_name_aliases.sql）。
    EXECUTE format(
      'CREATE TRIGGER %1$s_preserve_created_by BEFORE UPDATE ON %1$I '
      'FOR EACH ROW EXECUTE PROCEDURE public.preserve_product_name_alias_created_by()', t);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 製品の別名辞書: 日報由来の登録を区別する source を追加
-- ---------------------------------------------------------------------------
-- 日報の商品名の別名は既存の product_name_aliases（顧客単位）に登録する。メール起票の
-- 照合（match_product_by_alias）からも同じ顧客の表記として使われる。
--   daily_report : 日報の未照合キュー（#489）から事務担当者が対応付けた（人間の確認済み）
ALTER TABLE product_name_aliases
  DROP CONSTRAINT product_name_aliases_source_check;
ALTER TABLE product_name_aliases
  ADD CONSTRAINT product_name_aliases_source_check
  CHECK (source IN ('manual_correction', 'auto_match_unreviewed', 'daily_report'));

ALTER TABLE product_name_alias_history
  DROP CONSTRAINT product_name_alias_history_source_check;
ALTER TABLE product_name_alias_history
  ADD CONSTRAINT product_name_alias_history_source_check
  CHECK (source IN ('manual_correction', 'auto_match_unreviewed', 'daily_report'));

-- ---------------------------------------------------------------------------
-- daily_report_name_stats: 明細の表記ごとの出現件数・最終出現日
-- ---------------------------------------------------------------------------
-- 照合は表記単位で行えば足りる（同じ表記は同じ結果になる）ので、明細を全件読まずに
-- 表記の一覧だけを取り出す。製品は顧客ごとに別名が違いうるので (顧客先, 商品名) の組で集計する。
-- SECURITY INVOKER なのでユーザー JWT から呼ぶと daily_report_entries の RLS が効く。
CREATE OR REPLACE FUNCTION daily_report_name_stats(p_tenant_id uuid)
RETURNS TABLE (
  kind            text,
  raw_text        text,
  customer_raw    text,
  entry_count     bigint,
  last_work_date  date
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT 'equipment', e.equipment_raw, NULL::text, count(*), max(e.work_date)
    FROM daily_report_entries e
   WHERE e.tenant_id = p_tenant_id AND e.equipment_raw IS NOT NULL
   GROUP BY e.equipment_raw
  UNION ALL
  SELECT 'process', e.process_raw, NULL::text, count(*), max(e.work_date)
    FROM daily_report_entries e
   WHERE e.tenant_id = p_tenant_id AND e.process_raw IS NOT NULL
   GROUP BY e.process_raw
  UNION ALL
  SELECT 'customer', e.customer_raw, NULL::text, count(*), max(e.work_date)
    FROM daily_report_entries e
   WHERE e.tenant_id = p_tenant_id AND e.customer_raw IS NOT NULL
   GROUP BY e.customer_raw
  UNION ALL
  SELECT 'product', e.product_raw, e.customer_raw, count(*), max(e.work_date)
    FROM daily_report_entries e
   WHERE e.tenant_id = p_tenant_id AND e.product_raw IS NOT NULL
   GROUP BY e.product_raw, e.customer_raw;
$$;

REVOKE EXECUTE ON FUNCTION daily_report_name_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION daily_report_name_stats(uuid) TO authenticated, service_role;
