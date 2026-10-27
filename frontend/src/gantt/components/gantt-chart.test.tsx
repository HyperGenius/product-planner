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

    const [seg1, seg2] = Array.from(document.querySelectorAll<HTMLElement>("[data-task-id]"))
    expect(seg1.parentElement).toBe(seg2.parentElement)
    expect(seg1.style.gridColumn).toBe("10 / 13")
    expect(seg2.style.gridColumn).toBe("34 / 35")
    // 行のラベルは1つだけ
    expect(screen.getAllByTestId("gantt-row-label")).toHaveLength(1)
  })
})

describe("GanttChart の固定ラベル列", () => {
  const range = { rangeStart: new Date(2026, 8, 10), rangeEnd: new Date(2026, 8, 12) }

  it("renderRowLabel の結果をラベル列に出し、sticky left で固定する", () => {
    render(
      <GanttChart
        tasks={[task({ id: "a", name: "切削" }), task({ id: "b", name: "組立" })]}
        viewMode="Day"
        {...range}
        renderRowLabel={(rowTasks) => <span>ラベル:{rowTasks[0].name}</span>}
        labelHeader="見出し"
      />,
    )
    expect(screen.getByText("ラベル:切削")).toBeInTheDocument()
    expect(screen.getByText("ラベル:組立")).toBeInTheDocument()
    expect(screen.getByTestId("gantt-label-header")).toHaveTextContent("見出し")
    expect(screen.getByTestId("gantt-label-header").className).toContain("sticky")
    screen.getAllByTestId("gantt-row-label").forEach((el) => {
      expect(el.className).toContain("sticky")
      expect(el.className).toContain("left-0")
    })
  })

  it("renderRowLabel 未指定なら行の先頭タスクの name を出す", () => {
    render(<GanttChart tasks={[task({ id: "a", name: "切削" })]} viewMode="Day" {...range} />)
    expect(screen.getByTestId("gantt-row-label")).toHaveTextContent("切削")
  })

  it("ラベル列の幅を指定でき、グループ行は groupRowHeight で高さを変えられる", () => {
    render(
      <GanttChart
        tasks={[
          task({ id: "g", name: "注文", isGroupHeader: true }),
          task({ id: "t", name: "工程" }),
        ]}
        viewMode="Day"
        {...range}
        labelWidth={280}
        rowHeight={40}
        groupRowHeight={56}
      />,
    )
    const [groupLabel, rowLabel] = screen.getAllByTestId("gantt-row-label")
    expect(groupLabel).toHaveStyle({ width: "280px" })
    expect(groupLabel.parentElement).toHaveStyle({ height: "56px" })
    expect(rowLabel.parentElement).toHaveStyle({ height: "40px" })
  })

  it("ヘッダーと本体を1つのスクロールコンテナに入れ、ヘッダー行は sticky top で固定する", () => {
    render(<GanttChart tasks={[task({ id: "a" })]} viewMode="Day" {...range} />)
    const scroller = screen.getByTestId("gantt-label-header").parentElement!.parentElement!.parentElement!
    expect(scroller.className).toContain("overflow-auto")
    expect(screen.getByTestId("gantt-label-header").parentElement!.className).toContain("top-0")
  })
})
