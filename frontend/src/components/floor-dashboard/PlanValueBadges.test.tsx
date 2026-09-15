import { describe, expect, it } from "vitest"
import { render, screen } from "@/test-utils/render"
import { QuantityBadge, DeadlineValueBadge } from "./PlanValueBadges"

const TODAY_ISO = "2026-09-10"

/**
 * 現場ダッシュボードの数量・納期バッジ（Issue #450, #452）のユニットテスト。
 */
describe("QuantityBadge", () => {
  it("数量はカンマ区切りで末尾に「個」を付けて表示する", () => {
    render(<QuantityBadge quantity={1234} />)
    expect(screen.getByText("1,234 個")).toBeInTheDocument()
  })

  it("数量が未設定（null/undefined）の場合は単位を付けず「-」のみ表示する", () => {
    render(<QuantityBadge quantity={null} />)
    expect(screen.getByText("-")).toBeInTheDocument()
    expect(screen.queryByText(/個/)).not.toBeInTheDocument()
  })
})

describe("DeadlineValueBadge", () => {
  it("納期超過時は赤背景・白文字になる", () => {
    render(<DeadlineValueBadge deadline="2026-09-08" todayIso={TODAY_ISO} status="overdue" />)
    expect(screen.getByText("09/08").closest("span")).toHaveClass("bg-red-600")
  })

  it("納期超過でない場合は赤背景にならない", () => {
    render(<DeadlineValueBadge deadline="2026-09-20" todayIso={TODAY_ISO} status="on_track" />)
    expect(screen.getByText("09/20").closest("span")).not.toHaveClass("bg-red-600")
  })
})
