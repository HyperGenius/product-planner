-- 日報の工程の名寄せを製品単位にする (Issue #708, Epic #701)
--
-- 日報の実績のハブの② 製品の工程を日報に合わせる で、製品ごとに「工程ルートの工程」と
-- 「日報に出てくるその製品の工程」を並べる。明細の製品・工程の照合結果は保存せず参照のたびに求める
-- （#488 の方針。services/daily_report_product_processes.py）ので、明細を全件読まずに
-- (顧客先, 商品名, 工程の表記) の組ごとに集計してから照合する（daily_report_name_stats と同じ考え方）。
-- 製品の別名は顧客単位なので顧客先も組に含める。
--
-- p_since を渡すと加工日がその日以降の明細だけを数える。加工日の無い明細は期間で絞り込めないので
-- 常に含める（照合状況・未割当の期間と同じ。services/daily_report_coverage.in_period()）。
-- SECURITY INVOKER なのでユーザー JWT から呼ぶと daily_report_entries の RLS が効く。
CREATE OR REPLACE FUNCTION daily_report_product_process_stats(
  p_tenant_id uuid,
  p_since     date DEFAULT NULL
)
RETURNS TABLE (
  customer_raw    text,
  product_raw     text,
  process_raw     text,
  entry_count     bigint,
  last_work_date  date
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT e.customer_raw, e.product_raw, e.process_raw, count(*), max(e.work_date)
    FROM daily_report_entries e
   WHERE e.tenant_id = p_tenant_id
     AND e.product_raw IS NOT NULL
     AND e.process_raw IS NOT NULL
     AND (p_since IS NULL OR e.work_date IS NULL OR e.work_date >= p_since)
   GROUP BY e.customer_raw, e.product_raw, e.process_raw;
$$;

REVOKE EXECUTE ON FUNCTION daily_report_product_process_stats(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION daily_report_product_process_stats(uuid, date) TO authenticated, service_role;
