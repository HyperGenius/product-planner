# Supabase Edge Function のデプロイ管理 (Issue #261)
#
# pg_cron のジョブスケジュール自体は supabase/supabase Terraform Provider に
# 対応リソースが存在しないため管理対象外（手作業で設定する。
# docs/infra/supabase-pgcron-parse-order-pdfs.md 参照）。
# Edge Function Secrets（CRON_SECRET・BACKEND_URL）も値を state に平文保存し
# たくないため Terraform 管理外とし、`supabase secrets set` で手作業投入する。
#
# 日報取り込みエージェントの受付口 agent-gateway（Issue #468）は verify_jwt = false で
# デプロイする必要があるが、この provider の supabase_edge_function には verify_jwt 属性が
# 無いため Terraform 管理外とし、`supabase functions deploy agent-gateway --no-verify-jwt`
# でデプロイする（docs/features/daily-report-agent.md 参照）。
resource "supabase_edge_function" "parse_order_pdfs_trigger" {
  project_ref = var.supabase_project_ref
  slug        = "parse-order-pdfs-trigger"
  entrypoint  = "../../supabase/functions/parse-order-pdfs-trigger/index.ts"
}
