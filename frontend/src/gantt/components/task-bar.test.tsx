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

  it("遅れは赤枠で強調する", () => {
    const bar = renderBar(task({ isDelayed: true }))
    expect(bar).toHaveAttribute("data-delayed", "true")
    expect(bar.className).toContain("ring-red-600")
  })

  it("遅れでなければ強調しない", () => {
    const bar = renderBar(task({ progress: 0.5 }))
    expect(bar).not.toHaveAttribute("data-delayed")
    expect(bar.className).not.toContain("ring-red-600")
  })

  it("グループヘッダーには進捗・遅れを出さない", () => {
    const bar = renderBar(task({ isGroupHeader: true, progress: 0.5, isDelayed: true }))
    expect(bar).not.toHaveAttribute("data-delayed")
    expect(screen.queryByTestId("task-bar-progress")).not.toBeInTheDocument()
  })

  it("マイルストーンは遅れだけ示す（塗りは無し）", () => {
    const bar = renderBar(task({ isMilestone: true, progress: 0.5, isDelayed: true }))
    expect(bar).toHaveAttribute("data-delayed", "true")
    expect(screen.queryByTestId("task-bar-progress")).not.toBeInTheDocument()
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
