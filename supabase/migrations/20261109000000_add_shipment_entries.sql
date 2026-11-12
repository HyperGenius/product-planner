-- 弥生の得意先別売上明細表の解析・名寄せ (Issue #667, #662 フェーズ2)
--
-- shipment_files（#662 / #664）に保存された弥生のエクスポート（帳票「得意先別売上明細表」の .xlsx）を
-- cron（GET /api/cron/parse-shipment-files）で解析し、商品の行を shipment_entries に保存する。
-- 受注との突合（送品の消し込みの候補）は保存せず、参照のたびにバックエンドが求める
-- （辞書・受注の変更を再計算なしで反映するため。日報の名寄せ #488 と同じ考え方）。
--
-- 明細は足し込まず、ファイルに書かれた期間（3行目）の**日ごと**に、その日を含む最新のファイルの中身へ
-- 丸ごと置き換える。伝票番号は一意でなく（採番が戻ったことがある）、行番号の列も無く、まったく同じ内容の
-- 行もありうるので、行単位の冪等キーは作れない。期間の重なり方が違うファイル（当月分と2か月分など）が
-- 来ても、日ごとに「その日を含むファイルのうち最新のもの」の明細だけが残る。
-- 版の新旧は file_modified_at → received_at で決める（日報の replace_daily_report_sheet_entries と同じ）。
--
-- 書き込みは cron（service role）のみ。辞書（得意先・商品の対応）と対象外はユーザー JWT で書く。
--
-- 顧客・製品を参照する FK（shipment_customer_links / shipment_product_links）は ON DELETE CASCADE にし、
-- 顧客・製品の統合（merge_customers / merge_products）の付け替え対象には入れない。統合で消えた対応は
-- 名寄せの画面で未照合に戻るので、付け直してもらう（対応の件数は得意先・商品の数＝数十件の規模）。

-- ---------------------------------------------------------------------------
-- shipment_files: 解析の処理状態と結果
-- ---------------------------------------------------------------------------
-- parse_status:
--   pending     未処理（cron の処理対象。既存の行もこの値になり、初回の cron で解析される）
--   parsed      解析済み（期間のすべての日が新しいファイルに置き換わっていて反映しなかった場合も含む）
--   unsupported 未対応の形式（.csv / .txt。実物のエクスポートは .xlsx）
--   failed      解析失敗（見出し・期間を読めない、ブックとして開けない）。詳細はログにのみ残し、
--               parse_error には固定文言を入れる。再処理するときは parse_status を 'pending' に戻す
-- replace_result: replaced（期間のすべての日を置き換えた）/ partial（一部の日は新しいファイルが残った）/
--   stale（すべての日で新しいファイルが残った）
ALTER TABLE shipment_files
  ADD COLUMN parse_status text NOT NULL DEFAULT 'pending'
    CHECK (parse_status IN ('pending', 'parsed', 'unsupported', 'failed')),
  ADD COLUMN parsed_at timestamptz,
  ADD COLUMN parse_error text,
  ADD COLUMN period_start date,
  ADD COLUMN period_end date,
  ADD COLUMN entry_count integer CHECK (entry_count >= 0),
  ADD COLUMN skipped_count integer CHECK (skipped_count >= 0),
  ADD COLUMN replace_result text CHECK (replace_result IN ('replaced', 'partial', 'stale'));

CREATE INDEX idx_shipment_files_pending
  ON shipment_files (received_at)
  WHERE parse_status = 'pending';

-- ---------------------------------------------------------------------------
-- shipment_coverage: 日ごとに「どのファイルの明細が載っているか」
-- ---------------------------------------------------------------------------
CREATE TABLE shipment_coverage (
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  sales_date          date NOT NULL,
  source_file_id      uuid NOT NULL REFERENCES shipment_files(id) ON DELETE CASCADE,
  source_version_at   timestamptz NOT NULL,
  source_received_at  timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, sales_date)
);

ALTER TABLE shipment_coverage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can view shipment coverage" ON shipment_coverage
  FOR SELECT
  USING (is_tenant_member(tenant_id));

CREATE INDEX idx_shipment_coverage_source_file ON shipment_coverage (source_file_id);

-- ---------------------------------------------------------------------------
-- shipment_entries: 売上明細の商品の行（1行＝弥生の1行）
-- ---------------------------------------------------------------------------
-- 《消費税》行・<<総合計>> 行（商品コードが空）は保存しない。単価・原単価・粗利益・金額は持たない
-- （請求の情報はアプリに置かない）。コード類は弥生の値のまま（前後の空白のみ除去、先頭の0は残す）で、
-- 照合のときに正規化する。数量がマイナスの行（赤伝）もそのまま保存し、合算で打ち消す。
-- row_no はファイルの中での行の順番（Excel の行番号）。
CREATE TABLE shipment_entries (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  source_file_id  uuid NOT NULL REFERENCES shipment_files(id) ON DELETE CASCADE,
  row_no          integer NOT NULL CHECK (row_no > 0),
  sales_date      date NOT NULL,
  slip_no         text,
  customer_code   text NOT NULL CHECK (btrim(customer_code) <> ''),
  customer_name   text,
  product_code    text NOT NULL CHECK (btrim(product_code) <> ''),
  product_name    text,
  quantity        integer,
  unit            text,
  note            text,
  parse_issues    jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE shipment_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can view shipment entries" ON shipment_entries
  FOR SELECT
  USING (is_tenant_member(tenant_id));

CREATE INDEX idx_shipment_entries_tenant_sales_date
  ON shipment_entries (tenant_id, sales_date);

CREATE INDEX idx_shipment_entries_source_file
  ON shipment_entries (source_file_id);

-- ---------------------------------------------------------------------------
-- replace_shipment_entries: ファイルの期間の明細を、日ごとに最新のファイルの中身で置き換える
-- ---------------------------------------------------------------------------
-- 期間 [p_period_start, p_period_end] の日のうち、まだどのファイルも載っていない日と、載っている
-- ファイルが p_source_file_id より古い（または同じ）日を「置き換える日」にする。その日の明細を消して
-- p_entries のうち売上日がその日のものを入れ、shipment_coverage を書き換える。古い明細の DELETE と
-- 新しい明細の INSERT を1トランザクションで行い、途中で失敗しても明細が消えないようにする。
-- 期間の判定が日をまたいで競合しないよう、テナント単位で advisory lock を取る。
--
-- 戻り値: {"status": "replaced" | "partial" | "stale", "entry_count": 入れた行数}
--
-- cron（service role）からのみ呼ぶ。p_tenant_id は呼び出し側が shipment_files の行から解決した値で、
-- ファイルが別テナントのものなら例外にする。
CREATE OR REPLACE FUNCTION replace_shipment_entries(
  p_tenant_id       uuid,
  p_source_file_id  uuid,
  p_period_start    date,
  p_period_end      date,
  p_entries         jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_new_version_at   timestamptz;
  v_new_received_at  timestamptz;
  v_total_days       integer;
  v_won_days         date[];
  v_entry_count      integer;
BEGIN
  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end < p_period_start THEN
    RAISE EXCEPTION 'invalid shipment period' USING ERRCODE = '22023';
  END IF;
  -- 帳票の期間は1か月〜数か月。誤読で日の数が膨らまないよう上限を置く
  v_total_days := p_period_end - p_period_start + 1;
  IF v_total_days > 400 THEN
    RAISE EXCEPTION 'shipment period too long' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(f.file_modified_at, f.received_at), f.received_at
    INTO v_new_version_at, v_new_received_at
    FROM shipment_files f
   WHERE f.id = p_source_file_id
     AND f.tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipment file not found for tenant';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('shipment_entries:' || p_tenant_id::text, 0)
  );

  SELECT array_agg(d.sales_date ORDER BY d.sales_date)
    INTO v_won_days
    FROM (
      SELECT gs::date AS sales_date
        FROM generate_series(p_period_start, p_period_end, interval '1 day') AS gs
    ) d
    LEFT JOIN shipment_coverage c
      ON c.tenant_id = p_tenant_id
     AND c.sales_date = d.sales_date
   WHERE c.sales_date IS NULL
      OR (c.source_version_at, c.source_received_at)
         <= (v_new_version_at, v_new_received_at);

  IF v_won_days IS NULL THEN
    RETURN jsonb_build_object('status', 'stale', 'entry_count', 0);
  END IF;

  DELETE FROM shipment_entries
   WHERE tenant_id = p_tenant_id
     AND sales_date = ANY (v_won_days);

  INSERT INTO shipment_entries (
    tenant_id, source_file_id, row_no, sales_date, slip_no,
    customer_code, customer_name, product_code, product_name,
    quantity, unit, note, parse_issues
  )
  SELECT
    p_tenant_id, p_source_file_id, e.row_no, e.sales_date, e.slip_no,
    e.customer_code, e.customer_name, e.product_code, e.product_name,
    e.quantity, e.unit, e.note, COALESCE(e.parse_issues, '[]'::jsonb)
  FROM jsonb_to_recordset(COALESCE(p_entries, '[]'::jsonb)) AS e(
    row_no         integer,
    sales_date     date,
    slip_no        text,
    customer_code  text,
    customer_name  text,
    product_code   text,
    product_name   text,
    quantity       integer,
    unit           text,
    note           text,
    parse_issues   jsonb
  )
  WHERE e.sales_date = ANY (v_won_days);

  GET DIAGNOSTICS v_entry_count = ROW_COUNT;

  INSERT INTO shipment_coverage (
    tenant_id, sales_date, source_file_id, source_version_at, source_received_at, updated_at
  )
  SELECT p_tenant_id, day, p_source_file_id, v_new_version_at, v_new_received_at, now()
    FROM unnest(v_won_days) AS day
  ON CONFLICT (tenant_id, sales_date) DO UPDATE SET
    source_file_id     = EXCLUDED.source_file_id,
    source_version_at  = EXCLUDED.source_version_at,
    source_received_at = EXCLUDED.source_received_at,
    updated_at         = EXCLUDED.updated_at;

  RETURN jsonb_build_object(
    'status', CASE WHEN cardinality(v_won_days) = v_total_days THEN 'replaced' ELSE 'partial' END,
    'entry_count', v_entry_count
  );
END;
$$;

-- SECURITY INVOKER なのでユーザー JWT から呼んでも RLS（書き込みポリシー無し）で弾かれるが、
-- service role 専用であることを明示するため実行権限も絞る。
REVOKE EXECUTE ON FUNCTION replace_shipment_entries(uuid, uuid, date, date, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION replace_shipment_entries(uuid, uuid, date, date, jsonb)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 名寄せの辞書: 得意先 → 顧客（1対多）、(得意先, 商品コード) → 製品
-- ---------------------------------------------------------------------------
-- customer_code / product_code は照合用に正規化したキー（全角半角・空白・英字の大小を無視。
-- backend の shipment_matcher.normalize_code()）。
--
-- 得意先 → 顧客が1対多なのは商流のため。弥生の得意先（請求先）と、アプリの受注の顧客（注文書の会社＝
-- 注文元・送り先）が違うことがあり（商社が得意先で、注文と送り先は別の会社）、突合のときは得意先に
-- 対応する顧客の受注をすべて候補にする。受注の顧客は注文書のまま変えない。
CREATE TABLE shipment_customer_links (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  customer_code  text NOT NULL CHECK (btrim(customer_code) <> ''),
  customer_id    bigint NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  created_by     uuid NOT NULL REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipment_customer_links_key UNIQUE (tenant_id, customer_code, customer_id)
);

-- 弥生の商品コードは得意先ごとに接頭辞があり、得意先の中で安定している。製品マスタの図番
-- （products.code）とは一致しない（本番で確認済み）ので、(得意先, 商品コード) で製品を引く。
CREATE TABLE shipment_product_links (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  customer_code  text NOT NULL CHECK (btrim(customer_code) <> ''),
  product_code   text NOT NULL CHECK (btrim(product_code) <> ''),
  product_id     bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_by     uuid NOT NULL REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipment_product_links_key UNIQUE (tenant_id, customer_code, product_code)
);

-- 「対象外」: 送料など商品ではない行（kind='product'）や、送品の突合に使わない得意先（kind='customer'）。
-- 照合の結果には影響させず、未照合の一覧から除き、突合の対象から外すだけにする。
CREATE TABLE shipment_ignored_codes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  kind           text NOT NULL CHECK (kind IN ('customer', 'product')),
  customer_code  text NOT NULL CHECK (btrim(customer_code) <> ''),
  product_code   text CHECK ((kind = 'product') = (product_code IS NOT NULL)),
  created_by     uuid NOT NULL REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipment_ignored_codes_key
    UNIQUE NULLS NOT DISTINCT (tenant_id, kind, customer_code, product_code)
);

-- 日報の別名辞書と同じ方針: テナントメンバーが読み書きでき（事務担当者のロールに限るのは API 側）、
-- created_by は INSERT 時に auth.uid() と一致させる。
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shipment_customer_links', 'shipment_product_links', 'shipment_ignored_codes']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY "tenant members can view %1$s" ON %1$I FOR SELECT '
      'USING (is_tenant_member(tenant_id))', t);
    EXECUTE format(
      'CREATE POLICY "tenant members can insert %1$s" ON %1$I FOR INSERT '
      'WITH CHECK (is_tenant_member(tenant_id) AND created_by = auth.uid())', t);
    EXECUTE format(
      'CREATE POLICY "tenant members can delete %1$s" ON %1$I FOR DELETE '
      'USING (is_tenant_member(tenant_id))', t);
  END LOOP;
END;
$$;

-- 商品の対応は付け替え（製品の変更）があるので UPDATE も許す（API は product_id / updated_at だけを書く）
CREATE POLICY "tenant members can update shipment_product_links" ON shipment_product_links
  FOR UPDATE
  USING (is_tenant_member(tenant_id))
  WITH CHECK (is_tenant_member(tenant_id));

CREATE INDEX idx_shipment_customer_links_customer ON shipment_customer_links (customer_id);
CREATE INDEX idx_shipment_product_links_product ON shipment_product_links (product_id);
