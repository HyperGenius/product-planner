import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import type { GanttTask } from "../types"
import { TaskBar } from "./task-bar"

function task(overrides: Partial<GanttTask> = {}): GanttTask {
  return {
    id: "t1",
    name: "プレス",
    start: new Date(2026, 8, 10, 9),
    end: new Date(2026, 8, 10, 17),
    color: "#3b82f6",
    ...overrides,
  }
}

function renderBar(t: GanttTask) {
  render(<TaskBar task={t} colStart={1} colEnd={5} data-testid="bar" />)
  return screen.getByTestId("bar")
}

describe("TaskBar の進捗表示", () => {
  it("進捗率の割合だけバーを塗る", () => {
    const bar = renderBar(task({ progress: 0.4 }))
    expect(bar).toHaveAttribute("data-progress", "40")
    expect(screen.getByTestId("task-bar-progress")).toHaveStyle({ width: "40%" })
  })

  it("範囲外の値は 0〜100% に丸める", () => {
    renderBar(task({ progress: 1.5 }))
    expect(screen.getByTestId("task-bar-progress")).toHaveStyle({ width: "100%" })
  })

  it("進捗が未指定・0 なら塗らない（現状どおりの表示）", () => {
    const bar = renderBar(task())
    expect(bar).not.toHaveAttribute("data-progress")
    expect(screen.queryByTestId("task-bar-progress")).not.toBeInTheDocument()
  })

  it("グループヘッダーには進捗・外観を出さない", () => {
    const bar = renderBar(task({ isGroupHeader: true, progress: 0.5, appearance: "danger", badge: "！" }))
    expect(bar).not.toHaveAttribute("data-appearance")
    expect(screen.queryByTestId("task-bar-progress")).not.toBeInTheDocument()
    expect(screen.queryByTestId("task-bar-badge")).not.toBeInTheDocument()
  })

  it("マイルストーンは外観だけ示す（塗り・バッジは無し）", () => {
    const bar = renderBar(task({ isMilestone: true, progress: 0.5, appearance: "danger", badge: "！" }))
    expect(bar).toHaveAttribute("data-appearance", "danger")
    expect(screen.queryByTestId("task-bar-progress")).not.toBeInTheDocument()
    expect(screen.queryByTestId("task-bar-badge")).not.toBeInTheDocument()
  })
})

describe("TaskBar の外観とバッジ（Issue #580）", () => {
  it("外観の指定が無ければ default（color の塗り）", () => {
    const bar = renderBar(task())
    expect(bar).toHaveAttribute("data-appearance", "default")
    expect(bar).toHaveStyle({ backgroundColor: "#3b82f6" })
  })

  it("neutral は color を使わない無彩色の塗り", () => {
    const bar = renderBar(task({ appearance: "neutral", progress: 0.5 }))
    expect(bar.className).toContain("bg-gray-300")
    expect(bar.style.backgroundColor).toBe("")
    expect(screen.queryByTestId("task-bar-progress")).not.toBeInTheDocument()
  })

  it("subtle は淡い塗り＋color の枠線", () => {
    const bar = renderBar(task({ appearance: "subtle" }))
    expect(bar.className).toContain("border-dashed")
    expect(bar).toHaveStyle({ borderColor: "#3b82f6" })
    expect(bar.style.backgroundColor).toBe("")
  })

  it("muted はくすんだ色で、進捗の塗りを重ねない", () => {
    const bar = renderBar(task({ appearance: "muted", progress: 1, badge: "✓" }))
    expect(bar.className).toContain("bg-gray-200")
    expect(screen.queryByTestId("task-bar-progress")).not.toBeInTheDocument()
    expect(screen.getByTestId("task-bar-badge")).toHaveTextContent("✓")
  })

  it("danger は赤の斜線入りの塗りで、進捗の塗りは重ねる", () => {
    const bar = renderBar(task({ appearance: "danger", progress: 0.4, badge: "！" }))
    expect(bar.className).toContain("bg-red-600")
    expect(bar.className).toContain("repeating-linear-gradient")
    expect(screen.getByTestId("task-bar-progress")).toHaveStyle({ width: "40%" })
    expect(screen.getByTestId("task-bar-badge")).toHaveTextContent("！")
  })

  it("バッジが無ければ描かない", () => {
    renderBar(task())
    expect(screen.queryByTestId("task-bar-badge")).not.toBeInTheDocument()
  })
})

describe("TaskBar のラベル", () => {
  it("バーの外（右）に工程名を描かない（ラベルは固定ラベル列に出す）", () => {
    renderBar(task())
    expect(screen.queryByText("プレス")).not.toBeInTheDocument()
  })

  it("マイルストーンもバー外にラベルを描かない", () => {
    renderBar(task({ isMilestone: true }))
    expect(screen.queryByText("プレス")).not.toBeInTheDocument()
  })
})

describe("TaskBar のサマリーバー（グループヘッダー）", () => {
  it("細いブラケット形で描き、両端に脚を付ける", () => {
    const bar = renderBar(task({ isGroupHeader: true }))
    expect(bar).toHaveAttribute("data-summary-bar")
    expect(bar.className).toContain("h-3")
    expect(bar.className).not.toContain("h-7")
    expect(screen.queryByTestId("task-bar-continues-start")).not.toBeInTheDocument()
    expect(screen.queryByTestId("task-bar-continues-end")).not.toBeInTheDocument()
  })

  it("範囲外へ続く側は脚の代わりに矢印を出す", () => {
    const bar = renderBar(task({ isGroupHeader: true, continuesBefore: true, continuesAfter: true }))
    expect(bar).toHaveAttribute("data-continues-before", "true")
    expect(bar).toHaveAttribute("data-continues-after", "true")
    expect(screen.getByTestId("task-bar-continues-start")).toBeInTheDocument()
    expect(screen.getByTestId("task-bar-continues-end")).toBeInTheDocument()
  })
})

describe("TaskBar の続きの印", () => {
  it("通常のバーは続く側の端に矢印を出す", () => {
    const bar = renderBar(task({ continuesAfter: true }))
    expect(bar).toHaveAttribute("data-continues-after", "true")
    expect(bar).not.toHaveAttribute("data-continues-before")
    expect(screen.getByTestId("task-bar-continues-end")).toBeInTheDocument()
    expect(screen.queryByTestId("task-bar-continues-start")).not.toBeInTheDocument()
  })
})

describe("TaskBar の重ね描き・薄い表示（Issue #582）", () => {
  it("ゴーストバーは破線の重ね描きで、クリックを受けない", () => {
    const bar = renderBar(task({ isGhost: true, appearance: "danger", badge: "60%" }))
    expect(bar).toHaveAttribute("data-ghost")
    expect(bar.className).toContain("pointer-events-none")
    // 外観・バッジは出さない
    expect(bar).not.toHaveAttribute("data-appearance")
    expect(screen.queryByTestId("task-bar-badge")).not.toBeInTheDocument()
  })

  it("dimmed のバーは薄く描く", () => {
    const bar = renderBar(task({ dimmed: true }))
    expect(bar).toHaveAttribute("data-dimmed", "true")
    expect(bar.className).toContain("opacity-40")
  })
})
