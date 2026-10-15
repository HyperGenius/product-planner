import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import type { GanttTask } from "../types"
import { GanttChart, groupTasksIntoRows } from "./gantt-chart"

function task(overrides: Partial<GanttTask> & Pick<GanttTask, "id">): GanttTask {
  return {
    name: overrides.id,
    start: new Date(2026, 8, 10, 9),
    end: new Date(2026, 8, 10, 12),
    ...overrides,
  }
}

describe("groupTasksIntoRows", () => {
  it("rowId が同じタスクを最初に現れた行にまとめ、rowId の無いタスクは1行ずつにする", () => {
    const a1 = task({ id: "a1", rowId: "a" })
    const b = task({ id: "b" })
    const a2 = task({ id: "a2", rowId: "a" })
    const c = task({ id: "c", rowId: "c" })

    expect(groupTasksIntoRows([a1, b, a2, c])).toEqual([[a1, a2], [b], [c]])
  })
})

describe("GanttChart の行", () => {
  it("同じ rowId のバーを1行に並べ、それぞれの列に描く（Issue #535）", () => {
    render(
      <GanttChart
        tasks={[
          task({ id: "seg1", name: "内職-1", rowId: "r", start: new Date(2026, 8, 10, 9), end: new Date(2026, 8, 10, 12) }),
          task({ id: "seg2", name: "内職-2", rowId: "r", start: new Date(2026, 8, 11, 9), end: new Date(2026, 8, 11, 10) }),
        ]}
        viewMode="Day"
        rangeStart={new Date(2026, 8, 10)}
        rangeEnd={new Date(2026, 8, 12)}
      />,
    )

    const seg1 = screen.getByText("内職-1").parentElement!
    const seg2 = screen.getByText("内職-2").parentElement!
    expect(seg1.parentElement).toBe(seg2.parentElement)
    expect(seg1.style.gridColumn).toBe("10 / 13")
    expect(seg2.style.gridColumn).toBe("34 / 35")
  })
})
