# フロントエンド単体テスト基盤（Vitest + React Testing Library）

Issue #340 で構築。`frontend/` にコンポーネント・カスタムフック・純粋ロジックを高速に
ユニットテストできる基盤を整備した。従来は `frontend/e2e/`（Playwright）しか無く、
ユニットレベルのテストが書けなかった。

## スタック

| 目的 | ライブラリ |
|---|---|
| テストランナー | `vitest`（`jsdom` 環境） |
| コンポーネント描画・クエリ | `@testing-library/react` / `@testing-library/dom` |
| ユーザー操作シミュレーション | `@testing-library/user-event` |
| DOM マッチャ | `@testing-library/jest-dom`（`/vitest` サブパスで `expect` を拡張） |
| HTTP モック | `msw`（`msw/node` の `setupServer`） |
| カバレッジ | `@vitest/coverage-v8` |

### React Compiler は通さない

Next 本体は `babel-plugin-react-compiler`（`next.config.ts` の `reactCompiler: true`）で
変換しているが、Vitest 側では `@vitejs/plugin-react` を **react-compiler プラグイン無し**で
使い、素の React でテストする（Issue #340 の要件）。`vitest.config.ts` の `plugins: [react()]`
がそれで、babel の追加設定は入れていない。

## ファイル構成

```
frontend/
  vitest.config.ts            # ランナー設定。@/* エイリアス、jsdom、include/exclude、coverage
  vitest.setup.ts             # 全テスト共通の前処理（下記）
  src/test-utils/
    render.tsx                # QueryClientProvider でラップした custom render / renderHook
    supabase.ts               # テスト用 Supabase セッション状態（get/set/reset）
    msw/
      handlers.ts             # デフォルトの MSW ハンドラ＋サンプルデータ
      server.ts               # setupServer インスタンス
  src/**/*.test.ts(x)         # テスト本体（コロケーション配置）
```

### `vitest.config.ts`

- `test.include` は `src/**/*.test.{ts,tsx}` のみ。`e2e/**` は `exclude` で明示的に除外し、
  Playwright と物理的に分離する（`test:e2e` スクリプトはそのまま）。
- `@/*` パスエイリアスは `resolve.alias` で `@` → `<frontend>/src` を張って解決する。
  `tsconfig.json` の `paths` と等価。`vite-tsconfig-paths` は ESM-only で CJS 設定ロードに
  失敗するため使っていない。
- `coverage` は v8 プロバイダ。`src/test-utils/**` / `src/types/**` / テスト自身は集計対象外。

### `vitest.setup.ts`

- `@testing-library/jest-dom/vitest` を読み込み、`afterEach` で `cleanup()`。
- `process.env.NEXT_PUBLIC_API_URL` に `.env.local.sample` / CI と同じ値（`http://localhost:8000`、
  `/api` は付けない）をセット（`apiClient` が `NEXT_PUBLIC_API_URL + endpoint` で組み立てるため）。
  MSW ハンドラの `API_BASE`（`handlers.ts`）もこの値と揃える。
- **認証の thin wrapper（`@/utils/supabase/client`）を全テスト共通でモック**する。
  `apiClient` は `createClient().auth.getSession()` の `access_token` を `Authorization`
  ヘッダに載せるだけなので、`src/test-utils/supabase.ts` の状態を返す最小スタブに差し替える。
  セッション内容を変えたいテストは `setSupabaseSession(null)` 等を呼ぶ（`afterEach` で自動リセット）。
- MSW サーバーを `onUnhandledRequest: "error"` で起動。宣言していない fetch はテスト失敗になる。
- jsdom 未実装の DOM API（`matchMedia` / `ResizeObserver` / `scrollIntoView` /
  `*PointerCapture`）をスタブ。Radix UI コンポーネントの描画・操作に必要。

### `src/test-utils/render.tsx`

- `createTestQueryClient()`: `retry: false`（必須。失敗時に指数バックオフでテストがハングするのを防ぐ）
  ＋ `gcTime: 0` の `QueryClient`。
- `render(ui, { queryClient? })` / `renderHook(cb, { queryClient? })`: `QueryClientProvider` で
  ラップした custom render。戻り値に `queryClient` を含む。
- `screen` / `waitFor` / `within` / `userEvent` などは同ファイルから re-export（テスト側は
  `@/test-utils/render` 1本の import で済む）。`export *` は esbuild 変換下で自前の
  `render` / `renderHook` を潰すため、必要なものを名前指定で re-export している。

## サンプルテスト（基盤の動作確認）

| 種別 | ファイル | 確認内容 |
|---|---|---|
| 純粋関数 | `src/gantt/utils/date-math.test.ts` | `buildTimelineConfig` / `getTaskGridColumns` / `getMilestoneGridColumn` のグリッド計算 |
| カスタムフック | `src/hooks/use-products.test.ts` | `useProducts` が MSW 応答を取得／500 でエラー化（ハングしない）／未ログインで失敗 |
| コンポーネント | `src/components/orders/orders-filter-bar.test.tsx` | `OrdersFilterBar` のタブ描画・クリックでコールバック発火・選択状態 |

## 実行方法

```bash
cd frontend
npm run test           # vitest run（1回実行）
npm run test:watch     # vitest（watch モード）
npm run test:coverage  # vitest run --coverage
```

CI（`.github/workflows/ci-frontend.yml`）にも `Unit tests (Vitest)` ステップを追加済み。
`frontend/**` を変更する PR で lint / 型チェックと合わせて `npm run test` が走る。

## テストを書くときの指針

- **配置はコロケーション**。`components/orders/OrderForm.tsx` の隣に `OrderForm.test.tsx`。
- **HTTP は必ず MSW 経由**。テスト内で個別に上書きする場合は `server.use(http.get(...))` を
  `handlers.ts` の `API_BASE` を使って書く。
- **TanStack Query を使うフック/コンポーネントは `@/test-utils/render` の `render` /
  `renderHook`** を使う（生の RTL を直接使わない）。`retry: false` が効かず失敗テストが
  ハングする。
- **認証状態は `src/test-utils/supabase.ts`** で制御。`createClient` を各テストで
  `vi.mock` し直さない。
- 日付ロジックのテストは端末タイムゾーン非依存に書く（ローカル深夜の `new Date(y, m, d)` を使う等）。
