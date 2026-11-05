-- cron の失敗通知の状態（Issue #636）。
-- 同じ cron が連続して失敗している間は Slack に1回だけ通知し、復旧したときに1回通知するため、
-- cron ごとに「いま失敗中か」を持つ。cron は全テナント横断でテナントに紐づかないので
-- tenant_id は持たない。読み書きはバックエンドの cron（service role）だけで、
-- ユーザーには一切見せないので RLS を有効にしてポリシーは作らない。
CREATE TABLE IF NOT EXISTS cron_alert_state (
    cron_name        text PRIMARY KEY,
    is_failing       boolean NOT NULL DEFAULT false,
    failing_since    timestamptz,
    last_notified_at timestamptz,
    updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cron_alert_state ENABLE ROW LEVEL SECURITY;
