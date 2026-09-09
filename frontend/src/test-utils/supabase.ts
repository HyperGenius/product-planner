/**
 * テスト用の Supabase セッション状態。
 *
 * `vitest.setup.ts` の `vi.mock("@/utils/supabase/client")` がこの値を参照して
 * `auth.getSession()` の戻り値を組み立てる。未ログイン状態を再現したいテストは
 * `setSupabaseSession(null)` を呼ぶ（`afterEach` で自動リセットされる）。
 */
export interface FakeSession {
  access_token: string
}

const DEFAULT_SESSION: FakeSession = { access_token: "test-access-token" }

let currentSession: FakeSession | null = DEFAULT_SESSION

export function getSupabaseSession(): FakeSession | null {
  return currentSession
}

export function setSupabaseSession(session: FakeSession | null): void {
  currentSession = session
}

export function resetSupabaseSession(): void {
  currentSession = DEFAULT_SESSION
}
