import { setupServer } from "msw/node"
import { handlers } from "./handlers"

/**
 * Node (Vitest) 用の MSW サーバー。
 * ライフサイクル（listen / resetHandlers / close）は vitest.setup.ts で管理する。
 */
export const server = setupServer(...handlers)
