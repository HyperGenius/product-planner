-- 受注種別（生産 / 修理）の追加 (Issue #493)
--
-- 顧客から預かった部品のはんだ補修のような「修理」の注文書が届くことがある（月1回未満）。
-- 修理は図番・品名が規格化されておらず製品マスタ・工程ルートに当てはめられないため、
-- 製品・工程を持たない受注として orders に同居させる（顧客・承認・通知・着手日の自動遷移
-- cron を二重に作らないため）。設備は使わず、production_schedules には行を作らない。
--
-- 修理での列の使い方:
--   deadline_date         納期（PDF から取り込み）
--   scheduling_start_date 実施開始日（受注担当者が入力。scheduling_start_date_auto = false）
--   simulated_deadline    承認前の完了予定日（受注担当者が入力）
--   confirmed_deadline    確定した完了予定日（承認時に simulated_deadline をコピー）
--   quantity / product_id / extracted_product_name は使わない（NULL）
--
-- order_type は作成後に変更しない（アプリ側の更新スキーマに含めない）。値を増やしやすいよう
-- enum 型ではなく text + CHECK にする。

ALTER TABLE orders
  ADD COLUMN order_type text NOT NULL DEFAULT 'production'
    CHECK (order_type IN ('production', 'repair')),
  ADD COLUMN work_description text;

COMMENT ON COLUMN orders.order_type IS
  '受注種別。production=生産（製品・工程からスケジュールを組む）、repair=修理（製品・設備を'
  '使わず、実施開始日と完了予定日を受注担当者が入力する）。作成後は変更しない。Issue #493';
COMMENT ON COLUMN orders.work_description IS
  '件名・作業内容のフリーテキスト（修理で使う。注文書の件名と明細の内訳をまとめて入れる）。Issue #493';

-- 修理は製品を持たない
ALTER TABLE orders
  ADD CONSTRAINT orders_repair_without_product
    CHECK (order_type = 'production' OR product_id IS NULL);

-- 同じ修理の注文書の再受信で重複起票しないためのキー。
-- customer_order_no は文書の注文番号（無ければ文書内容から決定的に採番した値）。
CREATE UNIQUE INDEX orders_repair_customer_order_no_key
  ON orders (tenant_id, customer_id, customer_order_no)
  WHERE order_type = 'repair' AND customer_order_no IS NOT NULL;
