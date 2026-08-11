-- order_handler が誤って送信した承認依頼を自分で取り下げられるようにする (Issue #326 フォローアップ)
-- pending_approval -> draft への遷移はorder_status_service.py上で既に許可されているが、
-- これまで実行経路が president 限定の reject (却下) しかなかったため、
-- order_handler 自身による取り下げ用に action='withdraw' を追加する。

ALTER TABLE order_approval_log DROP CONSTRAINT order_approval_log_action_check;

ALTER TABLE order_approval_log
  ADD CONSTRAINT order_approval_log_action_check
  CHECK (action IN ('request_approval', 'approve', 'reject', 'withdraw'));
