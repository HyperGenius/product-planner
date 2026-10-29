import { describe, expect, it, vi } from "vitest"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test-utils/render"
import { CustomerFilter } from "@/components/schedule/customer-filter"
import { listScheduleCustomers } from "@/lib/schedule-customer-filter"

const OPTIONS = listScheduleCustomers([
  { customer_id: 1, customer_name: "顧客A株式会社", customer_alias: "A社" },
  { customer_id: 2, customer_name: "B工業", customer_alias: null },
  { customer_id: null, customer_name: null, customer_alias: null },
])

describe("CustomerFilter", () => {
  it("未選択は「すべて」、選んだ顧客は表示名を出す", () => {
    const { rerender } = render(<CustomerFilter options={OPTIONS} value={null} onChange={() => {}} />)
    expect(screen.getByRole("combobox", { name: "顧客選択" })).toHaveTextContent("すべて")

    rerender(<CustomerFilter options={OPTIONS} value={{ customerId: 1, label: "A社" }} onChange={() => {}} />)
    expect(screen.getByRole("combobox", { name: "顧客選択" })).toHaveTextContent("A社")
  })

  it("正式名称で検索して選ぶと、ID と表示名を返す", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<CustomerFilter options={OPTIONS} value={null} onChange={onChange} />)

    await user.click(screen.getByRole("combobox", { name: "顧客選択" }))
    await user.type(screen.getByPlaceholderText("顧客を検索..."), "株式会社")
    expect(screen.queryByRole("option", { name: "B工業" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("option", { name: "A社" }))

    expect(onChange).toHaveBeenCalledWith({ customerId: 1, label: "A社" })
  })

  it("顧客不明・すべてを選べる", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<CustomerFilter options={OPTIONS} value={{ customerId: 1, label: "A社" }} onChange={onChange} />)

    await user.click(screen.getByRole("combobox", { name: "顧客選択" }))
    await user.click(screen.getByRole("option", { name: "顧客不明" }))
    expect(onChange).toHaveBeenLastCalledWith({ customerId: null, label: "顧客不明" })

    await user.click(screen.getByRole("combobox", { name: "顧客選択" }))
    await user.click(screen.getByRole("option", { name: "すべて" }))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})
