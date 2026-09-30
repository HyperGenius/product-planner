// 共有PCの日報取り込みエージェント（tools/daily-report-agent/、Issue #468）の受付口。
// ロジックは持たず、Render(FastAPI)側の /api/agent/* へリクエストをそのまま中継する薄いプロキシ。
// エージェントの config.json の api_base_url には次の URL を書く:
//   https://<project-ref>.supabase.co/functions/v1/agent-gateway
// エージェントがこの後ろに /api/agent/heartbeat 等を付けて POST してくる。
//
// 認証はバックエンド（routers/agent/_auth.py）がエージェントトークンで行う。
// エージェントは Supabase の JWT を持たないため、この関数は verify_jwt = false で
// デプロイする（supabase/config.toml、`supabase functions deploy --no-verify-jwt`）。
// その代わり、中継先は下の ALLOWED_PATHS の POST だけに限定し、任意のバックエンド
// エンドポイントへの踏み台にならないようにする。
//
// ボディはストリームのまま中継せず、上限付きで読み切ってから転送する。Edge Runtime は
// クライアントからのボディを読み切らずに応答すると応答を返せず 504（約60秒待ち）になる。
// ストリーム中継だと、バックエンドがボディを読む前に応答するケース（トークン不正の 401、
// 上限超過の 413）でこれを踏み、トークン設定ミスが「毎回タイムアウト」に見えてしまう。
// 上限（既定 20MB）は Edge Function のメモリ上限（256MB）に対して十分小さい。
//
// 環境変数（Supabase Edge Function Secrets）:
//   BACKEND_URL             Renderのバックエンド URL（末尾スラッシュなし。例: https://xxx.onrender.com）
//                           parse-order-pdfs-trigger と共用
//   AGENT_MAX_BODY_BYTES    任意。ボディの上限バイト数（既定 20MB）。バックエンドの
//                           DAILY_REPORT_MAX_BYTES を変えたときは合わせて変える

const ALLOWED_PATHS = new Set(["/api/agent/heartbeat", "/api/agent/daily-reports"])
const DEFAULT_MAX_BODY_BYTES = 20 * 1024 * 1024

// バックエンドへ渡すリクエストヘッダ。Host や Supabase ゲートウェイが付けるヘッダは渡さない
// （Content-Length は読み切ったボディから fetch が付け直す）
const FORWARDED_REQUEST_HEADERS = [
  "authorization",
  "content-type",
  "user-agent",
  "x-file-sha256",
  "x-file-path",
  "x-file-modified-at",
]

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

// 関数の URL は環境によって /agent-gateway/api/agent/... や
// /functions/v1/agent-gateway/api/agent/... で届くため、/api/agent/ 以降を取り出す
function extractAgentPath(pathname: string): string | null {
  const index = pathname.indexOf("/api/agent/")
  return index === -1 ? null : pathname.slice(index)
}

// ボディを最後まで読む。上限を超えたら以降は読み捨てて null を返す
// （読み切らずに応答すると 504 になるため、超過時も最後まで読む）
async function readBodyWithLimit(req: Request, maxBytes: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array(0)
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of req.body) {
    total += chunk.byteLength
    if (total <= maxBytes) chunks.push(chunk)
  }
  if (total > maxBytes) return null

  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

Deno.serve(async (req: Request) => {
  const backendUrl = Deno.env.get("BACKEND_URL")
  if (!backendUrl) {
    console.error("BACKEND_URL is not configured")
    return jsonResponse(500, { detail: "Gateway is not configured." })
  }

  const path = extractAgentPath(new URL(req.url).pathname)
  if (path === null || !ALLOWED_PATHS.has(path)) {
    return jsonResponse(404, { detail: "Not Found" })
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { detail: "Method Not Allowed" })
  }

  const maxBodyBytes = Number(Deno.env.get("AGENT_MAX_BODY_BYTES") ?? DEFAULT_MAX_BODY_BYTES)
  const body = await readBodyWithLimit(req, maxBodyBytes)
  if (body === null) {
    // 文言はバックエンド（routers/agent/daily_reports.py の _too_large）に合わせる
    return jsonResponse(413, { detail: "File too large." })
  }

  const headers = new Headers()
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers.get(name)
    if (value !== null) headers.set(name, value)
  }

  let backendRes: Response
  try {
    backendRes = await fetch(`${backendUrl.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers,
      body,
    })
  } catch (err) {
    // 例外文言はレスポンスに載せずログにだけ残す（cron エラー規約と同じ）
    console.error("agent-gateway: backend request failed", err)
    return jsonResponse(502, { detail: "Backend is unreachable." })
  }

  // ステータス・ボディはそのまま返す（エージェントは status / detail を見て分岐する）
  const resHeaders = new Headers()
  const contentType = backendRes.headers.get("content-type")
  if (contentType !== null) resHeaders.set("Content-Type", contentType)
  return new Response(backendRes.body, { status: backendRes.status, headers: resHeaders })
})
