-- 取り込みで生産として起票された下書きを修理等へ変更する操作 (Issue #568)
-- 受注種別の変更を承認ログに残すため、action に 'convert_to_repair' を追加する。
-- 許可値は 20261022000000 (ship_without_routing 追加) の最新セットを引き継ぐ。

ALTER TABLE order_approval_log DROP CONSTRAINT order_approval_log_action_check;

ALTER TABLE order_approval_log
  ADD CONSTRAINT order_approval_log_action_check
  CHECK (action IN (
    'request_approval', 'approve', 'reject', 'withdraw', 'ship_without_routing',
    'convert_to_repair'
  ));

COMMENT ON COLUMN orders.order_type IS
  '受注種別。production=生産（製品・工程からスケジュールを組む）、repair=修理（製品・設備を'
  '使わず、実施開始日と完了予定日を受注担当者が入力する）。生産の下書きを修理へ変える専用の'
  '操作（POST /orders/{id}/convert-to-repair、Issue #568）以外では変更しない。Issue #493';
