import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { ProgressLegend } from "./progress-legend"

describe("ProgressLegend（Issue #580）", () => {
  it("進捗を計算済みなら全状態と計算時刻を出す", () => {
    render(<ProgressLegend computedAt={new Date(2026, 8, 11, 10, 30).toISOString()} />)
    const legend = screen.getByTestId("progress-legend")
    for (const label of ["計画のみ", "未着手", "進行中", "完了", "遅れ"]) {
      expect(legend).toHaveTextContent(label)
    }
    expect(legend).toHaveTextContent("9/11 10:30 時点の日報")
    expect(legend).toHaveTextContent("納期")
  })

  it("進捗を一度も計算していないテナントは「計画のみ」だけ出す", () => {
    render(<ProgressLegend computedAt={null} />)
    const legend = screen.getByTestId("progress-legend")
    expect(legend).toHaveTextContent("計画のみ")
    expect(legend).not.toHaveTextContent("未着手")
    expect(legend).not.toHaveTextContent("遅れ")
    expect(legend).not.toHaveTextContent("時点の日報")
  })

  it("見本は実際のバーと同じ外観で描く", () => {
    const { container } = render(<ProgressLegend computedAt="2026-09-11T01:00:00Z" />)
    const appearances = Array.from(container.querySelectorAll("[data-appearance]")).map((el) =>
      el.getAttribute("data-appearance"),
    )
    expect(appearances).toEqual(["neutral", "subtle", "default", "muted", "danger"])
  })
})
