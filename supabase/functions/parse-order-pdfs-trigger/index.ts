// pg_cron から高頻度に呼び出される薄いプロキシ。
// ロジック自体は持たず、Render(FastAPI)側の
//   1. GET /api/cron/gmail-poll            （メール取得・添付のステージング保存）
//   2. GET /api/cron/parse-order-pdfs      （ステージング済み行の解析・orders反映）
//   3. GET /api/cron/advance-order-status  （着手日到来で confirmed <-> in_progress を自動遷移。Issue #400）
// をこの順で CRON_SECRET 付きに叩くだけ。1回の実行で複数のcronをまとめて処理する
// （厳密にはgmail-pollの完了後にparse-order-pdfsを実行したいが、10〜15分間隔で
// 繰り返し実行されるため多少の前後があっても実用上問題ない。Issue #261 参照）。
//
// gmail-poll が失敗しても、前回までにステージング済みの行が残っている可能性があるため
// parse-order-pdfs は続けて実行する。advance-order-status はメール処理とは独立で、
// 着手日ベースの冪等なバルク更新のため毎回叩いても副作用はない（実質日次相当）。
//
// 環境変数（Supabase Edge Function Secrets）:
//   BACKEND_URL  Renderのバックエンド URL（末尾スラッシュなし。例: https://xxx.onrender.com）
//   CRON_SECRET  Render側の /api/cron/* エンドポイントが要求する Bearer トークン
//                （Render/Vercelに設定済みの CRON_SECRET と同じ値）

async function callCronEndpoint(
  backendUrl: string,
  cronSecret: string,
  path: string
): Promise<{ status: number; body: unknown }> {
  try {
    const res = await fetch(`${backendUrl}${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${cronSecret}` },
    })
    const body = await res.json().catch(() => ({ error: "invalid JSON response" }))
    return { status: res.status, body }
  } catch (err) {
    return { status: 0, body: { error: `fetch failed: ${err instanceof Error ? err.message : String(err)}` } }
  }
}

Deno.serve(async (_req: Request) => {
  const backendUrl = Deno.env.get("BACKEND_URL")
  const cronSecret = Deno.env.get("CRON_SECRET")

  if (!backendUrl || !cronSecret) {
    return new Response(
      JSON.stringify({ error: "BACKEND_URL or CRON_SECRET not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    )
  }

  const gmailPoll = await callCronEndpoint(backendUrl, cronSecret, "/api/cron/gmail-poll")
  const parseOrderPdfs = await callCronEndpoint(backendUrl, cronSecret, "/api/cron/parse-order-pdfs")
  const advanceOrderStatus = await callCronEndpoint(backendUrl, cronSecret, "/api/cron/advance-order-status")

  const isSuccess = (status: number) => status >= 200 && status < 300
  const overallStatus =
    isSuccess(gmailPoll.status) && isSuccess(parseOrderPdfs.status) && isSuccess(advanceOrderStatus.status)
      ? 200
      : 502

  return new Response(
    JSON.stringify({ gmailPoll, parseOrderPdfs, advanceOrderStatus }),
    { status: overallStatus, headers: { "Content-Type": "application/json" } }
  )
})
