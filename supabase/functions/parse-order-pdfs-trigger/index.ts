// pg_cron から高頻度に呼び出される薄いプロキシ。
// ロジック自体は持たず、Render(FastAPI)側の GET /api/cron/parse-order-pdfs を
// CRON_SECRET 付きで叩くだけ。Issue #261 参照。
//
// 環境変数（Supabase Edge Function Secrets）:
//   BACKEND_URL  Renderのバックエンド URL（末尾スラッシュなし。例: https://xxx.onrender.com）
//   CRON_SECRET  Render側の /api/cron/* エンドポイントが要求する Bearer トークン
//                （Render/Vercelに設定済みの CRON_SECRET と同じ値）

Deno.serve(async (_req: Request) => {
  const backendUrl = Deno.env.get("BACKEND_URL")
  const cronSecret = Deno.env.get("CRON_SECRET")

  if (!backendUrl || !cronSecret) {
    return new Response(
      JSON.stringify({ error: "BACKEND_URL or CRON_SECRET not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    )
  }

  const res = await fetch(`${backendUrl}/api/cron/parse-order-pdfs`, {
    method: "GET",
    headers: { Authorization: `Bearer ${cronSecret}` },
  })
  const body = await res.text()

  return new Response(body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  })
})
