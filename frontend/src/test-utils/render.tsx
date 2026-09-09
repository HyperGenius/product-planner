import type { ReactElement, ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  render as rtlRender,
  renderHook as rtlRenderHook,
  type RenderHookOptions,
  type RenderOptions,
} from "@testing-library/react"

// screen / waitFor / within などのクエリユーティリティはそのまま再エクスポートする。
// （`export *` は esbuild 変換下で自前の render / renderHook を潰すため使わない）
export {
  act,
  fireEvent,
  screen,
  waitFor,
  waitForElementToBeRemoved,
  within,
} from "@testing-library/react"
export { default as userEvent } from "@testing-library/user-event"

/**
 * テスト用の QueryClient。
 * `retry: false` は必須（失敗時に指数バックオフでテストがハングするのを防ぐ）。
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
}

interface WrapperProps {
  children: ReactNode
}

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: WrapperProps) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }
}

/**
 * QueryClientProvider でラップした custom render。
 * 戻り値に `queryClient` を含めるのでテストから直接操作できる。
 */
export function render(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper"> & { queryClient?: QueryClient },
) {
  const queryClient = options?.queryClient ?? createTestQueryClient()
  return {
    queryClient,
    ...rtlRender(ui, { wrapper: makeWrapper(queryClient), ...options }),
  }
}

/**
 * QueryClientProvider でラップした custom renderHook（カスタムフックのテスト用）。
 */
export function renderHook<Result, Props>(
  callback: (props: Props) => Result,
  options?: Omit<RenderHookOptions<Props>, "wrapper"> & { queryClient?: QueryClient },
) {
  const queryClient = options?.queryClient ?? createTestQueryClient()
  return {
    queryClient,
    ...rtlRenderHook(callback, { wrapper: makeWrapper(queryClient), ...options }),
  }
}
