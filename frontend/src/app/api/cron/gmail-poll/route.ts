import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/cron/gmail-poll
 *
 * Vercel Cron がこのルートを 5 分ごとに呼び出す。
 * Vercel は本番環境で自動的に Authorization: Bearer <CRON_SECRET> を付与する。
 * このハンドラはトークンを検証し、Render バックエンドの同名エンドポイントへ転送する。
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  const backendUrl = process.env.BACKEND_URL;

  if (!cronSecret || !backendUrl) {
    console.error("[gmail-poll] CRON_SECRET or BACKEND_URL is not set.");
    return NextResponse.json(
      { error: "Server misconfiguration." },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (token !== cronSecret) {
    console.warn("[gmail-poll] Unauthorized request: token mismatch.");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const targetUrl = `${backendUrl}/api/cron/gmail-poll`;
  console.log(`[gmail-poll] Forwarding to ${targetUrl}`);

  let backendResponse: Response;
  try {
    backendResponse = await fetch(targetUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${cronSecret}` },
      cache: "no-store",
    });
  } catch (err) {
    console.error("[gmail-poll] Backend unreachable:", err);
    return NextResponse.json({ error: "Backend unreachable." }, { status: 502 });
  }

  const data = await backendResponse.json();

  if (!backendResponse.ok) {
    console.error("[gmail-poll] Backend returned error:", data);
    return NextResponse.json(data, { status: backendResponse.status });
  }

  console.log("[gmail-poll] Success:", data);
  return NextResponse.json(data, { status: 200 });
}
