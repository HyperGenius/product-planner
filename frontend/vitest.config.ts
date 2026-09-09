import { resolve } from "node:path"
import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"

// NOTE: Next.js 本体は babel-plugin-react-compiler で変換しているが、
// テストでは素の React で挙動を確認したいため @vitejs/plugin-react は
// react-compiler プラグインを有効化しない（Issue #340）。
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // tsconfig.json の "paths": { "@/*": ["./src/*"] } と揃える。
      "@": resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    css: false,
    // e2e (Playwright) と物理的に分離する。ユニットテストは *.test.ts(x) のみ対象。
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test-utils/**",
        "src/types/**",
        "src/**/*.d.ts",
      ],
    },
  },
})
