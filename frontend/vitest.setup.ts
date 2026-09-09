import "@testing-library/jest-dom/vitest"
import { afterAll, afterEach, beforeAll, vi } from "vitest"
import { cleanup } from "@testing-library/react"
import { server } from "./src/test-utils/msw/server"
import { resetSupabaseSession } from "./src/test-utils/supabase"

// apiClient が参照する API のベース URL。実ネットワークには出さず MSW が全て捌く。
// 値は .env.local.sample / CI（ci-frontend.yml）と揃える（apiClient は
// `NEXT_PUBLIC_API_URL + "/products"` の形で組み立てるため /api は付けない）。
process.env.NEXT_PUBLIC_API_URL = "http://localhost:8000"

// 認証の thin wrapper (`@/utils/supabase/client`) を全テスト共通でモックする。
// apiClient は access_token を Authorization ヘッダに載せるだけなので、
// ダミーセッションを返す最小スタブで十分（Issue #340 の作業ヒント）。
// セッション内容の差し替えは test-utils/supabase.ts の setSupabaseSession() で行う。
vi.mock("@/utils/supabase/client", async () => {
  const { getSupabaseSession } = await import("./src/test-utils/supabase")
  return {
    createClient: () => ({
      auth: {
        getSession: async () => ({
          data: { session: getSupabaseSession() },
          error: null,
        }),
      },
    }),
  }
})

// MSW: 宣言していないリクエストはテスト失敗にする（意図しない fetch の検知）。
beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
  resetSupabaseSession()
  vi.clearAllMocks()
})
afterAll(() => server.close())

// jsdom に無い API のスタブ。
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia

const win = window as unknown as Record<string, unknown>
if (typeof win.ResizeObserver === "undefined") {
  win.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// Radix UI が jsdom で参照するが未実装の DOM API を補う。
const proto = Element.prototype as unknown as Record<string, unknown>
proto.scrollIntoView ??= () => {}
proto.hasPointerCapture ??= () => false
proto.setPointerCapture ??= () => {}
proto.releasePointerCapture ??= () => {}
