-- ==========================================
-- orders.scheduling_start_date 追加 (Issue #372)
--
-- 納期シミュレーション／確定時の「作業開始日（工場が着手する日）」を、
-- 受注起票日（order_date）とは別に保持する。
--   * NULL の場合はシミュレーション／確定の実行日から着手する（従来挙動）。
--   * 値が入っている場合、その日の稼働開始時刻（JST 09:00）を起点にスケジュールを算出する。
--   * 過去日の設定は president / platform_admin のみに許可する（起票前に着手して
--     しまったケースの救済措置）。この権限チェックはアプリ層（orders ルーター）で行う。
--
-- 既存の RLS ポリシー（is_tenant_member(tenant_id)）が列単位ではなく行単位で
-- 適用されるため、本カラム追加に伴う追加ポリシーは不要。
-- ==========================================

ALTER TABLE orders ADD COLUMN scheduling_start_date date NULL;

COMMENT ON COLUMN orders.scheduling_start_date IS
  '作業開始日（工場が着手する日）。NULL の場合はシミュレーション／確定の実行日から着手する。'
  '過去日の設定は president / platform_admin のみ許可（起票前着手の救済措置、アプリ層で制御）。';

COMMENT ON COLUMN orders.order_date IS
  '受注起票日（システムに受注が登録された日時）。作業開始日（scheduling_start_date）とは別物。';
