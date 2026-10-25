-- 受信メール（order_attachments のステージング行、order_id IS NULL）の処理結果を
-- プラットフォーム管理者の Slack に件数で通知したかを記録する（Issue #574）。
-- cron `GET /api/cron/notify-email-intake-slack` が、未通知の行を集計して送信に成功したときだけ書き込む。
-- 対象は Gmail から受信した行（gmail_message_id あり）だけで、手入力の「メール起票」（Issue #358）は通知しない。
-- 処理結果と「処理待ちの滞留」はそれぞれ1回ずつ通知するので、列を分ける
-- （滞留として通知した行も、処理が終われば処理結果としてもう1回通知する）。
ALTER TABLE order_attachments
  ADD COLUMN slack_notified_at timestamptz,
  ADD COLUMN slack_stalled_notified_at timestamptz;

COMMENT ON COLUMN order_attachments.slack_notified_at IS
  'ステージング行の処理結果（起票・要確認・失敗）を Slack に通知した日時（Issue #574）。NULL は未通知。';
COMMENT ON COLUMN order_attachments.slack_stalled_notified_at IS
  'ステージング行が pending のまま滞留していることを Slack に通知した日時（Issue #574）。NULL は未通知。';

-- リリース時点の既存の受信メールは通知済みにする（過去分をまとめて流さない）
UPDATE order_attachments
SET slack_notified_at = now(),
    slack_stalled_notified_at = now()
WHERE order_id IS NULL;

-- 未通知のステージング行を引くための部分インデックス
CREATE INDEX idx_order_attachments_slack_unnotified
  ON order_attachments (created_at)
  WHERE order_id IS NULL AND gmail_message_id IS NOT NULL AND slack_notified_at IS NULL;
