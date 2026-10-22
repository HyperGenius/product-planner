-- 工程未入力の下書き受注を社長が送品済みにする暫定の例外処理 (Issue #547)
-- 操作を承認ログに残すため、action に 'ship_without_routing' を追加する。
-- 許可値は 20260811000001 (withdraw 追加) の最新セットを引き継ぐ。

ALTER TABLE order_approval_log DROP CONSTRAINT order_approval_log_action_check;

ALTER TABLE order_approval_log
  ADD CONSTRAINT order_approval_log_action_check
  CHECK (action IN ('request_approval', 'approve', 'reject', 'withdraw', 'ship_without_routing'));
