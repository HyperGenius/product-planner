import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@/test-utils/render"
import userEvent from "@testing-library/user-event"
import type { OrderSearchFilters } from "@/lib/floor-dashboard-utils"
import { SearchAndFilterBar } from "./SearchAndFilterBar"

/**
 * 現場ダッシュボードの検索・フィルタバー（Issue #444）のユニットテスト。
 */
describe("SearchAndFilterBar", () => {
  const filters: OrderSearchFilters = { searchText: "", overdueOnly: false }

  it("凡例に納期超過・1週間未満・1週間以上の3色を表示する", () => {
    render(<SearchAndFilterBar filters={filters} onFiltersChange={() => {}} />)

    expect(screen.getByText("納期超過")).toBeInTheDocument()
    expect(screen.getByText("1週間未満")).toBeInTheDocument()
    expect(screen.getByText("1週間以上")).toBeInTheDocument()
  })

  it("検索語を入力すると onFiltersChange が呼ばれる", async () => {
    const user = userEvent.setup()
    const onFiltersChange = vi.fn()
    render(<SearchAndFilterBar filters={filters} onFiltersChange={onFiltersChange} />)

    await user.type(screen.getByLabelText("顧客名・製品名・注文番号で検索"), "A")

    expect(onFiltersChange).toHaveBeenCalledWith({ searchText: "A", overdueOnly: false })
  })

  it("「納期遅れのみ」トグルを切り替えると onFiltersChange が呼ばれる", async () => {
    const user = userEvent.setup()
    const onFiltersChange = vi.fn()
    render(<SearchAndFilterBar filters={filters} onFiltersChange={onFiltersChange} />)

    await user.click(screen.getByLabelText("納期遅れのみ"))

    expect(onFiltersChange).toHaveBeenCalledWith({ searchText: "", overdueOnly: true })
  })
})
